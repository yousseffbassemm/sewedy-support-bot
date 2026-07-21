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
  - ~~The tracked repo `App.jsx` is synced to the real running frontend; `supportbot-ui/` is still a
    separate, un-versioned project~~ — CLOSED. `supportbot-ui/` now lives INSIDE the repo and is the
    single source of truth; there is no second copy to drift. See "Frontend" under Repo.

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
- Tests: 64/64 passing (`test_ingest.py` + `test_retrieve.py` + `test_backend.py`)
- Retriever eval (`eval/eval_set_public.json`, 15 queries): hybrid engine 100% Hit@1 on identifier
  and paraphrase queries, 100% out-of-domain rejection, MRR@5 = 1.000. Run: `uv run python -m eval.eval_retriever`.

## Correctness + hardening pass (after the web app was reviewed end to end)

Each of these was reproduced first, then fixed, then pinned with a test.

- **Cold start: the first `/chat` took 86 SECONDS.** Measured, not estimated — MiniLM + torch loading
  into memory on first use (the model was already cached; this is load, not download). Every later
  query was well under a second. `_warm_retrieval()` now runs on a **daemon thread** from the lifespan
  hook, so the server accepts connections immediately (verified: `/health` answered in 0.24s mid-warmup)
  and the first real question dropped **86.4s → 2.5s**. Blocking startup instead would just move the
  same wait to boot, and `uvicorn --reload` would pay it on every code change. `SUPPORTBOT_WARMUP=0`
  disables it; the test fixture sets that, or the offline suite would do ~90s of real model work.
- **Arabic follow-ups were searched with Arabic text.** `_contextualize` ran AFTER
  `translate_to_english` but folded in the raw history, which the client stores as the user's typed
  text. It fires *precisely* in the Arabic path: the follow-up translates to English, the English then
  contains a referring word ("it"), which triggers contextualization, which glued the untranslated
  Arabic previous question back on — handing the English-only embedder the mixed-script query that
  translation exists to prevent. The folded-in turn is now translated too.
- **`/auth/me` took the JWT as a query parameter** — a week-long credential in a place that is copied
  by default (access logs, browser history, `Referer`). Now `Authorization: Bearer <token>`; the query
  form no longer authenticates. Safe to change: the frontend never called it (its `api()` is POST-only).
- **`datetime.utcnow()` (deprecated in 3.12) in 6 places.** The naive fix is a trap: the drop-in
  `datetime.now(timezone.utc)` is timezone-AWARE, these values live in naive SQLite columns, and
  comparing the two raises "can't compare offset-naive and offset-aware" — breaking password-reset
  expiry at RUNTIME, not at import. `db.utcnow()` computes in UTC then drops tzinfo, preserving the
  stored representation exactly. Pinned by a reset round-trip + an expired-code test.
- **`/feedback/stats` was public and counted in Python.** Now requires a Bearer token and aggregates
  with a SQL `GROUP BY` (a grouped COUNT returns *no rows* when nothing has been voted on, so the
  zero case is explicitly tested rather than KeyError-ing).
- **`JWT_SECRET` fell back silently** to a value committed in this repo — anyone could forge a token
  for any account, and nothing looked wrong. `SUPPORTBOT_ENV=production` now makes that fallback a
  refusal to start. Verified in all three modes.
- Frontend: chat now surfaces the real message when the backend rate-limits (30/min on `/chat` is
  reachable) instead of a generic "something went wrong", which hid the one useful detail — how long
  to wait. Lint went 8 findings → 2; the 2 left are React effect-timing advisories in working
  animation code, deliberately not refactored days before a presentation.

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
- Signup no longer requires email verification (cut on request) — this is now TRUE of the backend, not just
  the frontend. `/auth/signup` creates the account already verified and returns `{token, username, email}`,
  the same shape as `/auth/login`. The `/auth/verify` endpoint is gone; `is_verified` and the login gate
  stay, so a legacy unverified row is still blocked, and a re-signup on that address reclaims it.
  (Was broken: the frontend read `r.token` from a response that only carried `{ok, message, email_mode}`,
  and every account signup created was unverified — so it could never log in. `tests/test_backend.py` now
  has a signup→login round-trip guard; the old suite missed this because every login test seeded a
  pre-verified user instead of one signup actually created.)
- Signup no longer sends an email at all, which also takes a ~3s blocking SMTP call out of the request path.
  Forgot-password still emails a code, since that's
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
- ~~Dark mode~~ — DONE. My earlier "palette is spread everywhere" estimate was wrong: there were only
  41 hex literals and a central `C` token object. `C`'s values are now `var(--c-*)` references, so a theme
  switch is one attribute flip on `<html>` with no React re-render and no second palette to maintain.

## Dark mode — the non-obvious parts

- **Alpha bases are split in two.** `--c-shadow-rgb` (26,26,26 → 0,0,0) and `--c-tint-rgb` (26,26,26 →
  255,255,255) must move in *opposite* directions: a shadow deepens on a dark surface while an overlay
  tint has to lighten to stay visible. Blanket-replacing every `rgba(26,26,26,α)` gets the two hover/wash
  fills wrong.
