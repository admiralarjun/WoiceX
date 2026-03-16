from pydantic_settings import BaseSettings


class Settings(BaseSettings):

    jwt_secret: str
    google_client_id: str
    database_url: str
    gemini_api_key: str | None = None

    class Config:
        env_file = ".env"


settings = Settings()