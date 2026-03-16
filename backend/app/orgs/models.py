from sqlalchemy import Column, Integer, String, ForeignKey
from app.database import Base

class Organization(Base):

    __tablename__ = "organizations"

    id = Column(Integer, primary_key=True)
    name = Column(String)
    owner_id = Column(Integer, ForeignKey("users.id"))

class Membership(Base):

    __tablename__ = "memberships"

    user_id = Column(Integer, ForeignKey("users.id"), primary_key=True)
    org_id = Column(Integer, ForeignKey("organizations.id"), primary_key=True)
    role = Column(String)