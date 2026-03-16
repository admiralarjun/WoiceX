import json
import base64
import asyncio
import uuid
import os
import traceback
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from google import genai
from google.genai import types

from google.adk.agents import Agent, LiveRequestQueue
from google.adk.runners import Runner
from google.adk.agents.run_config import RunConfig, StreamingMode
from google.adk.sessions.in_memory_session_service import InMemorySessionService

from app.core.security import decode_token
from app.config import settings

router = APIRouter()

# Global session service for this router to maintain conversational state
session_service = InMemorySessionService()

@router.websocket("/ws")
async def gemini_proxy(websocket: WebSocket, token: str = Query(...)):
    # Verify token
    try:
        user_id = decode_token(token)
        if not user_id:
            await websocket.close(code=1008, reason="Invalid token")
            return
    except Exception as e:
        await websocket.close(code=1008, reason="Invalid token")
        return

    await websocket.accept()

    if not settings.gemini_api_key:
        await websocket.close(code=1011, reason="GEMINI_API_KEY not configured")
        return

    os.environ["GEMINI_API_KEY"] = settings.gemini_api_key

    client_id = str(uuid.uuid4())
    session_id = f"session_{client_id}"

    await session_service.create_session(
        app_name="voice_assistant",
        user_id=str(user_id),
        session_id=session_id,
    )

    model = "gemini-2.5-flash-native-audio-preview-12-2025"

    agent = Agent(
        name="voice_assistant",
        model=model,
        instruction="You are a helpful, concise AI voice assistant. Keep answers brief and conversational.",
    )

    runner = Runner(
        app_name="voice_assistant",
        agent=agent,
        session_service=session_service,
    )

    live_request_queue = LiveRequestQueue()

    run_config = RunConfig(
        streaming_mode=StreamingMode.BIDI,
        response_modalities=["AUDIO"],
        output_audio_transcription=types.AudioTranscriptionConfig(),
        input_audio_transcription=types.AudioTranscriptionConfig(),
    )

    try:
        async with asyncio.TaskGroup() as tg:
            async def receive_client_messages():
                try:
                    while True:
                        data = await websocket.receive_text()
                        msg = json.loads(data)
                        if "realtimeInput" in msg:
                            chunks = msg["realtimeInput"].get("mediaChunks", [])
                            for chunk in chunks:
                                mime_type = chunk.get("mimeType", "audio/pcm;rate=24000")
                                b64_data = chunk.get("data", "")
                                if b64_data:
                                    raw_bytes = base64.b64decode(b64_data)
                                    live_request_queue.send_realtime(
                                        types.Blob(data=raw_bytes, mime_type=mime_type)
                                    )
                except WebSocketDisconnect:
                    print(f"Frontend disconnected for session {session_id}.")
                except Exception as e:
                    print(f"Error receiving from client: {e}")

            async def receive_service_responses():
                try:
                    async for event in runner.run_live(
                        user_id=str(user_id),
                        session_id=session_id,
                        live_request_queue=live_request_queue,
                        run_config=run_config,
                    ):
                        # ── Determine if this event is partial (mid-utterance) ──────
                        is_partial = getattr(event, "partial", False)

                        if event.content and event.content.parts:
                            role = getattr(event.content, "role", None)  # "user" or "model"

                            for part in event.content.parts:

                                # ── Audio chunk → forward to frontend ───────────────
                                if hasattr(part, "inline_data") and part.inline_data:
                                    b64_audio = base64.b64encode(part.inline_data.data).decode("utf-8")
                                    await websocket.send_text(json.dumps({
                                        "serverContent": {
                                            "modelTurn": {
                                                "parts": [{
                                                    "inlineData": {
                                                        "data": b64_audio,
                                                        "mimeType": "audio/pcm;rate=24000"
                                                    }
                                                }]
                                            }
                                        }
                                    }))

                                # ── Text / transcript part ───────────────────────────
                                if hasattr(part, "text") and part.text:
                                    # Skip partial (still-streaming) transcript chunks;
                                    # only emit once the utterance is finalised.
                                    if is_partial:
                                        continue

                                    if role == "user":
                                        # Input transcription — what the user said
                                        print(f"User transcript: {part.text}")
                                        await websocket.send_text(json.dumps({
                                            "transcript": {
                                                "role": "user",
                                                "text": part.text.strip()
                                            }
                                        }))
                                    else:
                                        # Output transcription — what the model said
                                        print(f"Model transcript: {part.text}")
                                        await websocket.send_text(json.dumps({
                                            "transcript": {
                                                "role": "ai",
                                                "text": part.text.strip()
                                            }
                                        }))

                        if getattr(event, "turn_complete", False):
                            await websocket.send_text(json.dumps({"turnComplete": True}))
                            print("Gemini turn complete — ready for next input")

                        if getattr(event, "interrupted", False):
                            print("User interrupted the model (barge-in).")

                except asyncio.CancelledError:
                    pass
                except Exception as e:
                    print(f"Error from ADK runner: {e}")
                    traceback.print_exc()

            tg.create_task(receive_client_messages())
            tg.create_task(receive_service_responses())

    except Exception as e:
        print(f"ADK session exception: {e}")
        try:
            await websocket.close(code=1011, reason="Gemini session error")
        except:
            pass