- **`--c-inkSurface` is not `--c-ink`.** The user chat bubble and nav-hover use ink as a *surface* with
  white text. On dark, ink inverts to near-white — white text on a white bubble. It gets its own token.
- **`--c-redSurface` is not `--c-red`.** Filled buttons keep true `#E30613` in dark mode; the lifted
  `#FF4B57` is text/border only, because white on `#FF4B57` is 3.3:1 and button labels are too small to
  count as large text. `#E30613` holds white at 4.9:1 and still reads 3.8:1 against the dark page.
- **`@import` must stay the first rule.** `THEME_CSS` is injected *after* the Cairo `@import` in
  `GlobalStyle`; putting it before silently kills the Arabic font.
- **`index.html` carries a pre-paint inline script** that sets `data-theme` before React mounts, plus a
  bootstrap background rule. Without it dark-mode users get a white flash, since the stylesheet lives
  inside the React tree. It must stay in sync with `initialTheme()` (same key, same JSON encoding).
- OS preference is honoured only as a *default*; an explicit toggle is stored and wins permanently.
- Verified: all 20 tokens defined symmetrically in both themes, no undefined/dead tokens, and WCAG AA
  contrast checked on every key text/surface pair in both palettes.

## UI polish pass (frontend)

- Chat empty-state (brand-arc watermark + hint), warmer layered background, two-layer shadows on
  bubbles/cards, hover lift, unified ghost-button answer toolbar (copy + 👍/👎).
- Keyboard `:focus-visible` rings across buttons/links (the app previously had no visible focus state
  outside inputs), branded `::selection`.
- Fixed: the opening welcome bubble stayed in the old language after toggling EN/AR.

## What's still NOT built

- **Admin case-management UI + re-index endpoint** — the biggest remaining feature. Adding/editing cases is
  still done by hand in `support_cases.csv` + `uv run python -m rag.ingest && ... rag.index`.
- Voice input.
- Minor Arabic edges: the landing-page mock-chat preview and the (English-only) example-query chips stay
  English by design; in the *offline* fallback the case Problem/Resolution text stays English (the live
  Gemini path translates it). Backend error messages, the fallback bot text, and all UI chrome ARE now
  Arabic.
- Frontend Docker + full-stack `compose` (backend is containerized; `supportbot-ui` is not). The old
  blocker — the UI living outside the repo — is gone, so this is now just unwritten, not impossible.

## Repo

- GitHub: https://github.com/yousseffbassemm/sewedy-support-bot — **public**, and as of
  2026-07-22 actually pushed. It had never been: `origin` pointed at a repo that did not exist,
  and 39 commits were sitting local-only. CI (tests + the retriever eval gate) is green on `main`.
- Branch: `main` (all productionization work is committed here). `feature/webapp` is fully merged
  into `main` (no unique commits) and was deliberately NOT pushed — it would only be a stale
  duplicate. Its local upstream (`origin/feature/webapp`) no longer exists.
- **Not published** (git-ignored, verified absent from the remote after pushing): `backend/.env`,
  `backend/data/app.db` (real accounts + bcrypt hashes), and the three `presentation/*.pptx`.
- **Is published, knowingly:** the screenshots in `presentation/screenshots/` show the chat sidebar,
  which renders `ybassem2006@gmail.com`. Flagged before pushing; keeping them was a deliberate
  choice. Recapturing against a demo account is the fix if that changes — the images are pixels, so
  no text search will ever surface this.
- Local project name (`pyproject.toml`): `intern-rag`
- Importable package: `rag` (in `src/rag/`)
- Frontend: `supportbot-ui/` — a real Vite project **inside this repo**, React 19 + Vite 8.
  `cd supportbot-ui && npm install && npm run dev` (port 5173; the backend CORS allowlist names that
  exact origin). There is no longer a root `App.jsx`: it moved to `supportbot-ui/src/App.jsx`, which is
  now the only copy. `logo.png`/`logo-dark.png` moved to `supportbot-ui/public/`.
  - HISTORY (so the old layout isn't reintroduced): the UI used to live at `C:\Users\DELL\supportbot-ui`,
    a *sibling* of the repo, with only `App.jsx` copied in and hand-synced. Nothing else — `index.html`,
    `main.jsx`, `index.css`, `package.json`, the logos' generator path — was versioned, so a fresh clone
    could not run the frontend at all. `tools/make_dark_logo.py` still pointed at `ROOT.parent`, a path
    that only resolved on the one machine with that sibling layout; it now points at `ROOT`.
  - Deliberately NOT carried over from the old project: `src/App.css`, `src/assets/` (hero.png, react.svg,
    vite.svg) and `public/icons.svg` — all verified unreferenced Vite-template leftovers.
  - `index.html` holds the pre-paint theme script; its bootstrap background values (`#FAFAF8` light,
    `#131211` dark) must match `--c-paper` in each theme in `App.jsx`.
