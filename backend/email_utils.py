"""
backend.email_utils -- send verification / reset codes by email.

Two modes, chosen automatically:
  1. REAL  -- if GMAIL_ADDRESS and GMAIL_APP_PASSWORD are set in .env, sends
              via Gmail SMTP.
  2. CONSOLE -- otherwise, prints the code to the server terminal so you can
              develop and test the whole flow without any email setup.

To enable real email you need a Gmail APP PASSWORD (not your normal password):
  - Turn on 2-Step Verification on your Google account.
  - Google Account -> Security -> App passwords -> generate one for "Mail".
  - Put the 16-char value in .env as GMAIL_APP_PASSWORD (no spaces).
The app password is a SECRET: keep it only in .env (git-ignored), never commit
it, and revoke it from your Google account if it ever leaks.
"""

from __future__ import annotations

import os
import smtplib
from email.message import EmailMessage

GMAIL_ADDRESS = os.environ.get("GMAIL_ADDRESS", "").strip()
GMAIL_APP_PASSWORD = os.environ.get("GMAIL_APP_PASSWORD", "").strip()

_REAL = bool(GMAIL_ADDRESS and GMAIL_APP_PASSWORD)


def email_mode() -> str:
    return "gmail" if _REAL else "console"


def send_code(to_email: str, code: str, kind: str) -> None:
    """Send (or print) a 6-digit code. kind is 'verify' or 'reset'."""
    subject = (
        "Your SupportBot verification code"
        if kind == "verify"
        else "Your SupportBot password reset code"
    )
    action = "verify your email" if kind == "verify" else "reset your password"
    body = (
        f"Your SupportBot code to {action} is:\n\n"
        f"    {code}\n\n"
        f"It expires in 10 minutes. If you didn't request this, ignore this email."
    )

    if not _REAL:
        # Console fallback -- visible in the terminal running uvicorn.
        print("\n" + "=" * 52)
        print(f"[email:console] to={to_email}  kind={kind}")
        print(f"[email:console] CODE = {code}")
        print("=" * 52 + "\n")
        return

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = GMAIL_ADDRESS
    msg["To"] = to_email
    msg.set_content(body)

    # Gmail SMTP over SSL.
    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
        server.login(GMAIL_ADDRESS, GMAIL_APP_PASSWORD)
        server.send_message(msg)
    print(f"[email:gmail] sent {kind} code to {to_email}")
