from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.database import get_db
from app.auth.service import verify_google_token
from app.users.models import User
from app.core.security import create_token

router = APIRouter()

@router.post("/google")
def google_login(payload: dict, db: Session = Depends(get_db)):

    user_info = verify_google_token(payload["token"])

    user = db.query(User).filter_by(email=user_info["email"]).first()

    if not user:
        user = User(**user_info)
        db.add(user)
        db.commit()
        db.refresh(user)

    token = create_token(user.id)

    return {"access_token": token}