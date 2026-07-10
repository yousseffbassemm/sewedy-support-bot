"""
backend.embedding_map -- project the REAL 384-dim MiniLM embeddings into 2D,
so semantic search can be shown as geometry, not just a list of results.

This ties directly back to the field guide's own §8 idea ("an embedding is
just the coordinates of your text on a map") -- instead of describing that,
this makes it visible, live, for your actual corpus and actual queries.

How it works, honestly:
  1. At startup, fetch the 57 real embeddings + metadata straight out of
     ChromaDB (the same vectors rag.index actually wrote).
  2. Fit a 2-component PCA on them with plain numpy (SVD) -- no new
     dependency, no black box. This gives a FIXED 2D layout for the corpus,
     computed once.
  3. Every chat query is embedded with the exact same embedder used at
     index time, then projected into that SAME fitted space with a matrix
     multiply. Nothing here is faked or randomly placed -- every coordinate
     traces back to a real 384-dim vector.

This module does NOT modify rag/index.py or rag/retrieve.py. It imports and
reuses their existing, already-audited functions (_get_collection,
get_embedder) the exact same way retrieve.py does internally.
"""

from __future__ import annotations

import chromadb
import numpy as np

from rag.config import Settings
from rag.embeddings import Embedder, get_embedder
from rag.index import _get_collection


class EmbeddingMap:
    def __init__(self, settings: Settings):
        embedder: Embedder = get_embedder(settings.embedding)
        client = chromadb.PersistentClient(path=settings.chroma.persist_dir)
        collection = _get_collection(client, settings, embedder)

        data = collection.get(include=["embeddings", "metadatas"])
        vectors = np.asarray(data["embeddings"], dtype=np.float64)
        ids = data["ids"]
        metadatas = data["metadatas"]

        if len(ids) == 0:
            raise RuntimeError(
                "No cases in the collection -- run `uv run python -m rag.index` first."
            )

        self._embedder = embedder
        self._mean = vectors.mean(axis=0)
        centered = vectors - self._mean

        # SVD-based PCA: the top 2 right-singular vectors are the directions
        # of greatest variance in the embedding space -- the best possible
        # flat, linear 2D summary of where these 384-dim points actually sit
        # relative to each other.
        _, _, vt = np.linalg.svd(centered, full_matrices=False)
        self._components = vt[:2]

        coords = centered @ self._components.T  # (n_cases, 2)

        self.case_points: list[dict] = []
        for i, case_id in enumerate(ids):
            meta = metadatas[i] or {}
            self.case_points.append(
                {
                    "id": case_id,
                    "product": meta.get("product", ""),
                    "category": meta.get("category", ""),
                    "x": float(coords[i, 0]),
                    "y": float(coords[i, 1]),
                }
            )

    def project_query(self, query: str) -> dict:
        """Embed the query with the real embedder, project into the same
        fitted 2D space the case points live in."""
        [vector] = self._embedder.embed([query])
        vector = np.asarray(vector, dtype=np.float64)
        centered = vector - self._mean
        xy = centered @ self._components.T
        return {"x": float(xy[0]), "y": float(xy[1])}
