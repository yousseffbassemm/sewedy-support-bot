"""
backend.main -- FastAPI server for SupportBot.

Endpoints:
  GET  /health                 -> liveness + email mode
  POST /search                 -> real semantic search (MiniLM + ChromaDB), no LLM
  POST /chat                   -> retrieval + Gemini-written grounded reply
  POST /auth/signup            -> create account (no email verification)
  POST /auth/login             -> check password, return token
  POST /auth/forgot            -> email a reset code
  POST /auth/reset             -> confirm code + set new password
  GET  /auth/me                -> who am I (from JWT)

Run from the PROJECT ROOT (so the `rag` package imports cleanly):
    uv run uvicorn backend.main:app --reload --port 8000

The search endpoint reuses rag.retrieve.semantic_search unchanged -- the
whole point of the clean Day-2 abstraction is that the API is a thin wrapper.
"""

from __future__ import annotations

# Load backend/.env FIRST, before importing any backend module that reads
# environment variables at import time (auth.py reads JWT_SECRET as soon as
# it's imported). Without this, .env is never actually read into the process
# environment -- os.environ.get() only sees real OS-level env vars.
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

import random
from datetime import datetime, timedelta

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr
from sqlmodel import Session, select

from backend.auth import (
    create_token,
    decode_token,
    hash_password,
    verify_password,
)
from backend.db import User, get_session, init_db
from backend.email_utils import email_mode, send_code
from backend.embedding_map import EmbeddingMap
from backend.llm import generate_reply, translate_to_english

# rag package (your existing Day-1/Day-2 code) -------------------------------
from rag.config import load_config
from rag.retrieve import semantic_search

app = FastAPI(title="SupportBot API")

# CORS: allow the frontend dev server to call us. Tighten allow_origins to your
# real frontend URL in production instead of localhost.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",  # Vite default
        "http://localhost:3000",  # CRA / Next default
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_SETTINGS = load_config()
_CODE_TTL_MIN = 10
_embedding_map: EmbeddingMap | None = None


def _get_embedding_map() -> EmbeddingMap:
    """Build the EmbeddingMap lazily, on first use, not at import time --
    it needs data/chroma/ to already exist, which may not be true the
    instant the server starts. Cached after the first successful build."""
    global _embedding_map
    if _embedding_map is None:
        _embedding_map = EmbeddingMap(_SETTINGS)
    return _embedding_map


# Ensure tables exist as soon as the module is imported. The startup event
# below also calls this; running it here too makes the app robust regardless
# of how it's launched (uvicorn, TestClient, embedded, etc.).
init_db()


@app.on_event("startup")
def _startup() -> None:
    init_db()
    print(f"[startup] SupportBot API ready. email mode = {email_mode()}")


def _gen_code() -> str:
    return f"{random.randint(0, 999999):06d}"


# ---------------------------------------------------------------------------
# Health + search
# ---------------------------------------------------------------------------
@app.get("/health")
def health() -> dict:
    return {"status": "ok", "email_mode": email_mode()}


class SearchRequest(BaseModel):
    query: str
    top_k: int | None = None


class Hit(BaseModel):
    case_id: str
    product: str
    category: str
    problem: str
    distance: float
    document: str


@app.post("/search", response_model=list[Hit])
def search(req: SearchRequest) -> list[dict]:
    """Real semantic search over the indexed corpus. No LLM involved."""
    q = req.query.strip()
    if not q:
        raise HTTPException(status_code=400, detail="Query must not be empty.")
    hits = semantic_search(q, _SETTINGS, top_k=req.top_k)
    return hits


class ChatRequest(BaseModel):
    query: str


class ChatResponse(BaseModel):
    reply: str
    hits: list[Hit]
    grounded: bool  # True if Gemini generated the reply; False if we fell back


# A retrieved case counts as a genuine match only below this cosine distance.
# Based on real numbers seen during Day 2 testing: true matches for this
# corpus land around 0.37-0.59; unrelated/out-of-domain queries land around
# 0.85-0.93. This cutoff sits in the gap between them. It's a judgment call
# from a small sample, not a universal constant -- tune it if real usage
# shows it's too strict or too loose.
GOOD_MATCH_MAX_DISTANCE = 0.65


