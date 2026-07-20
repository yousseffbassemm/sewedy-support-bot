"""
Unit tests for rag.retrieve's pure fusion/tokenising logic.
No disk I/O, no network, no model loading -- the Chroma-backed searches are
exercised by hand against the real index; what's locked down here is the logic
that silently broke once already.

Run:
    uv run pytest -q
"""

import pytest

from rag import retrieve
from rag.retrieve import _reciprocal_rank_fusion, _tokenize, detect_product_query


# --- tokenising -------------------------------------------------------------

def test_tokenize_splits_model_numbers_into_matchable_tokens():
    # 'g3' has to survive as its own token -- it's the only thing distinguishing
    # an AeroSense G3 case from an AeroSense G2 one.
    assert _tokenize("AeroSense G3") == ["aerosense", "g3"]


def test_tokenize_drops_punctuation():
    assert _tokenize("Product: AeroSense G3 / Category: Display") == [
        "product", "aerosense", "g3", "category", "display",
    ]


def test_tokenize_handles_empty_text():
    assert _tokenize("") == []


# --- reciprocal rank fusion -------------------------------------------------

def _hit(case_id: str, distance: float = 0.5) -> dict:
    return {"case_id": case_id, "distance": distance}


def test_rrf_ranks_agreed_case_above_either_lists_favourite():
    # 'b' is second on both lists; 'a' and 'c' each top one list and are absent
    # from the other. Two seconds beat one first -- that's the whole point.
    semantic = [_hit("a"), _hit("b")]
    keyword = [_hit("c"), _hit("b")]

    fused = _reciprocal_rank_fusion([semantic, keyword])

    assert fused[0]["case_id"] == "b"


def test_rrf_returns_each_case_once():
    fused = _reciprocal_rank_fusion([[_hit("a"), _hit("b")], [_hit("b"), _hit("a")]])
    assert sorted(h["case_id"] for h in fused) == ["a", "b"]


def test_rrf_keeps_the_real_distance_untouched():
    # Regression: fusion used to overwrite distance with a value derived from
    # rank, which made every top hit look like a ~0.01 perfect match and
    # silently disabled the grounding threshold in backend/main.py.
    fused = _reciprocal_rank_fusion([[_hit("a", distance=0.93)], []])
    assert fused[0]["distance"] == 0.93


def test_rrf_surfaces_a_keyword_only_case():
    # A case no semantic search returned must still be reachable via BM25.
    fused = _reciprocal_rank_fusion([[_hit("a")], [_hit("kw-only")]])
    assert "kw-only" in [h["case_id"] for h in fused]


def test_rrf_handles_one_empty_list():
    fused = _reciprocal_rank_fusion([[_hit("a")], []])
    assert [h["case_id"] for h in fused] == ["a"]


def test_rrf_handles_no_results_at_all():
    assert _reciprocal_rank_fusion([[], []]) == []


# --- product-name detection -------------------------------------------------

# Counts here already include no-resolution cases, the way _product_stats builds
# them -- so "AeroSense G2" is 8, matching the source spreadsheet, not 7.
_FAKE_STATS = {
    "aerosense g2": {"count": 8, "display": "AeroSense G2", "examples": ["fails self-test", "reading drifts"]},
    "aerosense g3": {"count": 15, "display": "AeroSense G3", "examples": ["screen blank"]},
    "flowmeter x100": {"count": 6, "display": "FlowMeter X100", "examples": ["no flow"]},
}


@pytest.fixture
def patched_stats(monkeypatch):
    # detect_product_query reads per-product totals via _product_stats; feed it a
    # known table so matching is tested without an index or the model.
    monkeypatch.setattr(retrieve, "_product_stats", lambda settings: _FAKE_STATS)


def test_detect_bare_product_name_returns_summary(patched_stats):
    r = detect_product_query("AeroSense G2", settings=None)
    assert r["product"] == "AeroSense G2"
    assert r["count"] == 8
    assert r["example_problem"] in {"fails self-test", "reading drifts"}


def test_detect_is_case_insensitive(patched_stats):
    assert detect_product_query("aerosense g2", settings=None)["product"] == "AeroSense G2"


