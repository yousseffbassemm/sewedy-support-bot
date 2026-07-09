# sewedy-support-bot — Instructor RAG SupportBot (Day 1 + Day 2)

An educational, enterprise-style Retrieval-Augmented-Generation "SupportBot". It models production
instincts (typed config, secrets separation, provider abstraction, fail-fast validation, idempotent
steps) while running **fully locally by default** — no cloud account required.

This repo currently covers **Day 1 (ingestion)** and **Day 2 (embeddings + indexing + retrieval)**.
Hybrid search, RAG answer generation, evaluation, and a UI are intentionally **not** built yet —
later scope.

## Corpus

A knowledge base of resolved device support cases. Source schema:

```
case_id, product, category, problem, cause, resolution
```

Ingestion derives a labelled `text` field per row (`Product: … / Category: … / Problem: … / Cause: … /
Resolution: …`, empty sections skipped) — that is the document we embed.

## Pipeline

```
support_cases.csv (case_id, product, category, problem, cause, resolution)
      │  profile → map columns → clean → build labelled text → quality gates
      ▼
cases_clean.jsonl        review_queue.jsonl   ← bad rows, never silently dropped
      │  embed (MiniLM by default, Azure opt-in)
      ▼
ChromaDB (data/chroma, local, persistent)
      │  embed query → cosine top-k
      ▼
semantic search results
```

**Quality gates:** `missing_case_id`, `empty_problem`, `no_resolution` (while `REQUIRE_RESOLUTION=True`),
`duplicate_case_id`. On the current corpus this is **69 rows → 57 clean / 12 review** (all 12 missing a
resolution).

## Requirements

- Windows / macOS / Linux, **Python 3.11**, and [**uv**](https://docs.astral.sh/uv/).
- Everything runs locally. The default embedding model (MiniLM) downloads on first use (~90 MB).

## Setup (new machine)

```bash
git clone https://github.com/yousseffbassemm/sewedy-support-bot.git
cd sewedy-support-bot
uv sync
```

`uv sync` rebuilds the exact environment from `.python-version` + `uv.lock`.

Azure embeddings are **opt-in** and only needed if you switch the provider:

```bash
uv sync --extra azure
cp .env.example .env      # then fill in your Azure values
```

## Usage

```bash
uv run python -m rag.config                       # print validated settings (fails loudly if config is bad)
uv run python -m rag.ingest                       # → data/cases_clean.jsonl + data/review_queue.jsonl
uv run python -m rag.index                        # embed + persist into data/chroma/
uv run python -m rag.retrieve "readings drift higher after installation"
uv run pytest -q                                  # fast offline unit tests
```

Each retrieval hit prints `case_id`, `product`, `category`, `problem`, and cosine `distance`
(smaller = closer). An out-of-domain query (e.g. *"how do I reset my password"*) intentionally returns only
weak, high-distance hits — a teaching signal that this corpus is device support, not IT helpdesk.

## Configuration

Non-secret settings live in [`config/rag.yaml`](config/rag.yaml) and are validated into typed Pydantic
`Settings` at startup. Secrets (Azure credentials) live **only** in `.env` (git-ignored); commit
`.env.example` as the template.

Switching the embedding provider (`local` ↔ `azure`) changes the vector dimension (MiniLM = 384,
`text-embedding-3-small` = 1536). The index enforces a **dimension guard**, so after switching you must
delete `data/chroma/` and re-index. See [DESIGN.md](DESIGN.md) for the rationale behind each decision.

## Layout

```
config/rag.yaml                     typed, non-secret settings
data/                                inputs + outputs (data/chroma/ is git-ignored)
src/rag/config.py                   YAML → validated Pydantic Settings
src/rag/ingest.py       (Day 1)     profile → map → clean → build labelled text → gates → JSONL
src/rag/embeddings.py   (Day 2)     provider-agnostic Embedder (local MiniLM + Azure)
src/rag/index.py        (Day 2)     embed corpus → persist ChromaDB collection (dimension guard)
src/rag/retrieve.py     (Day 2)     semantic top-k search
tests/test_ingest.py                pure-function unit tests
CLAUDE.md                           project memory / build status (single source of truth)
DESIGN.md                           decisions, tradeoffs, and how-to-teach notes
```
