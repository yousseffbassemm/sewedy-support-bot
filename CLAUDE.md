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
- Clean (searchable): 66 → `data/cases_clean.jsonl`
- Review queue (excluded from search): 3 → `data/review_queue.jsonl` — the 3 remaining rows
  are genuinely unresolvable (no cause, vague one-line problem like "Customer unhappy with the
  unit"); they are the quality gate working as intended, not a gap to fill.
- Duplicates found: 0
- Embedding provider: `local` (MiniLM, `all-MiniLM-L6-v2`), 384-dim
- Vector store: ChromaDB, persistent, `data/chroma/`, collection `support_cases`
- Answer generation: Gemini (`gemini-2.5-flash`), thinking disabled, grounding threshold 0.65 cosine distance
- Tests: 35/35 passing (`tests/test_ingest.py` + `tests/test_retrieve.py`)
- Retriever eval (`eval_set_public.json`, 15 queries): hybrid engine 100% Hit@1 on identifier
  and paraphrase queries, 100% out-of-domain rejection, MRR@5 = 1.000.

## Known data-quality findings (from real testing, not code bugs)

- **RESOLVED — "Configuration resets after power cycle"** (5 tickets: PowerTrack P1, GridLink Hub ×2,
  ThermoNode T5, FlowMeter X100) and **"Wrong serial number"** (3 tickets: FlowMeter X100, AeroSense G3 ×2)
  and **"Hub drops its devices after a reboot"** (1 ticket, GridLink Hub) had no logged resolution and were
  held out of the index. Each had a clear logged *cause*, so a matching resolution was added to
  `support_cases.csv` and the corpus was re-ingested/re-indexed. All 9 are now searchable and retrieve
  grounded answers (verified: distances 0.26–0.35). Searchable corpus went 57 → 66; review queue 12 → 3.
- Product-name casing (`aerosense g3`, `FLOWMETER x100`) is **already normalised at ingest** by the
  majority-vote canonicaliser in `ingest.py` — the clean corpus shows the canonical spelling; not a gap.
- The 3 rows still in the review queue (`8820-7750`, `8821-7751`, `8822-7752`) have no cause and a vague
  one-line problem; there is nothing specific to resolve, so they stay gated by design.

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
- **BM25 stopword filtering** (`_tokenize_bm25` in `retrieve.py`): the keyword half now drops English
  function words and the domain-generic subject nouns "device"/"unit" before scoring. These appear in nearly
  every case, and because BM25 rewards them like any token, a shared filler word could cast a spurious keyword
  vote in RRF. This fixed a real fusion regression — "the device is completely dead and won't power up" used
  to retrieve a *no-display* case over the correct *does-not-power-on* one. Semantic search and the product-name
  detector still use the original `_tokenize`, so the G2-vs-G3 model-number disambiguation is untouched.

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
