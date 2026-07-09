"""
rag.ingest -- Day 1: CSV -> clean labelled corpus (+ review queue).

Flow (see build_corpus()):
    read CSV (all-strings) -> profile_csv() -> map_columns() -> to_canonical()
    per row (clean_text + quality gates + build_text) -> duplicate check
    -> write two JSONL files.

Run:
    uv run python -m rag.ingest
"""

from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path
from typing import Optional

import pandas as pd
from pydantic import BaseModel

from rag.config import Settings, load_config

# ---------------------------------------------------------------------------
# Toggle: require every case to have a resolution to be indexed.
# This is a *solutions* knowledge base -- a case with no fix has nothing to
# retrieve, so cases without one are routed to review, not dropped.
# ---------------------------------------------------------------------------
REQUIRE_RESOLUTION = True

# Canonical schema, with accepted aliases per column (robust to
# differently-named exports from other systems).
COLUMN_MAP: dict[str, list[str]] = {
    "case_id": ["case_id", "id", "ticket_id"],
    "product": ["product", "device", "product_name"],
    "category": ["category", "type", "issue_type"],
    "problem": ["problem", "issue", "description", "body", "symptom"],
    "cause": ["cause", "root_cause", "reason"],
    "resolution": ["resolution", "fix", "solution"],
}

CANONICAL_COLUMNS = list(COLUMN_MAP.keys())

_HTML_TAG_RE = re.compile(r"<[^>]+>")
_CONTROL_CHAR_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_WHITESPACE_RE = re.compile(r"\s+")


class SupportCase(BaseModel):
    case_id: str
    product: str
    category: str
    problem: str
    cause: str
    resolution: str
    text: str


def clean_text(value: str) -> str:
    """Normalize one field: NFKC unicode normalize, strip HTML tags, remove
    control characters, collapse whitespace. Never lowercases -- case is
    signal (product names, acronyms, error codes)."""
    if value is None:
        return ""
    value = unicodedata.normalize("NFKC", value)
    value = _HTML_TAG_RE.sub(" ", value)
    value = _CONTROL_CHAR_RE.sub(" ", value)
    value = _WHITESPACE_RE.sub(" ", value).strip()
    return value


def profile_csv(df: pd.DataFrame) -> None:
    """Print a quick report on the raw data before we trust it."""
    print(f"[ingest] rows: {len(df)}")
    print(f"[ingest] columns: {list(df.columns)}")
    for col in df.columns:
        empty = (df[col].astype(str).str.strip() == "").sum()
        print(f"[ingest]   '{col}': {empty} empty cell(s)")
    if "case_id" in df.columns:
        dup_count = df["case_id"].duplicated().sum()
        print(f"[ingest] duplicate case_id count (raw): {dup_count}")


def map_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Rename source columns to the canonical schema using COLUMN_MAP aliases."""
    rename: dict[str, str] = {}
    lower_cols = {c.lower().strip(): c for c in df.columns}
    for canonical, aliases in COLUMN_MAP.items():
        for alias in aliases:
            if alias in lower_cols:
                rename[lower_cols[alias]] = canonical
                break
    df = df.rename(columns=rename)
    for col in CANONICAL_COLUMNS:
        if col not in df.columns:
            df[col] = ""
    return df[CANONICAL_COLUMNS]


def build_text(case: dict[str, str]) -> str:
    """Assemble the labelled document we embed. Skips empty sections."""
    labels = [
        ("Product", case["product"]),
        ("Category", case["category"]),
        ("Problem", case["problem"]),
        ("Cause", case["cause"]),
        ("Resolution", case["resolution"]),
    ]
    parts = [f"{label}: {value}" for label, value in labels if value]
    return " / ".join(parts)


def to_canonical(row: dict[str, str]) -> tuple[Optional[SupportCase], Optional[str]]:
    """Clean one row and apply quality gates.

    Returns (SupportCase, None) on success, or (None, reason) on rejection.
    """
    cleaned = {col: clean_text(row.get(col, "")) for col in CANONICAL_COLUMNS}

    if not cleaned["case_id"]:
        return None, "missing_case_id"
    if not cleaned["problem"]:
        return None, "empty_problem"
    if REQUIRE_RESOLUTION and not cleaned["resolution"]:
        return None, "no_resolution"

    text = build_text(cleaned)
    return SupportCase(**cleaned, text=text), None


def build_corpus(settings: Settings) -> tuple[list[SupportCase], list[dict]]:
    """Read the raw CSV and produce (clean_cases, rejected_rows)."""
    raw_path = Path(settings.paths.raw_csv)
    df = pd.read_csv(raw_path, dtype=str, keep_default_na=False, encoding="utf-8-sig")

    profile_csv(df)
    df = map_columns(df)

    clean_cases: list[SupportCase] = []
    rejected: list[dict] = []
    seen_ids: set[str] = set()

    for row in df.to_dict(orient="records"):
        case, reason = to_canonical(row)
        if case is None:
            rejected.append({**row, "reject_reason": reason})
            continue
        if case.case_id in seen_ids:
            rejected.append({**row, "reject_reason": "duplicate_case_id"})
            continue
        seen_ids.add(case.case_id)
        clean_cases.append(case)

    return clean_cases, rejected


def write_jsonl(path: str, records: list[dict]) -> None:
    out_path = Path(path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as f:
        for record in records:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")


def main() -> None:
    settings = load_config()
    clean_cases, rejected = build_corpus(settings)

    write_jsonl(settings.paths.clean_jsonl, [c.model_dump() for c in clean_cases])
    write_jsonl(settings.paths.review_jsonl, rejected)

    print(f"[ingest] clean: {len(clean_cases)} -> {settings.paths.clean_jsonl}")
    print(f"[ingest] review: {len(rejected)} -> {settings.paths.review_jsonl}")


if __name__ == "__main__":
    main()