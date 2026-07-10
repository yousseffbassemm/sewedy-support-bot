# CLAUDE.md — project memory / build status

Single source of truth for where this project stands. Update this after each phase.

## Current phase

**Day 1+2 (RAG pipeline): complete, verified, matches mentor reference exactly.**
**Web app (backend + frontend): built and functioning on top of Day 1+2, past the original assignment
scope.** Built on the `feature/webapp` branch — `main` stays at the clean, mentor-reviewable Day 2 state.

**Mentor sign-off status: not yet confirmed for anything beyond Day 2.** This has been flagged repeatedly
during the build. Given the graduation deadline, it's worth showing the mentor the web app soon to find out
whether continued extension or consolidating/presenting what exists is the better use of remaining time.

## What's built

- **Day 1 (ingestion):** `src/rag/config.py`, `src/rag/ingest.py`, `tests/test_ingest.py`
- **Day 2 (embeddings + index + retrieve):** `src/rag/embeddings.py`, `src/rag/index.py`, `src/rag/retrieve.py`
- **Backend (FastAPI):** `backend/main.py`, `auth.py`, `db.py`, `email_utils.py`, `llm.py`, `embedding_map.py`
- **Frontend (React):** `App.jsx` — landing page, full auth flow, chat interface, English/Arabic (RTL),
  embedding-space visualization, extensive animation work

## Key numbers (current corpus)

- Raw CSV: 69 rows
- Clean (searchable): 57 → `data/cases_clean.jsonl`
- Review queue (no resolution, excluded from search): 12 → `data/review_queue.jsonl`
- Duplicates found: 0
- Embedding provider: `local` (MiniLM, `all-MiniLM-L6-v2`), 384-dim
- Vector store: ChromaDB, persistent, `data/chroma/`, collection `support_cases`
- Answer generation: Gemini (`gemini-2.5-flash`), thinking disabled, grounding threshold 0.65 cosine distance
- Tests: 10/10 passing (`tests/test_ingest.py`)

## Known data-quality findings (from real testing, not code bugs)

- **"Configuration resets after power cycle"** — 5 tickets across 5 different products (PowerTrack P1,
  GridLink Hub ×2, ThermoNode T5, FlowMeter X100), **zero have a logged resolution**. Correctly excluded from
  the searchable index by the `no_resolution` gate — but this means the system genuinely cannot answer this
  exact, common-sounding complaint correctly. If a real-world fix exists, add it to `support_cases.csv` and
  re-index.
- **"Wrong serial number"** — 3 tickets (FlowMeter X100, AeroSense G3 ×2), same situation: zero resolutions.
- Minor: a few rows have inconsistent product-name casing (`aerosense g3`, `FLOWMETER x100` instead of proper
  case) — cosmetic, worth a data-cleanup pass.
- The landing page's product-coverage chips and the chat sidebar's example-question suggestions were updated
  to avoid the two gaps above (they used to point at unresolvable questions).

## Decisions log

- Switched vector store from the course skeleton's Qdrant to **ChromaDB** — see `DESIGN.md` §7.
- `REQUIRE_RESOLUTION = True` in `ingest.py` — a case with no fix has nothing to retrieve, so it's routed to
  review instead of indexed. This design choice is what surfaced the data gaps above instead of hiding them.
- Chose **Gemini** (not Claude/OpenAI) for answer generation, on request. Free tier available.
- Auth is real (bcrypt + JWT + SQLite) but explicitly not hardened for production — see `DESIGN.md` §8.
- Signup no longer requires email verification (cut on request); forgot-password still does, since that's
  the security-critical path.
- Added a **code-level distance threshold** (not just prompt instructions) to stop the LLM from grounding
  answers in irrelevant or wrong-problem cases — see `DESIGN.md` §12 for the two real failure modes this
  fixes.
- Added **query translation before retrieval** for non-English input, since the embedder is English-only and
  was producing near-random retrieval for Arabic queries — see `DESIGN.md` §13.
- Embedding-space visualization uses raw numpy SVD, not scikit-learn — one fewer dependency, transparent math.

## What's intentionally NOT built

- Rate limiting / account lockout on auth endpoints (known security gap, flagged, not yet closed)
- A persisted `pytest` suite for the backend (verified extensively by hand during development, not yet
  written as a committed test file the way `test_ingest.py` is)
- Translation of backend-returned error messages (API error strings are still English-only even in Arabic
  mode)
- Voice input, thumbs-up/down feedback on answers (proposed, not built — Arabic support was built first)

## Repo

- GitHub: https://github.com/yousseffbassemm/sewedy-support-bot
- Branch: `feature/webapp` (web app work) — keep `main` at the clean Day 2 state for mentor review
- Local project name (`pyproject.toml`): `intern-rag`
- Importable package: `rag` (in `src/rag/`)
- Frontend: separate Vite project (`supportbot-ui`), `App.jsx` copied in from this repo's root
