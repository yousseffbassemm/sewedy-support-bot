"""
rag.retrieve -- Day 2 (upgraded): hybrid top-k search over the indexed corpus.

Three public searches, all returning the same hit shape:
    semantic_search  -- meaning ("display won't come on" finds "no display")
    keyword_search   -- exact tokens (BM25; "AeroSense G3" must not match G2)
    hybrid_search    -- both, fused with Reciprocal Rank Fusion

Every hit carries a REAL cosine `distance`, including BM25-only hits. That
matters: backend/main.py decides whether a case is relevant enough to show the
answer writer by thresholding this number, so a synthesised value there would
silently wave through every result. RRF decides ORDER; distance stays a real
measurement of similarity. The two are deliberately not the same axis.

Run:
    uv run python -m rag.retrieve "your question here"
"""

from __future__ import annotations

import json
import random
import re
import sys
from pathlib import Path

import chromadb
import numpy as np
from chromadb.api.models.Collection import Collection
from rank_bm25 import BM25Okapi

from rag.config import Settings, load_config
from rag.embeddings import Embedder, get_embedder
from rag.index import _get_collection  # reuse the dimension-guarded accessor

# --- Caches -----------------------------------------------------------------
# All lazily built on first search, then reused. get_embedder() hands back a
# fresh object each call and the local model loads on first embed(), so
# without this every single query would reload MiniLM from disk.
_EMBEDDER_CACHE: Embedder | None = None
_COLLECTION_CACHE: Collection | None = None
_BM25_CORPUS_CACHE: list[dict] | None = None
_BM25_INDEX_CACHE: BM25Okapi | None = None
_PRODUCT_STATS_CACHE: dict[str, dict] | None = None


def _tokenize(text: str) -> list[str]:
    """Extract alphanumeric tokens. Crucial for strict model/part number matching:
    'AeroSense G3' -> ['aerosense', 'g3'], so the 'g3' token can distinguish it
    from a G2 case that shares the 'aerosense' token."""
    if not text:
        return []
    return re.findall(r"\w+", text.lower())


# Function words plus a couple of domain-generic subject nouns ("device",
# "unit") that appear in almost every case and so carry no discriminating
# signal. BM25 scores rare tokens highly, so left in, a filler word like
# "device" lets an unrelated case win purely because it too says "device" --
# the exact failure that made "the device is completely dead and won't power
# up" retrieve a *no-display* case over the correct *does-not-power-on* one.
# Model numbers (g2, g3, x100 ...) and real symptom words are deliberately NOT
# here, so the G2-vs-G3 disambiguation BM25 exists for is untouched.
_BM25_STOPWORDS = {
    "a", "about", "after", "again", "all", "am", "an", "and", "any", "are",
    "around", "as", "at", "be", "been", "being", "before", "but", "by", "can",
    "could", "device", "devices", "did", "do", "does", "doing", "done", "down",
    "for", "from", "get", "gets", "getting", "got", "had", "has", "have", "he",
    "her", "here", "his", "i", "in", "into", "is", "it", "its", "itself",
    "just", "keep", "keeps", "kept", "may", "me", "might", "more", "most",
    "must", "my", "no", "not", "of", "off", "on", "only", "or", "our", "out",
    "over", "own", "she", "should", "so", "some", "still", "than", "that",
    "the", "their", "them", "then", "there", "these", "they", "this", "those",
    "to", "too", "under", "unit", "units", "up", "very", "was", "we", "were",
    "will", "with", "within", "without", "would", "yet", "you", "your",
}


def _tokenize_bm25(text: str) -> list[str]:
    """Tokenise for keyword search, dropping stop/filler words.

    Only the BM25 half uses this; `_tokenize` (product-name detection, tests)
    is left exactly as-is. Keeping high-signal tokens -- model numbers, error
    words, real symptoms -- and dropping the rest is what stops a shared filler
    word from casting a spurious keyword vote in the fusion stage.
    """
    return [t for t in _tokenize(text) if t not in _BM25_STOPWORDS]


def _get_embedder(settings: Settings) -> Embedder:
    global _EMBEDDER_CACHE
    if _EMBEDDER_CACHE is None:
        _EMBEDDER_CACHE = get_embedder(settings.embedding)
    return _EMBEDDER_CACHE


def _get_cached_collection(settings: Settings) -> Collection:
    global _COLLECTION_CACHE
    if _COLLECTION_CACHE is None:
        client = chromadb.PersistentClient(path=settings.chroma.persist_dir)
        # Dimension mismatch (e.g. reusing a 384-dim index with a 1536-dim
        # embedder) is caught here, at first use.
        _COLLECTION_CACHE = _get_collection(client, settings, _get_embedder(settings))
    return _COLLECTION_CACHE


