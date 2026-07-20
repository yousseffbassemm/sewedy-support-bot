"""
Fast, offline unit tests for rag.ingest's pure functions.
No disk I/O, no network, no model loading.

Run:
    uv run pytest -q
"""

from rag.ingest import (
    build_text,
    canonical_product_map,
    clean_text,
    product_key,
    to_canonical,
)


# --- clean_text ---------------------------------------------------------

def test_clean_text_strips_html():
    assert clean_text("<b>Hello</b> world") == "Hello world"


def test_clean_text_collapses_whitespace():
    assert clean_text("Hello    \n\n  world") == "Hello world"


def test_clean_text_preserves_case():
    assert clean_text("AeroSense G3") == "AeroSense G3"


# --- build_text ----------------------------------------------------------

def test_build_text_labels_all_sections():
    case = {
        "product": "AeroSense G3",
        "category": "Connectivity",
        "problem": "Readings drift",
        "cause": "Dust ingress",
        "resolution": "Cleaned sensor",
    }
    text = build_text(case)
    assert text == (
        "Product: AeroSense G3 / Category: Connectivity / Problem: Readings drift "
        "/ Cause: Dust ingress / Resolution: Cleaned sensor"
    )


def test_build_text_skips_empty_fields():
    case = {
        "product": "AeroSense G3",
        "category": "",
        "problem": "Readings drift",
        "cause": "",
        "resolution": "Cleaned sensor",
    }
    text = build_text(case)
    assert text == "Product: AeroSense G3 / Problem: Readings drift / Resolution: Cleaned sensor"


# --- product name canonicalisation -----------------------------------------

def test_product_key_ignores_case_and_spacing():
    assert product_key("AeroSense G3") == product_key("aerosense  g3")


def test_canonical_product_map_picks_majority_spelling():
    products = ["AeroSense G3", "AeroSense G3", "aerosense g3"]
    assert canonical_product_map(products) == {"aerosense g3": "AeroSense G3"}


def test_canonical_product_map_keeps_distinct_products_apart():
    # The G2/G3 distinction is real, not a casing artefact -- folding these
    # together would merge two different devices' cases.
    mapping = canonical_product_map(["AeroSense G3", "AeroSense G2"])
    assert mapping == {"aerosense g3": "AeroSense G3", "aerosense g2": "AeroSense G2"}


def test_canonical_product_map_breaks_ties_deterministically():
    # One occurrence each: rebuilding must not shuffle the corpus.
    first = canonical_product_map(["FlowMeter X100", "FLOWMETER x100"])
    second = canonical_product_map(["FLOWMETER x100", "FlowMeter X100"])
    assert first == second


def test_to_canonical_applies_canonical_product_name():
    row = {
        "case_id": "1",
        "product": "aerosense g3",
        "category": "Display",
        "problem": "broken",
        "cause": "",
        "resolution": "fixed",
    }
    case, reason = to_canonical(row, {"aerosense g3": "AeroSense G3"})
    assert reason is None
    assert case.product == "AeroSense G3"
    assert "Product: AeroSense G3" in case.text


def test_to_canonical_without_map_leaves_product_untouched():
    row = {
        "case_id": "1",
        "product": "aerosense g3",
        "category": "Display",
        "problem": "broken",
        "cause": "",
        "resolution": "fixed",
    }
    case, _ = to_canonical(row)
    assert case.product == "aerosense g3"


# --- to_canonical: rejections ---------------------------------------------

def test_to_canonical_rejects_missing_case_id():
    row = {
        "case_id": "",
        "product": "X",
        "category": "Y",
        "problem": "broken",
        "cause": "",
        "resolution": "fixed",
    }
    case, reason = to_canonical(row)
    assert case is None
    assert reason == "missing_case_id"


def test_to_canonical_rejects_empty_problem():
    row = {
        "case_id": "1",
        "product": "X",
        "category": "Y",
        "problem": "",
        "cause": "",
        "resolution": "fixed",
    }
    case, reason = to_canonical(row)
    assert case is None
    assert reason == "empty_problem"


def test_to_canonical_rejects_no_resolution():
    row = {
        "case_id": "1",
        "product": "X",
        "category": "Y",
        "problem": "broken",
        "cause": "",
        "resolution": "",
    }
    case, reason = to_canonical(row)
    assert case is None
    assert reason == "no_resolution"


# --- to_canonical: happy path ----------------------------------------------

def test_to_canonical_accepts_valid_row():
    row = {
        "case_id": "1401-1791",
        "product": "FlowMeter X100",
        "category": "Power",
        "problem": "Wrong serial number",
        "cause": "Duplicate serial",
        "resolution": "Reflashed correct serial",
    }
    case, reason = to_canonical(row)
    assert reason is None
    assert case is not None
    assert case.case_id == "1401-1791"
    assert "Product: FlowMeter X100" in case.text


def test_to_canonical_strips_html_in_problem():
    row = {
        "case_id": "2",
        "product": "X",
        "category": "Y",
        "problem": "<p>Device won't turn on</p>",
        "cause": "",
        "resolution": "Replaced battery",
    }
    case, reason = to_canonical(row)
    assert reason is None
    assert case.problem == "Device won't turn on"