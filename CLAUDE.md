# CLAUDE.md — project memory / build status

Single source of truth for where this project stands. Update this after each phase.

## Current phase

**Day 2 complete — awaiting review.**

## What's built

- **Day 1 (ingestion):** `src/rag/config.py`, `src/rag/ingest.py`, `tests/test_ingest.py`
- **Day 2 (embeddings + index + retrieve):** `src/rag/embeddings.py`, `src/rag/index.py`, `src/rag/retrieve.py`

## Key numbers (current corpus)

- Raw CSV: 69 rows
- Clean: 57 → `data/cases_clean.jsonl`
- Review queue: 12 → `data/review_queue.jsonl` (all `no_resolution`)
- Duplicates found: 0
- Embedding provider: `local` (MiniLM, `all-MiniLM-L6-v2`), 384-dim
- Vector store: ChromaDB, persistent, `data/chroma/`, collection `support_cases`
- Tests: 10/10 passing

## Decisions log

- Switched vector store from the course skeleton's Qdrant to **ChromaDB** — see `DESIGN.md` §8 for the
  reasoning. This was a mentor-directed correction, not a from-first-principles design choice.
- `REQUIRE_RESOLUTION = True` — a case with no fix has nothing to retrieve, so it's routed to review
  instead of indexed.

## What's intentionally NOT built yet (scope boundary)

Per the plan, stopped after Day 2:
- Hybrid (keyword + semantic) search
- RAG answer generation (feeding retrieved context to an LLM to write an answer)
- Evaluation / metrics
- A UI (Streamlit or otherwise)

These are later days — do not start them without mentor sign-off on Day 2 first.

## Repo

- GitHub: https://github.com/yousseffbassemm/sewedy-support-bot
- Local project name (`pyproject.toml`): `intern-rag`
- Importable package: `rag` (in `src/rag/`)
