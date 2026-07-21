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


def test_chat_fallback_localized_to_arabic(client, monkeypatch):
    # Arabic query + Gemini down -> the offline fallback must be Arabic, not English.
    monkeypatch.setattr(main, "hybrid_search", lambda q, s, top_k=5: [])
    monkeypatch.setattr(main, "generate_reply", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("429 quota")))
    r = client.post("/chat", json={"query": "مرحبا كيف الحال"})
    assert r.status_code == 200
    reply = r.json()["reply"]
    assert "couldn't reach" not in reply.lower()
    assert "دعم المنتجات" in reply  # the Arabic product-support nudge


def test_chat_accepts_conversation_history(client):
    r = client.post(
        "/chat",
        json={
            "query": "and it still fails",
            "history": [
                {"role": "user", "text": "AeroSense G3 firmware update"},
                {"role": "bot", "text": "Re-flash on a stable supply."},
            ],
        },
    )
    assert r.status_code == 200
    assert r.json()["reply"] == "MOCK GROUNDED REPLY"


# --- auth -------------------------------------------------------------------

def test_signup_returns_a_usable_session(client):
    """Signup must return the same {token, username, email} shape as login.

    The frontend reads exactly these three fields and drops the user straight
    into the app. When signup returned {ok, message, email_mode} instead, every
    field the client read was undefined.
    """
    r = client.post("/auth/signup", json={"username": "Youssef", "email": "new@elsewedy.com", "password": "secret1"})
    assert r.status_code == 200
    body = r.json()
    assert body["token"]
    assert body["username"] == "Youssef"
    assert body["email"] == "new@elsewedy.com"


def test_signup_then_login_round_trip(client):
    """The regression guard: an account created through signup must be able to
    log in afterwards. Signup used to create the user UNVERIFIED while login
    rejected unverified accounts, so every account made through the UI was
    permanently locked out -- and no test caught it, because the login tests
    all used a pre-seeded verified user instead of one signup actually made.
    """
    creds = {"username": "Roundtrip", "email": "round@elsewedy.com", "password": "secret1"}
    assert client.post("/auth/signup", json=creds).status_code == 200

    r = client.post("/auth/login", json={"email": creds["email"], "password": creds["password"]})
    assert r.status_code == 200, r.json()
    assert r.json()["token"]


def test_signup_duplicate_email_rejected(client):
    creds = {"username": "First", "email": "dupe@elsewedy.com", "password": "secret1"}
    assert client.post("/auth/signup", json=creds).status_code == 200
    assert client.post("/auth/signup", json=creds).status_code == 409


def test_signup_reclaims_legacy_unverified_account(client, engine):
    """A user stranded by the old broken flow can sign up again and get in."""
    with Session(engine) as s:
        s.add(User(email="legacy@elsewedy.com", username="Old", password_hash=hash_password("old123"), is_verified=False))
        s.commit()

    r = client.post("/auth/signup", json={"username": "New", "email": "legacy@elsewedy.com", "password": "new123"})
    assert r.status_code == 200
    assert client.post("/auth/login", json={"email": "legacy@elsewedy.com", "password": "new123"}).status_code == 200


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


# --- retrieval query contextualization --------------------------------------

_HIST = [
    {"role": "user", "text": "my ThermoNode T5 firmware update keeps failing"},
    {"role": "bot", "text": "Power was interrupted during flashing."},
]


def test_contextualize_folds_in_previous_question_for_a_followup():
    # "it" is a referring word -> the follow-up can't stand alone.
    out = main._contextualize("does it happen on the X200 too", _HIST)
    assert out.startswith("my ThermoNode T5 firmware update keeps failing")
    assert "does it happen on the X200 too" in out


def test_contextualize_leaves_self_contained_query_untouched():
    # Short, but carries its own product + symptom: must NOT be polluted.
    assert main._contextualize("device reboots randomly", _HIST) == "device reboots randomly"


def test_contextualize_leaves_long_query_untouched():
    long_q = "the AeroSense G3 display shows nothing at all after I power it on in the field"
    assert main._contextualize(long_q, _HIST) == long_q


def test_contextualize_noop_without_history():
    assert main._contextualize("and it still fails", None) == "and it still fails"


# --- feedback ---------------------------------------------------------------

def test_feedback_records_and_aggregates(client):
    assert client.post("/feedback", json={"query": "firmware fails", "vote": "up", "case_id": "9999-0001"}).status_code == 200
    assert client.post("/feedback", json={"query": "no display", "vote": "down"}).status_code == 200
    stats = client.get("/feedback/stats").json()
    assert stats == {"up": 1, "down": 1, "total": 2}


def test_feedback_rejects_bad_vote(client):
    r = client.post("/feedback", json={"query": "x", "vote": "meh"})
    assert r.status_code == 400


def test_login_lockout_after_repeated_failures(client, engine):
    _make_verified_user(engine, email="lock@elsewedy.com")
    # 5 wrong attempts arm the lock; the next attempt is refused with 429 even
    # though the rate-limit window (10/min) has not been hit.
    for _ in range(5):
        r = client.post("/auth/login", json={"email": "lock@elsewedy.com", "password": "wrong"})
        assert r.status_code == 401
    r = client.post("/auth/login", json={"email": "lock@elsewedy.com", "password": "secret1"})
    assert r.status_code == 429  # locked, correct password notwithstanding
