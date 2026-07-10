# DESIGN.md — why each decision was made

## Part 1 — RAG pipeline (Day 1+2)

### 1. Config vs. secrets split

`config/rag.yaml` holds every non-secret knob (provider, model name, top_k, paths). `.env` (git-ignored)
holds only credentials. **Why:** YAML is meant to be committed and reviewed; secrets committed to git are a
permanent leak even after deletion. Splitting them means the config file is always safe to share or screenshot.

### 2. Quality gates + review queue (never silently drop rows)

Every row that fails a gate (`missing_case_id`, `empty_problem`, `no_resolution`, `duplicate_case_id`) is
routed to `review_queue.jsonl` with its original data intact plus a `reject_reason` — never just discarded.
**Why:** silently dropped data is invisible data loss.

**This paid off in practice:** grouping the 12 rejected rows by complaint type later revealed two systematic
gaps — "config resets after power cycle" (5 tickets) and "wrong serial number" (3 tickets) — neither has a
single resolved case anywhere in the corpus. If we'd just filtered these out with `df.dropna()` instead of
routing them to a visible review queue, this gap would have been invisible instead of a concrete, actionable
finding.

### 3. Labelled text, not raw concatenation

`build_text()` produces `Product: … / Category: … / Problem: … / Cause: … / Resolution: …`, not raw fields
glued together. **Why:** a labelled field carries a stronger, more distinct signal in vector space, and it
makes the stored `document` human-readable for debugging retrieval directly in the database.

### 4. The embedder abstraction (`Protocol` + factory)

`Embedder` is a `Protocol` with `.dimension` and `.embed()`. `get_embedder(cfg)` is the *only* place that
branches on provider (local MiniLM vs. Azure). **Why:** every downstream module calls `.embed()` without
caring which backend is behind it.

### 5. The dimension guard

`_get_collection()` stamps the embedder's vector dimension into the collection's metadata at creation, and
refuses to reuse a collection whose stored dimension doesn't match. **Why:** mixing 384-dim MiniLM vectors
with 1536-dim Azure vectors in one collection isn't just wrong, it's meaningless — there's no valid distance
between vectors of different dimensionality.

### 6. Idempotent indexing (`upsert`, not `add`)

Running `rag.index` twice overwrites existing `case_id`s instead of duplicating them. **Why:** pipelines get
re-run during development; idempotency means "just run it again" is always a safe answer.

### 7. Vector store: ChromaDB, not Qdrant

The course's generic skeleton uses Qdrant (client/server). This project uses ChromaDB — embedded, in-process,
no separate service to run. **Why here:** for a single-developer, fully-local educational build, removing an
entire class of setup friction (no Docker, no host/port config) is worth more than Qdrant's extra features.

---

## Part 2 — Backend (FastAPI web app)

### 8. Real accounts, not a demo — but honestly-scoped security

Passwords are bcrypt-hashed (never stored plain), sessions are signed JWTs, secrets live only in `.env`.
**This is solid for a learning project / internal demo. It is not hardened for production** — no rate
limiting, no account lockout, no HTTPS enforcement, no refresh tokens. Stated explicitly in code comments and
here so it's never mistaken for more than it is.

**Bug found and fixed:** originally used `passlib`'s bcrypt backend, which is incompatible with `bcrypt` 4.x+
(passlib 1.7.4 predates that major version and references a removed internal attribute). Switched to calling
`bcrypt` directly — simpler, no version-shim problems, same security property (salted, slow hash).

**Bug found and fixed:** `.env` was installed as a dependency (`python-dotenv`) but never actually loaded —
`load_dotenv()` was never called anywhere. This "worked" for `JWT_SECRET` only because `auth.py` has a silent
fallback default, which masked the bug until a setting with no fallback (`GEMINI_API_KEY`) exposed it. Fixed
by calling `load_dotenv()` at the very top of `main.py`, before any other `backend.*` import — several
modules read environment variables at *import time* (not inside a function), so the order matters: `.env`
must be loaded before those modules are imported, not just before they're used.

### 9. Signup without email verification (a deliberate simplification)

Signup originally required a 6-digit emailed code before an account was created — matching what a "real"
signup usually does. This was cut on request: signup now creates the account and returns a token immediately.
**Trade-off:** an unverified account could theoretically be created with an email you don't own. Forgot-
password still requires a real emailed code, which is the security-critical path (unauthorized password
reset) — signup verification was the lower-stakes one to cut.

### 10. Gemini over Claude for answer generation

Chosen when the person building this specifically requested Gemini. Implementation detail worth flagging:
uses the current `google-genai` SDK (`from google import genai`), not the older, deprecated
`google-generativeai` package that a lot of existing tutorials still show.

**Bug found and fixed:** Gemini 2.5 Flash has "thinking" (internal reasoning) on by default, and thinking
tokens are deducted from the *same* `max_output_tokens` budget as the visible reply. With a low budget (300),
thinking silently consumed most of it, truncating real answers mid-sentence — a genuinely confusing failure
mode with no error anywhere. Fixed with `thinking_config=types.ThinkingConfig(thinking_budget=0)`: this task
(short grounded Q&A) doesn't need multi-step reasoning, so the full budget goes to the actual answer.

### 11. Never crash the chat over LLM failure

`/chat` wraps `generate_reply()` in a broad `except Exception`, falling back to a plain retrieval-only
message if Gemini is unreachable for any reason. **Why:** an LLM call is an external dependency (network,
rate limits, API changes) that shouldn't be able to take down the whole feature — the retrieval half of the
system is still fully local and should keep working even if the generation half doesn't.

