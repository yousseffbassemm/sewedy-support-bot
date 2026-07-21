"""
backend.auth -- password hashing (bcrypt) + JWT tokens.

SECURITY NOTES (read before trusting this in production):
  - Passwords are hashed with bcrypt via passlib. Plaintext is never stored.
  - Login returns a JWT signed with JWT_SECRET (from .env). The token proves
    identity on later requests without re-sending the password.
  - This is solid for a learning project / internal demo. A hardened prod
    system would add: rate limiting, account lockout, refresh tokens, HTTPS
    enforcement, and a rotated/managed signing secret. Do a security review
    before real employees log in.
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
import jwt  # PyJWT

# --- config from environment -------------------------------------------------
# With JWT_SECRET unset we fall back to a fixed dev secret so a fresh clone
# still runs. That value is PUBLIC -- it is committed right here -- so anyone
# could mint a token for any account with it. Convenient locally, catastrophic
# in production, and the failure is silent: everything works, it is just
# forgeable. So set SUPPORTBOT_ENV=production and the fallback becomes a
# refusal to start instead of a quiet downgrade.
_DEV_SECRET = "dev-insecure-change-me"
JWT_SECRET = os.environ.get("JWT_SECRET", "").strip() or _DEV_SECRET

if JWT_SECRET == _DEV_SECRET and os.environ.get("SUPPORTBOT_ENV", "").lower() == "production":
    raise RuntimeError(
        "JWT_SECRET is unset while SUPPORTBOT_ENV=production. Refusing to start "
        "with the public development signing key -- anyone could forge a login "
        "token. Generate one with: python -c \"import secrets; print(secrets.token_urlsafe(48))\""
    )

JWT_ALG = "HS256"
TOKEN_TTL_HOURS = 24 * 7  # a week


def hash_password(plain: str) -> str:
    """Hash a password with bcrypt. Returns a str safe to store in the DB.

    bcrypt has a hard 72-byte input limit; we encode and truncate defensively
    so very long passwords don't raise (they're simply capped, which bcrypt
    itself does internally anyway)."""
    pw = plain.encode("utf-8")[:72]
    return bcrypt.hashpw(pw, bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8")[:72], hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def create_token(email: str) -> str:
    """Issue a signed JWT identifying the user by email."""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": email,
        "iat": now,
        "exp": now + timedelta(hours=TOKEN_TTL_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def decode_token(token: str) -> Optional[str]:
    """Return the email from a valid token, or None if invalid/expired."""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        return payload.get("sub")
    except jwt.PyJWTError:
        return None
