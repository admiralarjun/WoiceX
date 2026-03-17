"""
chat/routes.py
─────────────────────────────────────────────────────────────────────────────
WebSocket endpoint for real-time voice sessions.

Single root Agent backed by ADK's InMemorySessionService.
Session state persists across reconnects for the same user.

To add a tool later:
    1. Define a function below in the TOOLS section.
    2. Append it to ROOT_AGENT_TOOLS.
    That's it.

Outbound event contract (JSON to frontend):
    { serverContent: { modelTurn: { parts: [{ inlineData }] } } }  — audio chunk
    { transcript: { role, text, partial } }                        — speech text
    { turnComplete: true }                                         — AI turn done
    { interrupted: true }                                          — barge-in
    { error: "..." }                                               — session error
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
import traceback
import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from google.adk.agents import Agent, LiveRequestQueue
from google.adk.agents.run_config import RunConfig, StreamingMode
from google.adk.runners import Runner
from google.adk.sessions.in_memory_session_service import InMemorySessionService
from google.genai import types

from app.core.security import decode_token
from app.config import settings

router = APIRouter()


# ─────────────────────────────────────────────────────────────────────────────
# TOOLS
# Define tool functions here, then add them to ROOT_AGENT_TOOLS.
# ─────────────────────────────────────────────────────────────────────────────

def get_current_time() -> str:
    """Returns the current UTC time."""
    from datetime import datetime, timezone
    print("get_current_time called", datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC"))
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")



# Add your tools to this list:
ROOT_AGENT_TOOLS: list = [
    get_current_time,
    # my_next_tool,
]


# ─────────────────────────────────────────────────────────────────────────────
# AGENT + RUNNER  (module-level singletons, built once on startup)
# ─────────────────────────────────────────────────────────────────────────────

_APP_NAME = "WoiceX"
_MODEL    = os.getenv("GEMINI_MODEL", "gemini-2.5-flash-native-audio-preview-12-2025")

_session_service = InMemorySessionService()

_root_agent = Agent(
    name="assistant",
    model=_MODEL,
    instruction=(
        "You are a helpful, concise AI voice assistant. "
        "Keep answers brief and conversational. "
        "This is a real-time voice conversation — speak naturally and at times you will have access to the camera"
    ),
    tools=ROOT_AGENT_TOOLS,
)

_runner = Runner(
    app_name=_APP_NAME,
    agent=_root_agent,
    session_service=_session_service,
)

# user_id → session_id  (survives WS reconnects — context is preserved)
_user_sessions: dict[str, str] = {}


async def _get_or_create_session(user_id: str) -> str:
    if user_id in _user_sessions:
        return _user_sessions[user_id]
    sid = f"sid_{uuid.uuid4().hex[:12]}"
    await _session_service.create_session(
        app_name=_APP_NAME,
        user_id=user_id,
        session_id=sid,
    )
    _user_sessions[user_id] = sid
    return sid


# ─────────────────────────────────────────────────────────────────────────────
# RUN CONFIG  (shared, stateless)
# ─────────────────────────────────────────────────────────────────────────────

_RUN_CONFIG = RunConfig(
    streaming_mode=StreamingMode.BIDI,
    response_modalities=["AUDIO"],
    output_audio_transcription=types.AudioTranscriptionConfig(),
    input_audio_transcription=types.AudioTranscriptionConfig(),
)


# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

async def _send(ws: WebSocket, payload: dict) -> None:
    """JSON send — silently ignores closed-socket errors."""
    try:
        await ws.send_json(payload)
    except Exception:
        pass


# ─────────────────────────────────────────────────────────────────────────────
# WEBSOCKET ENDPOINT
# ─────────────────────────────────────────────────────────────────────────────

@router.websocket("/ws")
async def voice_session(websocket: WebSocket, token: str = Query(...)):

    # Auth
    try:
        user_id = str(decode_token(token))
        if not user_id:
            await websocket.close(code=1008, reason="Invalid token")
            return
    except Exception:
        await websocket.close(code=1008, reason="Invalid token")
        return

    await websocket.accept()

    if not settings.gemini_api_key:
        await websocket.close(code=1011, reason="GEMINI_API_KEY not configured")
        return

    os.environ["GEMINI_API_KEY"] = settings.gemini_api_key

    # Session (persists across reconnects)
    session_id = await _get_or_create_session(user_id)
    live_queue = LiveRequestQueue()

    # Task 1: client → agent
    async def receive_from_client() -> None:
        try:
            while True:
                raw = await websocket.receive_text()
                msg = json.loads(raw)

                # Audio / image frames
                if "realtimeInput" in msg:
                    for chunk in msg["realtimeInput"].get("mediaChunks", []):
                        mime = chunk.get("mimeType", "audio/pcm;rate=16000")
                        data = base64.b64decode(chunk.get("data", ""))
                        live_queue.send_realtime(types.Blob(data=data, mime_type=mime))

                # Typed text from UI
                elif "text" in msg:
                    live_queue.send_content(
                        types.Content(
                            role="user",
                            parts=[types.Part(text=msg["text"])],
                        )
                    )

        except WebSocketDisconnect:
            pass
        except Exception as e:
            print(f"[chat] receive error: {e}")

    # Task 2: agent → client
    async def stream_to_client() -> None:
        try:
            async for event in _runner.run_live(
                user_id=user_id,
                session_id=session_id,
                live_request_queue=live_queue,
                run_config=_RUN_CONFIG,
            ):
                # Non-content events first
                if not event.content or not event.content.parts:
                    if getattr(event, "turn_complete", False):
                        await _send(websocket, {"turnComplete": True})
                    if getattr(event, "interrupted", False):
                        await _send(websocket, {"interrupted": True})
                    continue

                role       = getattr(event.content, "role", None)
                is_partial = getattr(event, "partial", False)

                for part in event.content.parts:

                    # Audio chunk — forward immediately
                    if getattr(part, "inline_data", None):
                        b64 = base64.b64encode(part.inline_data.data).decode()
                        await _send(websocket, {
                            "serverContent": {
                                "modelTurn": {
                                    "parts": [{
                                        "inlineData": {
                                            "data": b64,
                                            "mimeType": "audio/pcm;rate=24000",
                                        }
                                    }]
                                }
                            }
                        })

                    # Transcript — frontend buffers these, flushes on turnComplete
                    if getattr(part, "text", None):
                        await _send(websocket, {
                            "transcript": {
                                "role":    "user" if role == "user" else "ai",
                                "text":    part.text.strip(),
                                "partial": is_partial,
                            }
                        })

                # Turn / interrupt markers can co-exist with content parts
                if getattr(event, "turn_complete", False):
                    await _send(websocket, {"turnComplete": True})
                if getattr(event, "interrupted", False):
                    await _send(websocket, {"interrupted": True})

        except asyncio.CancelledError:
            pass
        except Exception as e:
            print(f"[chat] stream error: {e}")
            traceback.print_exc()
            await _send(websocket, {"error": str(e)})

    # Run both tasks concurrently
    try:
        async with asyncio.TaskGroup() as tg:
            tg.create_task(receive_from_client())
            tg.create_task(stream_to_client())
    except* Exception as eg:
        for exc in eg.exceptions:
            print(f"[chat] task error: {exc}")
    finally:
        try:
            await websocket.close()
        except Exception:
            pass