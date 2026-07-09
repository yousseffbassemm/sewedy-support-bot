"""
rag.index -- Day 2: embed the clean corpus and persist it into ChromaDB.

Run:
    uv run python -m rag.index
"""

from __future__ import annotations

import json
from pathlib import Path

import chromadb
from chromadb.api.models.Collection import Collection

from rag.config import Settings, load_config
from rag.embeddings import Embedder, get_embedder

_DIMENSION_KEY = "embedding_dimension"


def _get_collection(client: chromadb.ClientAPI, settings: Settings, embedder: Embedder) -> Collection:
    """Fetch or create the collection, guarding against a dimension mismatch.

    The vector dimension is stamped into the collection's metadata at
    creation. If the collection already exists with a DIFFERENT dimension
    than the current embedder produces, we refuse to reuse it -- that would
    silently corrupt the index (e.g. mixing 384-dim MiniLM vectors with
    1536-dim Azure vectors is meaningless).
    """
    existing = {c.name for c in client.list_collections()}

    if settings.chroma.collection in existing:
        collection = client.get_collection(settings.chroma.collection)
        stored_dim = collection.metadata.get(_DIMENSION_KEY) if collection.metadata else None
        if stored_dim is not None and int(stored_dim) != embedder.dimension:
            raise RuntimeError(
                f"[index] Dimension mismatch: collection '{settings.chroma.collection}' was "
                f"created with dimension {stored_dim}, but the current embedder produces "
                f"{embedder.dimension}-dim vectors. Either switch the provider back, or delete "
                f"'{settings.chroma.persist_dir}' and re-index from scratch."
            )
        return collection

    return client.create_collection(
        name=settings.chroma.collection,
        metadata={_DIMENSION_KEY: embedder.dimension, "hnsw:space": "cosine"},
    )


def _read_clean_cases(path: str) -> list[dict]:
    cases = []
    with Path(path).open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                cases.append(json.loads(line))
    return cases


def index_corpus(settings: Settings, batch_size: int = 32) -> int:
    """Embed every clean case's `text` and upsert into the persistent
    ChromaDB collection. Returns the number of cases indexed."""
    cases = _read_clean_cases(settings.paths.clean_jsonl)
    if not cases:
        print(f"[index] no clean cases found in {settings.paths.clean_jsonl} -- run rag.ingest first")
        return 0

    embedder = get_embedder(settings.embedding)

    Path(settings.chroma.persist_dir).mkdir(parents=True, exist_ok=True)
    client = chromadb.PersistentClient(path=settings.chroma.persist_dir)
    collection = _get_collection(client, settings, embedder)

    total = 0
    for start in range(0, len(cases), batch_size):
        batch = cases[start : start + batch_size]
        texts = [c["text"] for c in batch]
        vectors = embedder.embed(texts)

        collection.upsert(
            ids=[c["case_id"] for c in batch],
            embeddings=vectors,
            documents=texts,
            metadatas=[
                {"product": c["product"], "category": c["category"], "problem": c["problem"]}
                for c in batch
            ],
        )
        total += len(batch)
        print(f"[index] upserted {total}/{len(cases)}")

    return total


def main() -> None:
    settings = load_config()
    count = index_corpus(settings)
    print(f"[index] done -- {count} cases indexed into '{settings.chroma.collection}' "
          f"at '{settings.chroma.persist_dir}' (dim={settings.embedding.dimension})")


if __name__ == "__main__":
    main()