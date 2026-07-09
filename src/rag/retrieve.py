"""
rag.retrieve -- Day 2: semantic top-k search over the indexed corpus.

Run:
    uv run python -m rag.retrieve "your question here"
"""

from __future__ import annotations

import sys

import chromadb

from rag.config import Settings, load_config
from rag.embeddings import get_embedder
from rag.index import _get_collection  # reuse the dimension-guarded accessor


def semantic_search(query: str, settings: Settings, top_k: int | None = None) -> list[dict]:
    """Embed the query with the SAME embedder used at index time, run a
    cosine top-k search, and return ranked hits as clean dicts."""
    embedder = get_embedder(settings.embedding)
    client = chromadb.PersistentClient(path=settings.chroma.persist_dir)
    collection = _get_collection(client, settings, embedder)  # dimension mismatch caught here too

    k = top_k or settings.retrieval.top_k
    [query_vector] = embedder.embed([query])

    results = collection.query(query_embeddings=[query_vector], n_results=k)

    hits = []
    for i in range(len(results["ids"][0])):
        meta = results["metadatas"][0][i]
        hits.append(
            {
                "case_id": results["ids"][0][i],
                "product": meta["product"],
                "category": meta["category"],
                "problem": meta["problem"],
                "distance": results["distances"][0][i],
                "document": results["documents"][0][i],
            }
        )
    return hits


def _print_hits(query: str, hits: list[dict]) -> None:
    print(f'\nQuery: "{query}"')
    if not hits:
        print("  (no results -- is the index empty? run rag.index first)")
        return
    for rank, hit in enumerate(hits, start=1):
        print(
            f"  {rank}. [{hit['distance']:.3f}] {hit['case_id']} | "
            f"{hit['product']} / {hit['category']}\n"
            f"     {hit['problem']}"
        )


def main() -> None:
    if len(sys.argv) < 2:
        print('Usage: uv run python -m rag.retrieve "your question"')
        sys.exit(1)

    query = " ".join(sys.argv[1:])
    settings = load_config()
    hits = semantic_search(query, settings)
    _print_hits(query, hits)


if __name__ == "__main__":
    main()