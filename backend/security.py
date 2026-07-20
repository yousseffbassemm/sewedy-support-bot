"""
backend.security -- lightweight, dependency-free rate limiting and login
lockout.

Everything here is in-memory and per-process, which is the right fit for a
single-instance demo: no Redis, no extra service. A multi-instance deployment
would move these counters into a shared store (Redis / the DB), but the call
sites would stay identical.

Two protections:
  - rate_limit(): a sliding-window cap per client IP per bucket. Stops brute
    forcing and email-send spam on the auth endpoints.
  - login lockout: after several failed logins for one email, that account is
    temporarily locked regardless of IP, so a distributed guess of one
    account's password still gets throttled.
"""

from __future__ import annotations

import time
from collections import defaultdict, deque
from threading import Lock

from fastapi import HTTPException, Request

# --- shared state -----------------------------------------------------------
_lock = Lock()
_hits: dict[str, deque[float]] = defaultdict(deque)
_failed_logins: dict[str, deque[float]] = defaultdict(deque)
_locked_until: dict[str, float] = {}

# --- lockout policy ---------------------------------------------------------
_MAX_FAILS = 5          # this many failed logins...
_FAIL_WINDOW = 900.0    # ...within 15 minutes...
_LOCK_DURATION = 900.0  # ...locks the account for 15 minutes.


def client_ip(request: Request | None) -> str:
    """Best-effort client IP. Behind a proxy you'd trust X-Forwarded-For; for
    a local/demo deployment request.client.host is correct."""
    if request and request.client:
        return request.client.host
    return "unknown"


def rate_limit(request: Request, bucket: str, max_requests: int, window_seconds: float) -> None:
    """Allow at most `max_requests` in the trailing `window_seconds` for this
    IP + bucket. Raises HTTP 429 (with Retry-After) when exceeded."""
    key = f"{bucket}:{client_ip(request)}"
    now = time.monotonic()
    with _lock:
        dq = _hits[key]
        cutoff = now - window_seconds
        while dq and dq[0] < cutoff:
            dq.popleft()
        if len(dq) >= max_requests:
            retry = int(dq[0] + window_seconds - now) + 1
            raise HTTPException(
                status_code=429,
                detail=f"Too many requests. Please wait {retry}s and try again.",
                headers={"Retry-After": str(retry)},
            )
        dq.append(now)


def check_lockout(email: str) -> None:
    """Raise HTTP 429 if this account is currently locked from failed logins."""
    key = email.lower()
    now = time.monotonic()
    with _lock:
        until = _locked_until.get(key)
        if until and now < until:
            minutes = int(until - now) // 60 + 1
            raise HTTPException(
                status_code=429,
                detail=f"Too many failed attempts. This account is locked for about {minutes} minute(s).",
                headers={"Retry-After": str(int(until - now) + 1)},
            )


def record_failed_login(email: str) -> None:
    """Count one failed login; lock the account once it crosses the threshold."""
    key = email.lower()
    now = time.monotonic()
    with _lock:
        dq = _failed_logins[key]
        cutoff = now - _FAIL_WINDOW
        while dq and dq[0] < cutoff:
            dq.popleft()
        dq.append(now)
        if len(dq) >= _MAX_FAILS:
            _locked_until[key] = now + _LOCK_DURATION
            dq.clear()


def reset_failed_login(email: str) -> None:
    """Clear the failure count + any lock after a successful login."""
    key = email.lower()
    with _lock:
        _failed_logins.pop(key, None)
        _locked_until.pop(key, None)


def _reset_all_for_tests() -> None:
    """Test hook: wipe counters so tests don't leak state into each other."""
    with _lock:
        _hits.clear()
        _failed_logins.clear()
        _locked_until.clear()