@app.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest) -> dict:
    """Real RAG: retrieve cases, then have Gemini write a short grounded
    reply from them. Falls back to a plain message (never crashes the chat)
    if Gemini is unavailable -- no API key set, rate limited, network down."""
    q = req.query.strip()
    if not q:
        raise HTTPException(status_code=400, detail="Message must not be empty.")

    # Retrieval uses an English-only embedder (MiniLM), so a non-English
    # query needs translating first -- otherwise ChromaDB's "closest
    # matches" are close to random, not actually relevant. The ORIGINAL
    # query (q) still goes to generate_reply so Gemini replies in the
    # user's own language; only retrieval uses the English version.
    search_query = translate_to_english(q)
    hits = semantic_search(search_query, _SETTINGS, top_k=5)

    # This is the key guarantee: Gemini is never even SHOWN a case whose
    # distance says it isn't actually relevant. It can't ground an answer
    # in something it never received -- this isn't asking the model to be
    # careful, it's removing the option entirely. The raw `hits` (unfiltered)
    # still go back in the API response so "See how this was found" stays
    # honest about what was actually retrieved, good match or not.
    grounding_hits = [h for h in hits if h["distance"] <= GOOD_MATCH_MAX_DISTANCE]

    try:
        reply = generate_reply(q, grounding_hits)
        return {"reply": reply, "hits": hits, "grounded": True}
    except Exception as exc:  # noqa: BLE001 -- deliberately broad: never crash chat
        print(f"[chat] Gemini unavailable, falling back to retrieval-only: {exc}")
        if grounding_hits:
            fallback = "I couldn't reach the answer-writing service, but here's what I found in the case base:"
        else:
            fallback = "I couldn't reach the answer-writing service, and no close matches were found in the case base."
        return {"reply": fallback, "hits": hits, "grounded": False}


class EmbeddingMapRequest(BaseModel):
    query: str


class MapPoint(BaseModel):
    id: str
    product: str
    category: str
    x: float
    y: float
    is_hit: bool


class EmbeddingMapResponse(BaseModel):
    query_point: dict
    points: list[MapPoint]


@app.post("/embedding_map", response_model=EmbeddingMapResponse)
def embedding_map(req: EmbeddingMapRequest) -> dict:
    """The 'science made visible' endpoint: projects the real 384-dim
    corpus vectors (and this query's own real vector) into a shared 2D
    space via PCA, so semantic search can be SHOWN as geometry, not just
    described. See backend/embedding_map.py for the honest explanation of
    what this plot does and doesn't prove."""
    q = req.query.strip()
    if not q:
        raise HTTPException(status_code=400, detail="Query must not be empty.")

    try:
        em = _get_embedding_map()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=503,
            detail=f"Embedding map unavailable: {exc}. Run `uv run python -m rag.index` first.",
        )

    # Same translation as /chat: the query point plotted here must match
    # what was ACTUALLY embedded and searched, not the raw original text,
    # or the plot would misleadingly show a different point than the one
    # retrieval really used.
    search_query = translate_to_english(q)
    hits = semantic_search(search_query, _SETTINGS, top_k=5)
    hit_ids = {h["case_id"] for h in hits}

    query_point = em.project_query(search_query)
    points = [{**p, "is_hit": p["id"] in hit_ids} for p in em.case_points]

    return {"query_point": query_point, "points": points}


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
class SignupRequest(BaseModel):
    username: str
    email: EmailStr
    password: str


class VerifyRequest(BaseModel):
    email: EmailStr
    code: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class ForgotRequest(BaseModel):
    email: EmailStr


class ResetRequest(BaseModel):
    email: EmailStr
    code: str
    new_password: str


class AuthResponse(BaseModel):
    token: str
    username: str
    email: str


def _get_user(session: Session, email: str) -> User | None:
    return session.exec(select(User).where(User.email == email.lower())).first()


