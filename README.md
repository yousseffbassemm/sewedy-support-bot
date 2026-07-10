# sewedy-support-bot — RAG SupportBot + Web App

An educational, enterprise-style Retrieval-Augmented-Generation "SupportBot." Started as a Day 1+2
instructor-reference RAG pipeline (ingestion → embeddings → indexing → retrieval); has since grown into a
full web application: a FastAPI backend with real authentication and Gemini-powered grounded answers, and a
polished React frontend with English/Arabic support.

> **Scope note:** the RAG pipeline (`src/rag/`) is the reviewed, verified Day 1+2 deliverable. Everything
> under `backend/` and the React frontend is built on top of it, past the original assignment scope — see
> `CLAUDE.md` for the current status and what still needs mentor sign-off.

## What's in here

| Layer | What it does |
|---|---|
| **RAG pipeline** (`src/rag/`) | CSV → clean/labelled JSONL → MiniLM embeddings → ChromaDB → semantic search |
| **Backend** (`backend/`) | FastAPI: real auth (bcrypt + JWT + SQLite), Gemini-grounded chat, embedding-space visualization, Gmail password reset |
| **Frontend** (React, `App.jsx`) | Landing page, auth flow, chat interface — English + Arabic (RTL), fully animated |

## Corpus

A knowledge base of resolved device support cases. Source schema:

```
case_id, product, category, problem, cause, resolution
```

Ingestion derives a labelled `text` field per row (`Product: … / Category: … / Problem: … / Cause: … /
Resolution: …`, empty sections skipped) — that is the document we embed.

**Known data gap (found during testing, not a code bug):** two complaint types have zero resolved cases
anywhere in the corpus — "configuration resets after power cycle" (5 tickets, across 5 products) and "wrong
serial number" (3 tickets). If real-world resolutions exist for these, add them to `support_cases.csv` and
re-run `rag.ingest` + `rag.index` — no amount of prompting fixes a fact that was never recorded.

## Part 1 — The RAG pipeline

### Requirements
- Windows / macOS / Linux, **Python 3.11**, and [**uv**](https://docs.astral.sh/uv/).
- Everything runs locally. MiniLM (~90 MB) downloads on first use.

### Setup

```bash
uv python pin 3.11
uv sync
```

### Usage

```bash
uv run python -m rag.config                       # print validated settings
uv run python -m rag.ingest                       # → data/cases_clean.jsonl + data/review_queue.jsonl
uv run python -m rag.index                        # embed + persist into data/chroma/
uv run python -m rag.retrieve "readings drift higher after installation"
uv run pytest -q                                  # fast offline unit tests
```

**Quality gates:** `missing_case_id`, `empty_problem`, `no_resolution`, `duplicate_case_id`. Current corpus:
**69 rows → 57 clean / 12 review** (all 12 rejected for `no_resolution`).

## Part 2 — The backend (FastAPI)

Wraps the RAG pipeline behind a real API, adds accounts, and adds an LLM answer-writing layer.

### Endpoints

| Endpoint | What it does |
|---|---|
| `GET /health` | liveness + email mode (`console` or `gmail`) |
| `POST /search` | raw semantic search, no LLM |
| `POST /chat` | real RAG: retrieve → filter weak matches → Gemini writes a grounded reply |
| `POST /embedding_map` | PCA/SVD-projected 2D view of the real embedding space, for the "see how this was found" panel |
| `POST /auth/signup` | create account (bcrypt-hashed password, JWT returned immediately — no email step) |
| `POST /auth/login` | check password, return JWT |
| `POST /auth/forgot` / `POST /auth/reset` | email (or console-print) a 6-digit code, confirm + set new password |
| `GET /auth/me` | who am I, from JWT |

### Setup

```bash
uv add fastapi "uvicorn[standard]" sqlmodel bcrypt pyjwt "pydantic[email]" python-dotenv google-genai
cp backend/.env.example backend/.env
python -c "import secrets; print(secrets.token_urlsafe(48))"   # → paste into .env as JWT_SECRET
```

Fill in `backend/.env`:
```
JWT_SECRET=<generated above>
GEMINI_API_KEY=<from https://aistudio.google.com/apikey — free tier available>
GMAIL_ADDRESS=                # optional — leave blank for console-mode password reset codes
GMAIL_APP_PASSWORD=           # optional — needs 2-Step Verification + an App Password
```

Run it (from the project root, so `rag` imports cleanly):
```bash
uv run uvicorn backend.main:app --reload --port 8000
```

### Key design points
- **`/chat` never crashes on LLM failure** — falls back to a plain retrieval-only message if Gemini is
  unavailable (no key, rate limit, network).
- **Distance-threshold grounding guard** (`GOOD_MATCH_MAX_DISTANCE = 0.65` in `main.py`) — Gemini is never
  shown a retrieved case whose cosine distance says it isn't actually relevant. This is enforced in code,
  not just prompted for.
- **Non-English queries are translated before retrieval** (`backend/llm.py::translate_to_english`) — MiniLM
  is an English-only embedder, so an Arabic query embedded directly produces a near-meaningless vector.
  Retrieval uses the English translation; the final reply still answers in the user's original language.
- **Security honesty:** bcrypt + JWT + `.env` secrets is solid for a learning project / internal demo. It is
  **not** hardened for production — no rate limiting, no account lockout, no HTTPS enforcement. Don't put
  real employee credentials behind it without a security review first.

## Part 3 — The frontend (React)

Single-file React app (`App.jsx`) — landing page, auth flow, and chat interface, in English and Arabic.

### Setup
```bash
npm create vite@latest supportbot-ui -- --template react
cd supportbot-ui && npm install
cp App.jsx src/App.jsx
npm run dev
```

### Features
- **Landing page** — animated hero, rotating live-demo chat preview, "how it works" / "coverage" sections
  with scroll-triggered reveals
- **Auth** — real signup/login/forgot-password against the backend, with a smooth crossfade between modes
- **Chat** — real Gemini-grounded answers; a "searching by meaning" indicator; a **"see how this was found"**
  disclosure showing the actual PCA-projected embedding space (your real corpus vectors, plotted, with the
  query and retrieved matches highlighted) — the one feature that shows the underlying RAG concept visually
  instead of just describing it
- **English / Arabic (RTL)** — full UI translation, Cairo font for Arabic, direction-aware layout. Example
  queries stay in English on purpose (the search backend is English-only; translated example queries would
  silently stop working when clicked)

## Layout

```
config/rag.yaml                     typed, non-secret RAG settings
data/                                inputs + outputs (data/chroma/, data/support_cases.csv, etc.)
src/rag/                             Day 1+2 pipeline (ingest, embeddings, index, retrieve, config)
backend/
  main.py                           FastAPI app — all endpoints
  auth.py                           bcrypt + JWT
  db.py                             SQLModel User table (SQLite)
  email_utils.py                    Gmail SMTP with console fallback
  llm.py                            Gemini grounded replies + query translation
  embedding_map.py                  PCA/SVD projection of the real embedding space
App.jsx                              full React frontend (landing + auth + chat)
tests/test_ingest.py                 pure-function unit tests (Day 1)
CLAUDE.md                            project memory / current status (single source of truth)
DESIGN.md                            decisions, tradeoffs, bugs found and fixed
SETUP_GUIDE.md                       step-by-step: get the whole stack running from scratch
```
