# SETUP_GUIDE.md — get the whole stack running from scratch

This covers three layers: the RAG pipeline (Day 1+2), the FastAPI backend, and the React frontend. Do them
in order — each depends on the one before it.

> **Scope note:** the backend and frontend are past the original Day 1+2 assignment scope. Build them on a
> branch (`git checkout -b feature/webapp`) so `main` stays at the clean, mentor-reviewable Day 2 state.

---

## Part 1 — RAG pipeline

Already covered in full in `README.md`. Quick version:

```bash
uv python pin 3.11
uv sync
uv run python -m rag.ingest      # → 57 clean / 12 review
uv run python -m rag.index       # → data/chroma/
uv run python -m rag.retrieve "readings drift higher after installation"
uv run pytest -q                 # → 10 passed
```

Confirm this works and matches the numbers above before moving on — the backend depends on `data/chroma/`
already existing.

---

## Part 2 — Backend (FastAPI)

### 1. Install dependencies

```bash
uv add fastapi "uvicorn[standard]" sqlmodel bcrypt pyjwt "pydantic[email]" python-dotenv google-genai
```

### 2. Set up secrets

```bash
cp backend/.env.example backend/.env
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Paste that generated string into `backend/.env` as `JWT_SECRET`. Then fill in:

```
JWT_SECRET=<generated above>
GEMINI_API_KEY=<get one free at https://aistudio.google.com/apikey>
GMAIL_ADDRESS=
GMAIL_APP_PASSWORD=
```

Leave the two Gmail lines blank for now — the backend runs in **console mode** without them (password reset
codes print to the terminal instead of emailing). See Part 4 below to turn on real email later.

### 3. Run it

From the **project root** (so `backend/main.py` can import the `rag` package):

```bash
uv run uvicorn backend.main:app --reload --port 8000
```

Watch for:
```
[startup] SupportBot API ready. email mode = console
```

Test it: `http://localhost:8000/health` should return `{"status":"ok","email_mode":"console"}`.

### 4. Verify the real endpoints work

```bash
curl -X POST http://localhost:8000/chat -H "Content-Type: application/json" \
  -d '{"query": "readings drift higher after installation"}'
```

Should return a JSON response with a `reply` (Gemini-written, grounded in your real cases) and `hits` (the
actual retrieved cases with real cosine distances).

---

## Part 3 — Frontend (React + Vite)

### 1. Install Node.js (if needed)

Download the **LTS** version from https://nodejs.org/. Confirm with `node --version` and `npm --version`.

### 2. Scaffold the project

```bash
npm create vite@latest supportbot-ui -- --template react
cd supportbot-ui
npm install
```

### 3. Drop in the real app

```bash
cp /path/to/App.jsx src/App.jsx
```

### 4. Clean up Vite's default styling

Vite's default `src/index.css` sets a `max-width` and padding on `#root` that fights with this app's own
layout. Replace its contents with:

```css
* { box-sizing: border-box; }
html, body, #root { margin: 0; padding: 0; width: 100%; min-height: 100%; }
body { min-height: 100vh; }
```

### 5. Run it

```bash
npm run dev
```

Open the printed URL (usually `http://localhost:5173`). With the backend also running (Part 2), you should
be able to sign up, log in, and chat with real answers.

---

## Part 4 (optional) — Real email for password reset

Only needed if you want reset codes actually emailed instead of printed to the backend terminal:

1. Turn on **2-Step Verification**: https://myaccount.google.com/security
2. Generate an **App Password**: https://myaccount.google.com/apppasswords
3. Add to `backend/.env`:
   ```
   GMAIL_ADDRESS=youremail@gmail.com
   GMAIL_APP_PASSWORD=<16-character app password, no spaces>
   ```
4. Restart the backend — startup line should now say `email mode = gmail`.

The app password is a real secret: never commit it, and revoke it from your Google account if it ever leaks.

---

## Running both machines / switching computers

Standard git flow — nothing special beyond the usual:

```bash
# leaving a machine
git add . && git commit -m "..." && git push

# arriving at a machine
git pull
uv sync                          # if pyproject.toml/uv.lock changed
uv run python -m rag.index       # if cases_clean.jsonl changed and data/chroma/ doesn't exist locally
```

`data/chroma/`, `backend/data/app.db`, `backend/.env`, and `node_modules/` are all git-ignored — they're
either regenerable or secrets, not meant to be committed.

---

## What's real vs. demo, at a glance

| Piece | Status |
|---|---|
| Semantic search | Real — your MiniLM + ChromaDB, actual cosine distances |
| User accounts | Real — SQLite, persist across restarts |
| Passwords | Real — bcrypt-hashed, never stored plain |
| Login sessions | Real — signed JWT tokens |
| Password-reset codes | Real in Gmail mode; console-printed otherwise |
| Gemini-written answers | Real — grounded in retrieved cases, with a code-level relevance filter |
| Embedding-space visualization | Real — actual PCA/SVD projection of your real corpus vectors |
| Arabic translation | Real for UI text; example queries and backend error messages stay English (see `DESIGN.md` §17) |
| Rate limiting / account lockout | **Not implemented** — known gap, see `CLAUDE.md` |