@app.post("/auth/signup")
def signup(req: SignupRequest, session: Session = Depends(get_session)) -> dict:
    if len(req.username.strip()) < 2:
        raise HTTPException(400, "Username must be at least 2 characters.")
    if len(req.password) < 6:
        raise HTTPException(400, "Password must be at least 6 characters.")

    email = req.email.lower()
    existing = _get_user(session, email)
    if existing and existing.is_verified:
        raise HTTPException(409, "An account with that email already exists.")

    code = _gen_code()
    expires = datetime.utcnow() + timedelta(minutes=_CODE_TTL_MIN)

    if existing and not existing.is_verified:
        # Re-signup on an unverified account: refresh details + code.
        existing.username = req.username.strip()
        existing.password_hash = hash_password(req.password)
        existing.pending_code = code
        existing.pending_kind = "verify"
        existing.pending_expires = expires
        session.add(existing)
    else:
        user = User(
            email=email,
            username=req.username.strip(),
            password_hash=hash_password(req.password),
            is_verified=False,
            pending_code=code,
            pending_kind="verify",
            pending_expires=expires,
        )
        session.add(user)

    session.commit()
    send_code(email, code, "verify")
    return {"ok": True, "message": "Verification code sent.", "email_mode": email_mode()}


@app.post("/auth/verify", response_model=AuthResponse)
def verify(req: VerifyRequest, session: Session = Depends(get_session)) -> dict:
    user = _get_user(session, req.email)
    if not user or user.pending_kind != "verify":
        raise HTTPException(400, "No pending verification for that email.")
    if user.pending_expires and datetime.utcnow() > user.pending_expires:
        raise HTTPException(400, "Code expired. Please sign up again.")
    if req.code != user.pending_code:
        raise HTTPException(400, "Incorrect code.")

    user.is_verified = True
    user.pending_code = None
    user.pending_kind = None
    user.pending_expires = None
    session.add(user)
    session.commit()

    return {"token": create_token(user.email), "username": user.username, "email": user.email}


@app.post("/auth/login", response_model=AuthResponse)
def login(req: LoginRequest, session: Session = Depends(get_session)) -> dict:
    user = _get_user(session, req.email)
    if not user or not verify_password(req.password, user.password_hash):
        raise HTTPException(401, "Incorrect email or password.")
    if not user.is_verified:
        raise HTTPException(403, "Email not verified. Check your inbox for the code.")
    return {"token": create_token(user.email), "username": user.username, "email": user.email}


@app.post("/auth/forgot")
def forgot(req: ForgotRequest, session: Session = Depends(get_session)) -> dict:
    user = _get_user(session, req.email)
    # Do not reveal whether the account exists (avoids account enumeration),
    # but for a teaching demo we return a clear message. In prod, always 200.
    if not user:
        raise HTTPException(404, "No account found for that email.")
    code = _gen_code()
    user.pending_code = code
    user.pending_kind = "reset"
    user.pending_expires = datetime.utcnow() + timedelta(minutes=_CODE_TTL_MIN)
    session.add(user)
    session.commit()
    send_code(user.email, code, "reset")
    return {"ok": True, "message": "Reset code sent.", "email_mode": email_mode()}


@app.post("/auth/reset")
def reset(req: ResetRequest, session: Session = Depends(get_session)) -> dict:
    user = _get_user(session, req.email)
    if not user or user.pending_kind != "reset":
        raise HTTPException(400, "No pending reset for that email.")
    if user.pending_expires and datetime.utcnow() > user.pending_expires:
        raise HTTPException(400, "Code expired. Request a new one.")
    if req.code != user.pending_code:
        raise HTTPException(400, "Incorrect code.")
    if len(req.new_password) < 6:
        raise HTTPException(400, "New password must be at least 6 characters.")

    user.password_hash = hash_password(req.new_password)
    user.pending_code = None
    user.pending_kind = None
    user.pending_expires = None
    session.add(user)
    session.commit()
    return {"ok": True, "message": "Password updated."}


@app.get("/auth/me")
def me(token: str, session: Session = Depends(get_session)) -> dict:
    email = decode_token(token)
    if not email:
        raise HTTPException(401, "Invalid or expired token.")
    user = _get_user(session, email)
    if not user:
        raise HTTPException(404, "User not found.")
    return {"username": user.username, "email": user.email}