def _get_bm25(settings: Settings) -> tuple[list[dict], BM25Okapi]:
    """Lazily load the clean cases and build the BM25 index on first use.

    The index is built over the same `text` field that was embedded, so both
    halves of the hybrid search see exactly the same corpus.
    """
    global _BM25_CORPUS_CACHE, _BM25_INDEX_CACHE

    if _BM25_INDEX_CACHE is None:
        path = Path(settings.paths.clean_jsonl)
        if not path.exists():
            raise RuntimeError(f"Clean corpus not found at {path}. Run ingest first.")

        cases = []
        with path.open("r", encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    cases.append(json.loads(line))

        if not cases:
            raise RuntimeError(f"Clean corpus at {path} is empty. Run ingest first.")

        _BM25_CORPUS_CACHE = cases
        _BM25_INDEX_CACHE = BM25Okapi([_tokenize_bm25(c.get("text", "")) for c in cases])

    return _BM25_CORPUS_CACHE, _BM25_INDEX_CACHE


def _hit_from_metadata(case_id: str, meta: dict, document: str, distance: float) -> dict:
    """The one place a hit dict is shaped, so every search returns the same keys."""
    return {
        "case_id": case_id,
        "product": meta.get("product", ""),
        "category": meta.get("category", ""),
        "problem": meta.get("problem", ""),
        "cause": meta.get("cause", ""),
        "resolution": meta.get("resolution", ""),
        "distance": distance,
        "document": document,
    }


def _cosine_distances(
    collection: Collection, case_ids: list[str], query_vector: list[float]
) -> dict[str, float]:
    """Real cosine distance from the query to specific stored cases.

    Chroma only reports distances for what its own search returned, so a case
    found by BM25 alone arrives without one. Here we fetch its stored vector
    and measure it directly. Normalising both sides means this matches what
    Chroma computes for the collection's cosine space, rather than merely
    resembling it.
    """
    if not case_ids:
        return {}

    stored = collection.get(ids=case_ids, include=["embeddings"])
    ids = stored.get("ids") or []
    embeddings = stored.get("embeddings")
    if embeddings is None or len(ids) == 0:
        return {}

    matrix = np.asarray(embeddings, dtype=float)
    query = np.asarray(query_vector, dtype=float)

    denominator = np.linalg.norm(matrix, axis=1) * np.linalg.norm(query)
    nonzero = denominator != 0

    # A zero vector has no direction, so cosine is undefined; call it maximally
    # distant rather than dividing by zero.
    similarities = np.full(len(ids), -1.0)
    similarities[nonzero] = (matrix[nonzero] @ query) / denominator[nonzero]

    return {case_id: float(1.0 - sim) for case_id, sim in zip(ids, similarities)}


def semantic_search(query: str, settings: Settings, top_k: int | None = None) -> list[dict]:
    """Embed the query with the SAME embedder used at index time, run a
    cosine top-k search, and return ranked hits as clean dicts."""
    collection = _get_cached_collection(settings)
    embedder = _get_embedder(settings)

    k = top_k or settings.retrieval.top_k
    [query_vector] = embedder.embed([query])

    results = collection.query(query_embeddings=[query_vector], n_results=k)

    if not results or not results["ids"] or not results["ids"][0]:
        return []

    return [
        _hit_from_metadata(
            case_id=results["ids"][0][i],
            meta=results["metadatas"][0][i] or {},
            document=results["documents"][0][i],
            distance=float(results["distances"][0][i]),
        )
        for i in range(len(results["ids"][0]))
    ]


def keyword_search(query: str, settings: Settings, top_k: int | None = None) -> list[dict]:
    """Strict BM25 keyword search, to catch exact model numbers and error codes
    that an embedding blurs together ('G2' and 'G3' sit almost on top of each
    other in vector space; as tokens they are simply different)."""
    k = top_k or settings.retrieval.top_k
    corpus, index = _get_bm25(settings)

    tokenized_query = _tokenize_bm25(query)
    if not tokenized_query:
        return []

    scores = index.get_scores(tokenized_query)

    # Rank by score, but carry the index so we never sort dicts (which would
    # raise on a score tie), and so ties fall back to corpus order.
    ranked = sorted(range(len(corpus)), key=lambda i: scores[i], reverse=True)
    matched = [i for i in ranked[:k] if scores[i] > 0]
    if not matched:
        return []

    # BM25 never touches vectors, so distances are measured separately.
    embedder = _get_embedder(settings)
    [query_vector] = embedder.embed([query])
    distances = _cosine_distances(
        _get_cached_collection(settings), [corpus[i]["case_id"] for i in matched], query_vector
    )

    return [
        _hit_from_metadata(
            case_id=corpus[i]["case_id"],
            meta=corpus[i],
            document=corpus[i].get("text", ""),
            distance=distances.get(corpus[i]["case_id"], 1.0),
        )
        for i in matched
    ]


# Words that don't turn a product-name query into a specific-problem one:
# "AeroSense G2", "AeroSense G2 cases" and "show me AeroSense G2 problems" all
# mean the same thing -- "tell me about this product".
_PRODUCT_QUERY_FILLER = {
    "a", "about", "all", "an", "any", "case", "cases", "device", "for", "give",
    "have", "i", "info", "information", "is", "issue", "issues", "list", "me",
    "my", "of", "on", "please", "problem", "problems", "product", "show", "some",
    "tell", "the", "there", "this", "to", "want", "with", "you",
}


def _load_jsonl(path_str: str) -> list[dict]:
    path = Path(path_str)
    if not path.exists():
        return []
    rows = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def _product_stats(settings: Settings) -> dict[str, dict]:
    """Per-product totals over the WHOLE dataset, keyed by normalised name.

    The count spans both the searchable cases and the ones held back for having
    no resolution, so it matches what a user sees counting rows in the source
    spreadsheet -- the earlier count, taken from the index alone, undercounted
    every product by its no-resolution cases. Example problems are collected
    only from cases that DO have a resolution, so an example the user picks up
    on is always one the bot can actually answer.
    """
    global _PRODUCT_STATS_CACHE
    if _PRODUCT_STATS_CACHE is None:
        searchable, _ = _get_bm25(settings)
        excluded = _load_jsonl(settings.paths.review_jsonl)  # no-resolution cases

        stats: dict[str, dict] = {}

        def slot(product: str) -> dict:
            key = " ".join(_tokenize(product))
            return stats.setdefault(key, {"count": 0, "display": product, "examples": []})

        # Searchable cases first, so the canonical (clean) spelling wins as the
        # display name over any raw spelling left in the review queue.
        for case in searchable:
            entry = slot(case.get("product", ""))
            entry["count"] += 1
            # Only offer a case as an example if it actually has a resolution --
            # an example the user might pick has to be one the bot can answer.
            if case.get("problem") and case.get("resolution"):
                entry["examples"].append(case["problem"])
        for case in excluded:
            slot(case.get("product", ""))["count"] += 1

        _PRODUCT_STATS_CACHE = stats
    return _PRODUCT_STATS_CACHE


def detect_product_query(query: str, settings: Settings) -> dict | None:
    """Recognise a bare product-name query and summarise that product.

    Returns None when the query names no known product, or carries a real
    symptom beyond the product name -- that's a problem query, and retrieval
    should answer it. Otherwise returns the product, how many cases exist for it
    across the whole dataset (matching the spreadsheet, not just the searchable
    index), and one example problem drawn from a case that has a resolution.
    """
    stats = _product_stats(settings)

    query_tokens = set(_tokenize(query))
    if not query_tokens:
        return None

    # Match the most specific product whose every token appears in the query and
    # whose only leftover query words are filler. "AeroSense G2" matches the G2
    # product but not G3 (the 'g3' token is absent), so the two never collide.
    best_key: str | None = None
    best_specificity = 0
    for key in stats:
        product_tokens = set(key.split())
        if not product_tokens or not product_tokens.issubset(query_tokens):
            continue
        if query_tokens - product_tokens - _PRODUCT_QUERY_FILLER:
            continue  # a genuine symptom is present -> problem query
        if len(product_tokens) > best_specificity:
            best_key, best_specificity = key, len(product_tokens)

    if best_key is None:
        return None

    entry = stats[best_key]
    # Empty only if every case for this product lacks a resolution; callers must
    # then skip the example rather than show a blank one.
    example_problem = random.choice(entry["examples"]) if entry["examples"] else ""
    return {
        "product": entry["display"],
        "count": entry["count"],
        "example_problem": example_problem,
    }


def _reciprocal_rank_fusion(
    ranked_lists: list[list[dict]], smoothing_constant: int = 60
) -> list[dict]:
    """Merge ranked lists by Reciprocal Rank Fusion.

    Each list votes for a case with 1/(k + rank). Using rank rather than score
    is the point: BM25 scores are unbounded relevance and cosine distances are
    bounded dissimilarity, so the two cannot be compared or averaged directly.
    Their orderings can. A case both searches rank highly collects two votes
    and wins; k=60 is the standard damping, keeping any single list's top hit
    from dominating on its own.
    """
    fused: dict[str, dict] = {}
    for hits in ranked_lists:
        for rank, hit in enumerate(hits):
            entry = fused.setdefault(hit["case_id"], {"score": 0.0, "hit": hit})
            entry["score"] += 1.0 / (smoothing_constant + rank + 1)

    ordered = sorted(fused.values(), key=lambda e: e["score"], reverse=True)
    return [entry["hit"] for entry in ordered]


def hybrid_search(query: str, settings: Settings, top_k: int | None = None) -> list[dict]:
    """Fuse semantic search (meaning) and BM25 (exact tokens) with RRF.

    Each half over-fetches, so a case that only one of them ranks well still
    reaches the fusion stage and can be voted up.
    """
    k = top_k or settings.retrieval.top_k
    pool_k = max(k * 4, 20)

    sem_hits = semantic_search(query, settings, top_k=pool_k)
    kw_hits = keyword_search(query, settings, top_k=pool_k)

    return _reciprocal_rank_fusion([sem_hits, kw_hits])[:k]


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
    _print_hits(query, hybrid_search(query, settings))


if __name__ == "__main__":
    main()
