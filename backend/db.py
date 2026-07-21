"""
backend.db -- SQLite + SQLModel user store.

One table: User. SQLite because it needs no server, lives in a single file,
and fits this project's local-first design (same spirit as ChromaDB being
embedded rather than a separate service).

The DB file lives at backend/data/app.db (git-ignored).
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from sqlmodel import Field, SQLModel, create_engine, Session


def utcnow() -> datetime:
    """Current UTC time as a NAIVE datetime.

    datetime.utcnow() is deprecated from Python 3.12, but its drop-in
    replacement datetime.now(timezone.utc) is timezone-AWARE, and these values
    go into plain SQLite DateTime columns that store no offset. Mixing the two
    is the trap: an aware value written now reads back naive later, and
    comparing the two raises "can't compare offset-naive and offset-aware
    datetimes" -- which would break password-reset expiry at runtime, not at
    import. So compute in UTC explicitly, then drop the tzinfo to keep the
    stored representation exactly what it has always been.
    """
    return datetime.now(timezone.utc).replace(tzinfo=None)

# --- database file location -------------------------------------------------
_DB_DIR = Path(__file__).parent / "data"
_DB_DIR.mkdir(parents=True, exist_ok=True)
_DB_PATH = _DB_DIR / "app.db"

# check_same_thread=False so FastAPI's threadpool can share the connection
engine = create_engine(
    f"sqlite:///{_DB_PATH}",
    echo=False,
    connect_args={"check_same_thread": False},
)


class User(SQLModel, table=True):
    """A registered user.

    NOTE: password_hash is a bcrypt hash, never the plaintext password.
    email is stored lowercased and is the unique login identity.
    """

    id: Optional[int] = Field(default=None, primary_key=True)
    email: str = Field(index=True, unique=True)
    username: str
    password_hash: str
    is_verified: bool = Field(default=False)

    # Short-lived codes for email verification / password reset.
    # Stored hashed would be even better; kept plain here for teaching clarity
    # since they expire quickly and are single-purpose.
    pending_code: Optional[str] = Field(default=None)
    pending_kind: Optional[str] = Field(default=None)  # "verify" | "reset"
    pending_expires: Optional[datetime] = Field(default=None)

    created_at: datetime = Field(default_factory=utcnow)


class Feedback(SQLModel, table=True):
    """One thumbs-up / thumbs-down on an answer.

    Stores the query and (optionally) the case the answer was grounded in, so
    the team can later see which questions the bot answers well and which need
    a better case in the knowledge base -- a real quality signal, captured at
    the moment of use.
    """

    id: Optional[int] = Field(default=None, primary_key=True)
    query: str
    case_id: Optional[str] = Field(default=None, index=True)
    vote: str  # "up" | "down"
    user_email: Optional[str] = Field(default=None, index=True)
    created_at: datetime = Field(default_factory=utcnow)


def init_db() -> None:
    """Create tables if they don't exist. Called once on app startup."""
    SQLModel.metadata.create_all(engine)


def get_session() -> Session:
    """FastAPI dependency: yields a DB session per request."""
    with Session(engine) as session:
        yield session
