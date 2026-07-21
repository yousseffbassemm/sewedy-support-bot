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

import re

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

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

    # No real model load on startup -- the suite runs offline and mocked.
    monkeypatch.setenv("SUPPORTBOT_WARMUP", "0")

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


def test_auth_me_requires_bearer_header(client):
    """The token must travel in a header, never in the URL."""
    creds = {"username": "Me", "email": "me@elsewedy.com", "password": "secret1"}
    token = client.post("/auth/signup", json=creds).json()["token"]

    r = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert r.json()["email"] == "me@elsewedy.com"

    # The old query-parameter form must no longer authenticate anything.
    assert client.get("/auth/me", params={"token": token}).status_code == 401
    assert client.get("/auth/me").status_code == 401
    assert client.get("/auth/me", headers={"Authorization": token}).status_code == 401
    assert client.get("/auth/me", headers={"Authorization": "Bearer nonsense"}).status_code == 401


def test_password_reset_round_trip(client, engine, monkeypatch):
    """Exercises the pending_expires comparison.

    Worth pinning: these timestamps are naive UTC in a naive SQLite column, so
    switching them to timezone-aware values would raise "can't compare
    offset-naive and offset-aware datetimes" HERE, at runtime, rather than
    anywhere a type checker or import would catch it.
    """
    _make_verified_user(engine, email="reset@elsewedy.com")

    # The client fixture stubs send_code to a no-op; capture the code instead.
    codes = {}
    monkeypatch.setattr(main, "send_code", lambda to, code, kind: codes.update(code=code))

    assert client.post("/auth/forgot", json={"email": "reset@elsewedy.com"}).status_code == 200
    r = client.post(
        "/auth/reset",
        json={"email": "reset@elsewedy.com", "code": codes["code"], "new_password": "brandnew1"},
    )
    assert r.status_code == 200, r.json()

    assert client.post("/auth/login", json={"email": "reset@elsewedy.com", "password": "brandnew1"}).status_code == 200
    assert client.post("/auth/login", json={"email": "reset@elsewedy.com", "password": "secret1"}).status_code == 401


def test_password_reset_rejects_expired_code(client, engine):
    from datetime import timedelta

    from backend.db import utcnow

    _make_verified_user(engine, email="expired@elsewedy.com")
    with Session(engine) as s:
        u = s.exec(select(User).where(User.email == "expired@elsewedy.com")).first()
        u.pending_code = "123456"
        u.pending_kind = "reset"
        u.pending_expires = utcnow() - timedelta(minutes=1)  # already lapsed
        s.add(u)
        s.commit()

    r = client.post(
        "/auth/reset",
        json={"email": "expired@elsewedy.com", "code": "123456", "new_password": "brandnew1"},
    )
    assert r.status_code == 400
    assert "expired" in r.json()["detail"].lower()


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


# The client stores history as the user's RAW typed text, so for an Arabic
# chat the history is Arabic. Retrieval runs on an English-only embedder,
# which is the entire reason /chat translates first -- so whatever
# contextualization folds in has to be translated too, or the translated
# query gets Arabic glued back onto it.
_AR_PREV = "جهاز ThermoNode T5 لا يكمل تحديث البرنامج"
_AR_FOLLOWUP = "وهل ما زال يفشل؟"
_AR_TO_EN = {
    _AR_PREV: "my ThermoNode T5 firmware update keeps failing",
    _AR_FOLLOWUP: "and does it still fail",
}


def test_arabic_followup_is_searched_entirely_in_english(client, monkeypatch):
    """An Arabic follow-up must reach retrieval as pure English.

    This fires precisely in the Arabic path: the follow-up translates to
    English, the English then contains a referring word ("it"), which triggers
    contextualization, which used to prepend the UNTRANSLATED Arabic previous
    question -- reintroducing the exact problem translation exists to prevent.
    """
    captured = {}

    def _capture(q, settings, top_k=5):
        captured["query"] = q
        return list(_FAKE_HITS)

    monkeypatch.setattr(main, "hybrid_search", _capture)
    monkeypatch.setattr(main, "translate_to_english", lambda q: _AR_TO_EN.get(q, q))

    r = client.post(
        "/chat",
        json={"query": _AR_FOLLOWUP, "history": [{"role": "user", "text": _AR_PREV}]},
    )
    assert r.status_code == 200

    searched = captured["query"]
    assert not re.search(r"[؀-ۿ]", searched), f"Arabic reached retrieval: {searched!r}"
    # And the context was genuinely folded in, not merely dropped.
    assert "ThermoNode T5" in searched


# --- feedback ---------------------------------------------------------------

def test_feedback_records_and_aggregates(client):
    # Voting stays anonymous -- the UI fires it without a token.
    assert client.post("/feedback", json={"query": "firmware fails", "vote": "up", "case_id": "9999-0001"}).status_code == 200
    assert client.post("/feedback", json={"query": "no display", "vote": "down"}).status_code == 200

    # Reading the aggregate does not: it reports on internal performance.
    token = client.post(
        "/auth/signup", json={"username": "Admin", "email": "admin@elsewedy.com", "password": "secret1"}
    ).json()["token"]
    stats = client.get("/feedback/stats", headers={"Authorization": f"Bearer {token}"}).json()
    assert stats == {"up": 1, "down": 1, "total": 2}


def test_feedback_stats_requires_auth(client):
    assert client.get("/feedback/stats").status_code == 401
    assert client.get("/feedback/stats", headers={"Authorization": "Bearer nonsense"}).status_code == 401


def test_feedback_stats_empty_is_zero_not_an_error(client):
    """The grouped COUNT returns no rows at all when nothing has been voted on;
    the endpoint must read that as zeroes rather than KeyError."""
    token = client.post(
        "/auth/signup", json={"username": "Admin", "email": "admin2@elsewedy.com", "password": "secret1"}
    ).json()["token"]
    r = client.get("/feedback/stats", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert r.json() == {"up": 0, "down": 0, "total": 0}


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
