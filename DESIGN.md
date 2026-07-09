# DESIGN.md — why each decision was made

## 1. Config vs. secrets split

`config/rag.yaml` holds every non-secret knob (provider, model name, top_k, paths). `.env` (git-ignored)
holds only credentials. **Why:** YAML is meant to be committed and reviewed in PRs; secrets committed to
git are a permanent leak even after deletion (they live in history forever). Splitting them means the
config file is always safe to share, screenshot, or paste into a chat — because it never contains a key.

**How to teach it:** ask "what happens if this file gets committed by mistake?" for each file. YAML → fine.
`.env` → incident.

## 2. Quality gates + review queue (never silently drop rows)

Every row that fails a gate (`missing_case_id`, `empty_problem`, `no_resolution`, `duplicate_case_id`) is
routed to `review_queue.jsonl` with its original data intact plus a `reject_reason` — never just discarded.
**Why:** silently dropped data is invisible data loss. A human (or a future pipeline stage) needs to be
able to see exactly what didn't make it in, and why, without re-deriving it from the raw CSV.

**How to teach it:** point at the 12 rejected rows and ask "if we'd just filtered these out with
`df.dropna()`, how would anyone find out later that 12 real support cases are missing from the bot's
knowledge?"

## 3. Labelled text, not raw concatenation

`build_text()` produces `Product: … / Category: … / Problem: … / Cause: … / Resolution: …`, not just the
raw fields glued together. **Why:** embedding models are sensitive to structure — a labelled field carries
a stronger, more distinct signal in vector space than an unlabelled string, and it also makes the stored
`document` human-readable for debugging retrieval results directly in the database.

## 4. The embedder abstraction (`Protocol` + factory)

`Embedder` is a `Protocol` with `.dimension` and `.embed()`. `LocalMiniLMEmbedder` and `AzureEmbedder` both
implement it; `get_embedder(cfg)` is the *only* place that branches on provider. **Why:** every other module
(`index.py`, `retrieve.py`) calls `.embed()` without caring which backend is behind it — swapping providers
is a one-line YAML change, not a code change scattered across the codebase.

**How to teach it:** ask "if we add a third provider (say, Cohere) next month, how many files change?"
Answer: one — `embeddings.py` gains a class, `get_embedder` gains a branch. Nothing else moves.

## 5. The Azure gotcha (documented in code, not just here)

Azure's `embeddings.create(model=...)` expects the **deployment name** you configured in the Azure portal,
not the public model name (`text-embedding-3-small`). Confusing these two gives a cryptic 404 with no
obvious fix. `AzureEmbedder` is written with a comment calling this out directly at the call site, so the
next person debugging a 404 sees the answer immediately instead of searching Stack Overflow.

## 6. The dimension guard

`_get_collection()` stamps the embedder's vector dimension into the collection's metadata at creation, and
refuses to reuse a collection whose stored dimension doesn't match the current embedder. **Why:** MiniLM
produces 384-dim vectors, Azure's `text-embedding-3-small` produces 1536-dim vectors — mixing them in one
collection isn't just wrong, it's meaningless (there's no valid "distance" between vectors of different
dimensionality). Without the guard, this fails silently or crashes deep inside a query with a confusing
shape-mismatch error. With it, you get an immediate, actionable message the moment you switch providers
without re-indexing.

## 7. Idempotent indexing (`upsert`, not `add`)

Running `rag.index` twice overwrites existing `case_id`s instead of duplicating them. **Why:** pipelines
get re-run — during development, after a CSV update, after a bug fix. An idempotent step means "just run it
again" is always a safe answer, never something that requires first wiping the database by hand.

## 8. Vector store: ChromaDB, not Qdrant

The course's generic skeleton example uses Qdrant (a client/server vector DB). This project uses ChromaDB
instead — a persistent, embedded (in-process) vector store that needs no separate server running, no host,
no port. **Why here specifically:** for a single-developer, fully-local educational build, an embedded store
removes an entire class of setup friction (no Docker, no service to start/stop, no connection config) while
keeping the same core capability (persistent vectors, cosine search, metadata filtering) the pipeline needs.
