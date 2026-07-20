"""
Backend API tests -- FastAPI TestClient over the real app, with the embedding
model, vector store, and Gemini all mocked so the suite stays fast, offline,
and deterministic.

Covers: health, search/chat wiring, the offline (LLM-free) fallback for both a
grounded query and small talk, the full auth surface, per-IP rate limiting, and
account lockout after repeated failed logins.

Run:
    uv run pytest -q
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

import backend.main as main
from backend import security
from backend.auth import hash_password
from backend.db import User, get_session

# A retrieved case whose distance is under the grounding threshold, so /chat
# treats it as a genuine match without touching the real vector store.
_FAKE_HITS = [
    {
        "case_id": "9999-0001",
        "product": "AeroSense G3",
        "category": "Firmware",
        "problem": "Firmware update fails halfway",
        "cause": "Power interrupted during flashing",
        "resolution": "Re-flashed firmware on a stable supply",
        "distance": 0.30,
        "document": "Product: AeroSense G3 / Problem: Firmware update fails halfway",
    }
]


@pytest.fixture
def engine():
    eng = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,  # one shared in-memory connection for the test
    )
    SQLModel.metadata.create_all(eng)
    return eng


@pytest.fixture
def client(engine, monkeypatch):
    def _session_override():
        with Session(engine) as session:
            yield session

    main.app.dependency_overrides[get_session] = _session_override

    # No real model / vector store / Gemini / email.
    monkeypatch.setattr(main, "translate_to_english", lambda q: q)
    monkeypatch.setattr(main, "detect_product_query", lambda q, s: None)
    monkeypatch.setattr(main, "hybrid_search", lambda q, s, top_k=5: list(_FAKE_HITS))
    monkeypatch.setattr(main, "generate_reply", lambda *a, **k: "MOCK GROUNDED REPLY")
    monkeypatch.setattr(main, "send_code", lambda *a, **k: None)

    security._reset_all_for_tests()
    with TestClient(main.app) as c:
        yield c
    main.app.dependency_overrides.clear()


def _make_verified_user(engine, email="user@elsewedy.com", password="secret1"):
    with Session(engine) as s:
        s.add(User(email=email, username="Tester", password_hash=hash_password(password), is_verified=True))
        s.commit()


# --- health / search / chat -------------------------------------------------

def test_health_ok(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_search_returns_hits(client):
    r = client.post("/search", json={"query": "firmware update fails"})
    assert r.status_code == 200
    body = r.json()
    assert body[0]["case_id"] == "9999-0001"
    assert body[0]["product"] == "AeroSense G3"


def test_chat_grounded_uses_llm(client):
    r = client.post("/chat", json={"query": "firmware update fails halfway", "first": True})
    assert r.status_code == 200
    body = r.json()
    assert body["reply"] == "MOCK GROUNDED REPLY"
    assert body["grounded"] is True
    assert body["hits"][0]["case_id"] == "9999-0001"


def test_chat_falls_back_to_cases_when_llm_down(client, monkeypatch):
    # Gemini unavailable -> no crash; the grounded case is listed directly.
    monkeypatch.setattr(main, "generate_reply", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("429 quota")))
    r = client.post("/chat", json={"query": "firmware update fails halfway"})
    assert r.status_code == 200
    body = r.json()
    assert body["grounded"] is False
    assert "9999-0001" in body["reply"]
    assert "Resolution:" in body["reply"]


def test_chat_small_talk_fallback_is_friendly(client, monkeypatch):
    # No close case (empty retrieval) + Gemini down -> warm nudge, not an error.
    monkeypatch.setattr(main, "hybrid_search", lambda q, s, top_k=5: [])
    monkeypatch.setattr(main, "generate_reply", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("429 quota")))
    r = client.post("/chat", json={"query": "i like messi"})
    assert r.status_code == 200
    reply = r.json()["reply"].lower()
    assert "couldn't reach" not in reply
    assert "no matching" not in reply
    assert "product support" in reply


def test_chat_rejects_empty_query(client):
    r = client.post("/chat", json={"query": "   "})
    assert r.status_code == 400


# --- auth -------------------------------------------------------------------

def test_signup_ok(client):
    r = client.post("/auth/signup", json={"username": "Youssef", "email": "new@elsewedy.com", "password": "secret1"})
    assert r.status_code == 200
    assert r.json()["ok"] is True


def test_login_success(client, engine):
    _make_verified_user(engine)
    r = client.post("/auth/login", json={"email": "user@elsewedy.com", "password": "secret1"})
    assert r.status_code == 200
    assert "token" in r.json()


def test_login_wrong_password(client, engine):
    _make_verified_user(engine)
    r = client.post("/auth/login", json={"email": "user@elsewedy.com", "password": "wrong"})
    assert r.status_code == 401


def test_login_unverified_blocked(client, engine):
    with Session(engine) as s:
        s.add(User(email="u2@elsewedy.com", username="U2", password_hash=hash_password("secret1"), is_verified=False))
        s.commit()
    r = client.post("/auth/login", json={"email": "u2@elsewedy.com", "password": "secret1"})
    assert r.status_code == 403


# --- hardening: rate limit + lockout ---------------------------------------

def test_signup_rate_limited(client):
    # Bucket allows 5/min; the 6th call from the same client is throttled.
    codes = []
    for i in range(6):
        r = client.post("/auth/signup", json={"username": "User", "email": f"rl{i}@elsewedy.com", "password": "secret1"})
        codes.append(r.status_code)
    assert codes[-1] == 429
    assert any(c == 200 for c in codes[:5])


def test_login_lockout_after_repeated_failures(client, engine):
    _make_verified_user(engine, email="lock@elsewedy.com")
    # 5 wrong attempts arm the lock; the next attempt is refused with 429 even
    # though the rate-limit window (10/min) has not been hit.
    for _ in range(5):
        r = client.post("/auth/login", json={"email": "lock@elsewedy.com", "password": "wrong"})
        assert r.status_code == 401
    r = client.post("/auth/login", json={"email": "lock@elsewedy.com", "password": "secret1"})
    assert r.status_code == 429  # locked, correct password notwithstanding
