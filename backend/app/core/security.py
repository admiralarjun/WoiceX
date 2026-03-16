from jose import jwt
import time
from app.config import settings


def create_token(user_id):

    payload = {
        "sub": str(user_id),
        "exp": time.time() + 86400
    }

    return jwt.encode(
        payload,
        settings.jwt_secret,
        algorithm="HS256"
    )

def decode_token(token: str):
    payload = jwt.decode(
        token,
        settings.jwt_secret,
        algorithms=["HS256"]
    )
    return payload.get("sub")