def test_detect_tolerates_filler_words(patched_stats):
    assert detect_product_query("show me AeroSense G2 cases", settings=None)["count"] == 8


def test_detect_does_not_confuse_g2_and_g3(patched_stats):
    # 'G2' must not match the G3 product just because they share 'aerosense'.
    assert detect_product_query("AeroSense G2", settings=None)["product"] == "AeroSense G2"
    assert detect_product_query("AeroSense G3", settings=None)["count"] == 15


def test_detect_returns_none_for_a_real_problem(patched_stats):
    # A symptom beyond the product name is a problem query, not a browse.
    assert detect_product_query("AeroSense G2 screen is blank", settings=None) is None


def test_detect_returns_none_when_no_product_named(patched_stats):
    assert detect_product_query("my display shows nothing", settings=None) is None


def test_detect_returns_none_for_partial_product_name(patched_stats):
    # Bare "AeroSense" can't pick between G2 and G3, so it's not a product query.
    assert detect_product_query("AeroSense", settings=None) is None


# --- product totals include no-resolution cases -----------------------------

def test_product_stats_counts_searchable_plus_excluded(monkeypatch):
    # The regression the user caught: the spreadsheet shows 8 AeroSense G2 rows,
    # but one has no resolution and is held out of the search index. The total
    # must still be 8 (2 searchable + 1 excluded here), and the example must
    # come only from a case that has a resolution.
    monkeypatch.setattr(retrieve, "_PRODUCT_STATS_CACHE", None)
    monkeypatch.setattr(
        retrieve,
        "_get_bm25",
        lambda settings: (
            [
                {"product": "AeroSense G2", "problem": "fails self-test", "resolution": "swapped unit"},
                {"product": "AeroSense G2", "problem": "reading drifts", "resolution": "recalibrated"},
            ],
            None,
        ),
    )
    # Raw spelling + empty resolution, exactly like a review-queue row.
    monkeypatch.setattr(
        retrieve, "_load_jsonl", lambda path: [{"product": "aerosense g2", "problem": "customer unhappy"}]
    )

    class _Paths:
        review_jsonl = "unused"

    class _Settings:
        paths = _Paths()

    stats = retrieve._product_stats(_Settings())
    monkeypatch.setattr(retrieve, "_PRODUCT_STATS_CACHE", None)  # don't leak to other tests

    assert stats["aerosense g2"]["count"] == 3
    assert stats["aerosense g2"]["display"] == "AeroSense G2"  # canonical, not raw
    assert stats["aerosense g2"]["examples"] == ["fails self-test", "reading drifts"]


def test_product_stats_excludes_resolutionless_cases_from_examples(monkeypatch):
    # A searchable case with no resolution must never become an example, even
    # though it still counts toward the product total.
    monkeypatch.setattr(retrieve, "_PRODUCT_STATS_CACHE", None)
    monkeypatch.setattr(
        retrieve,
        "_get_bm25",
        lambda settings: (
            [
                {"product": "GridLink Hub", "problem": "has a fix", "resolution": "did the fix"},
                {"product": "GridLink Hub", "problem": "no fix logged", "resolution": ""},
            ],
            None,
        ),
    )
    monkeypatch.setattr(retrieve, "_load_jsonl", lambda path: [])

    class _Paths:
        review_jsonl = "unused"

    class _Settings:
        paths = _Paths()

    stats = retrieve._product_stats(_Settings())
    monkeypatch.setattr(retrieve, "_PRODUCT_STATS_CACHE", None)

    assert stats["gridlink hub"]["count"] == 2  # both count
    assert stats["gridlink hub"]["examples"] == ["has a fix"]  # only the resolved one


def test_detect_returns_blank_example_when_no_resolved_case(monkeypatch):
    # Product exists but has no resolvable case: report the count, no example.
    monkeypatch.setattr(
        retrieve,
        "_product_stats",
        lambda settings: {"ghost unit": {"count": 3, "display": "Ghost Unit", "examples": []}},
    )
    r = detect_product_query("Ghost Unit", settings=None)
    assert r["count"] == 3
    assert r["example_problem"] == ""