### 12. A code-level guard against hallucination, not just a prompt request

Early testing surfaced two real failure modes:
- **Cross-case blending:** Gemini describing an invented narrative that combined details from two different
  retrieved cases ("we've seen this with Product A and Product B...") when only one case actually matched.
- **Wrong-case substitution:** for a query whose true matching case had no resolution (see the corpus gap
  above), Gemini presented a *different* case's resolution — same product, different specific problem — as
  if it applied.

Prompting alone ("don't invent things") reduced but didn't eliminate this. The fix that actually holds is a
**code-level distance threshold** (`GOOD_MATCH_MAX_DISTANCE = 0.65` in `main.py`): any retrieved case whose
cosine distance exceeds this is filtered out *before* it ever reaches Gemini's context. It's not asked to
ignore weak matches — it structurally never receives them. The raw, unfiltered top-5 still comes back in the
API response so the "see how this was found" panel stays honest about what was actually searched.

This is paired with (not replaced by) a stricter system prompt: ground on only the single closest case unless
a second is genuinely needed, never blend across cases, and explicitly check whether the retrieved case's own
stated problem matches the user's — same product with a *different* symptom is not a match. The threshold
catches wildly irrelevant cases; the prompt catches "close in embedding space, wrong in reality" cases that a
numeric cutoff alone can't distinguish.

### 13. Query translation before retrieval, for non-English queries

MiniLM (the embedder) was trained almost entirely on English text. Embedding an Arabic query with it does
**not** produce a vector that meaningfully represents the query relative to the English-embedded corpus — the
"closest matches" ChromaDB returns for an Arabic query are close to random, not actually relevant. This
produced confusing, wrong-looking answers with no error anywhere, which is worse than an outright failure.

**Fix:** detect non-Latin script with a cheap local regex check (no API call, so English queries — the
common case — pay zero extra cost or latency). For text that needs it, translate to English with a fast, low-
temperature Gemini call *before* calling `semantic_search`. The original, untranslated query is still what
goes to `generate_reply`, so the final answer is in the user's own language — only retrieval uses the English
version. Translation is best-effort: if it fails for any reason, retrieval falls back to the raw query rather
than crashing.

### 14. Embedding-space visualization: numpy, not scikit-learn

`backend/embedding_map.py` projects the corpus's real 384-dim vectors to 2D for the "see how this was found"
panel. Implemented with plain numpy SVD rather than adding `scikit-learn` as a dependency. **Why:** one fewer
dependency, and the math is transparent rather than hidden behind a library call — appropriate for a project
whose whole point is understanding what's actually happening, not just importing a black box. The projection
is fit once on the corpus and cached; a new query is projected into that *same* fitted space, which is what
makes the query point and corpus points genuinely comparable on the plot (verified: projecting a vector
identical to one already in the corpus lands back at the same 2D point to floating-point precision).

**Honesty built into the feature itself:** the panel's caption states plainly that 384→2 dimensions loses
information, and that the plot approximates but doesn't replace the real cosine search happening in full
dimensionality.

---

## Part 3 — Frontend (React)

### 15. Real backend, not mocked, from the start of frontend work

The frontend was built directly against the real API (no demo-mode retrieval, no fake auth) once the backend
existed, specifically to avoid the trap of a frontend that "looks done" but doesn't actually work end to end.

### 16. Restraint: one signature visual element, not maximal decoration

Per general UI design guidance: spend boldness in one deliberate place, keep the rest quiet. The signature
element here is the **embedding-space visualization** — it's the one thing that makes this tool's actual
mechanism (semantic search, not keyword matching) visible rather than just described. It's collapsed by
default (a "see how this was found" disclosure), not forced onto every message.

### 17. English / Arabic via React Context, not prop-drilling

Language state, the translation dictionary, and text direction are provided through a `LangContext` /
`useLang()` hook rather than passed down through every component's props. **Why:** the component tree is
several levels deep in places (Chat → Message → EmbeddingMapView); prop-drilling language through all of them
would be error-prone and easy to forget on a new component.

**Scope boundary, stated on purpose:** UI chrome is fully translated; the example queries in the sidebar and
landing-page preview stay in English, because the search backend is English-only and translating them would
silently break the "click to try" flow. Backend-returned error messages (from the Python API) also remain
English for now — translating those would mean touching the backend too, which was out of scope for this
pass.

**RTL implementation detail:** relies on flexbox's built-in direction-awareness (`flex-start`/`flex-end`
auto-mirror under `dir="rtl"`) rather than manually computing left/right per element. The one place that
needed an explicit fix was an absolutely-positioned element (`left: 24`), switched to the logical CSS property
`insetInlineStart`, which resolves to the correct physical side automatically based on `dir`.

### 18. Known CSS gotcha: absolutely-positioned children of a CSS grid

A decorative ambient-background `<div>` was added as a child of a `display: grid` section with
`position: absolute; inset: 0`, expecting it to cover the whole section. Instead, being a grid item, it was
placed into and stretched to fill only the *first grid cell* — producing a visible rectangular tint confined
to that cell rather than a soft corner glow across the whole section. Root-caused by reproducing the actual
grid structure in an isolated test (a plain, non-grid test file never showed the bug). Fixed by giving the
element `grid-column: 1 / -1; grid-row: 1 / -1` so it spans all cells before `inset: 0` is applied. (This
particular ambient-background feature was later removed by request after several rounds of not looking right
at various viewport widths — the underlying grid/positioning bug is documented here since it's a real,
reusable lesson independent of that specific feature's fate.)
