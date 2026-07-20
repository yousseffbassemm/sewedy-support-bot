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
- **Backend (FastAPI):** `backend/main.py`, `auth.py`, `db.py`, `email_utils.py`, `llm.py`, `embedding_map.py`,
  `security.py`
- **Frontend (React):** `App.jsx` — landing page, full auth flow, chat interface, English/Arabic (RTL),
  embedding-space visualization, extensive animation work
- **Productionization pass** (post-mentor-scope, all committed on `main`):
  - Reliability: LLM reply/translation caching (LRU) + transient-error retry/backoff (`llm.py`); the
    LLM-free fallback now lists retrieved cases directly or nudges toward a product question, so the bot
    stays useful when Gemini's free-tier daily quota (20/day) is spent.
  - Hardening: per-IP sliding-window rate limiting + account lockout (`security.py`), structured request
    logging, lifespan startup (no deprecation).
  - Answer quality: grounded answers cite the matching Case ID; small talk / off-topic handled
    conversationally; multi-turn conversation memory (recent history sent to the LLM).
  - Feedback loop: 👍/👎 on answers → `POST /feedback` → `Feedback` table; `GET /feedback/stats`.
  - Tests + CI: `tests/test_backend.py` (FastAPI TestClient, mocked model/LLM); GitHub Actions runs the
    suite + the retriever eval gate on push. `Dockerfile`/`docker-compose.yml` package the backend.
  - The tracked repo `App.jsx` is now synced to the real running frontend (`supportbot-ui/src/App.jsx`);
    they had drifted (1141 vs 1835 lines). NOTE: `supportbot-ui/` is still a separate, un-versioned
    project — the only remaining source-of-truth gap.

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
- Tests: 50/50 passing (`test_ingest.py` + `test_retrieve.py` + `test_backend.py`)
- Retriever eval (`eval/eval_set_public.json`, 15 queries): hybrid engine 100% Hit@1 on identifier
  and paraphrase queries, 100% out-of-domain rejection, MRR@5 = 1.000. Run: `uv run python -m eval.eval_retriever`.

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

## Closed since the productionization pass

- ~~Rate limiting / account lockout~~ — DONE (`security.py`).
- ~~Persisted backend pytest suite~~ — DONE (`tests/test_backend.py`, + CI).
- ~~Thumbs-up/down feedback~~ — DONE (`/feedback`, `Feedback` table, UI control).
- ~~Backend error messages English-only in Arabic mode~~ — DONE (frontend error map + Arabic fallback text).
- ~~Retrieval query contextualization~~ — DONE (`_contextualize` in `main.py`): a referring-word follow-up
  now folds in the previous question before searching; self-contained queries are untouched.
- ~~Mobile: sidebar was `display:none` under 900px~~ — DONE (direction-aware slide-in drawer + hamburger).
- ~~Session lost on refresh~~ — DONE (session + language persisted to localStorage).

## UI polish pass (frontend)

- Chat empty-state (brand-arc watermark + hint), warmer layered background, two-layer shadows on
  bubbles/cards, hover lift, unified ghost-button answer toolbar (copy + 👍/👎).
- Keyboard `:focus-visible` rings across buttons/links (the app previously had no visible focus state
  outside inputs), branded `::selection`.
- Fixed: the opening welcome bubble stayed in the old language after toggling EN/AR.

## What's still NOT built

- **Admin case-management UI + re-index endpoint** — the biggest remaining feature. Adding/editing cases is
  still done by hand in `support_cases.csv` + `uv run python -m rag.ingest && ... rag.index`.
- **Dark mode** — deliberately deferred: the palette is spread across inline styles plus many hardcoded
  colours/gradients, so it needs visual iteration to avoid shipping a half-themed UI.
- Voice input.
- Minor Arabic edges: the landing-page mock-chat preview and the (English-only) example-query chips stay
  English by design; in the *offline* fallback the case Problem/Resolution text stays English (the live
  Gemini path translates it). Backend error messages, the fallback bot text, and all UI chrome ARE now
  Arabic.
- Frontend Docker + full-stack `compose` (backend is containerized; `supportbot-ui` is not, since it lives
  outside this repo).

## Repo

- GitHub: https://github.com/yousseffbassemm/sewedy-support-bot
- Branch: `main` (all productionization work is committed here).
- Local project name (`pyproject.toml`): `intern-rag`
- Importable package: `rag` (in `src/rag/`)
- Frontend: separate Vite project (`supportbot-ui`); the tracked repo `App.jsx` is kept in sync with
  `supportbot-ui/src/App.jsx` (the copy that actually runs).
