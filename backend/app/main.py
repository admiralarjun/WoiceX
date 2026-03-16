from fastapi import FastAPI

app = FastAPI(
    title="Voice Agent Platform",
    version="0.1.0"
)


@app.get("/")
def health():
    return {"status": "ok"}