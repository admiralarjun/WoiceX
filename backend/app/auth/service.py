from google.oauth2 import id_token
from google.auth.transport import requests
from app.config import settings 

GOOGLE_CLIENT_ID = settings.google_client_id

def verify_google_token(token):

    info = id_token.verify_oauth2_token(
        token,
        requests.Request(),
        GOOGLE_CLIENT_ID
    )

    return {
        "email": info["email"],
        "name": info["name"],
        "picture": info.get("picture")
    }