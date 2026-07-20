"""
Retriever evaluation against eval/eval_set_public.json.

The eval set ships query TYPES (identifier / paraphrase / out_of_domain) but no
gold case_ids. This harness supplies gold labels derived directly from
data/cases_clean.jsonl by symptom cluster (+ the named product for identifiers),
so it scores real retrieval metrics rather than eyeballing hits.

Metrics, per query type and overall:
  - Hit@1 / Hit@3 / Hit@5 : is a gold case in the top-N?
  - MRR@5                  : 1 / rank of the first gold hit (0 if none in top-5)
  - Product P@1 (id only)  : does top-1's product == the named product?
  - Rejection (ood only)   : correctly returns NO grounded hit (all dist > 0.65)?

All three public searches are run (semantic, keyword, hybrid). `hybrid` is what
backend/main.py actually serves, so the script EXITS NON-ZERO if hybrid is less
than perfect on the answerable queries or lets any out-of-domain query through
-- i.e. it doubles as a regression gate.

Run from the project root:
    uv run python -m eval.eval_retriever      # or: uv run python eval/eval_retriever.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from rag.config import load_config
from rag.retrieve import semantic_search, keyword_search, hybrid_search

GOOD_MATCH_MAX_DISTANCE = 0.65  # mirrors backend/main.py's grounding threshold
EVAL_PATH = Path(__file__).with_name("eval_set_public.json")

# Gold case_ids per query, read off data/cases_clean.jsonl by symptom cluster.
# For identifiers the gold is the correct-product + correct-symptom case(s);
# for paraphrases it is every case matching the symptom, any product.
GOLD: dict[str, dict] = {
    "q1":  {"product": "AeroSense G3", "gold": {"3070-8945"}},
    "q2":  {"product": "PowerTrack P1", "gold": {"4373-4197", "4443-9480"}},
    "q3":  {"product": "FlowMeter X200", "gold": {"8801-4410", "8802-4411"}},
    "q4":  {"product": "GridLink Hub", "gold": {"8810-6630", "8811-6631"}},
    "q5":  {"product": "ThermoNode T5", "gold": {"8841-9971"}},
    "q6":  {"gold": {"1554-7851", "4158-5278", "4871-2964", "8803-5520", "8804-5521"}},
    "q7":  {"gold": {"2356-7909", "3699-5132", "8801-4410", "8802-4411"}},
    "q8":  {"gold": {"8812-6640", "8813-6641", "5102-8624", "5270-2683", "4546-8737"}},
    "q9":  {"gold": {"2740-4575", "3783-2889", "3885-2407", "4770-1031", "4960-8109"}},
    "q10": {"gold": {"2062-8424", "3334-7428", "4619-6726", "5042-2391"}},
    "q11": {"gold": {"2532-2064", "3943-3645"}},
    "q12": {"gold": {"8831-8861"}},
    "q13": {"gold": set()},  # out of domain -> retrieving nothing is correct
    "q14": {"gold": set()},
    "q15": {"gold": set()},
}


def _first_gold_rank(hits, gold):
    for i, h in enumerate(hits, start=1):
        if h["case_id"] in gold:
            return i
    return None


def _run_engine(search_fn, settings, eval_rows):
    rows_out, per_type = [], {}
    for row in eval_rows:
        qid, query, qtype = row["id"], row["query"], row["type"]
        g = GOLD[qid]
        hits = search_fn(query, settings, top_k=5)
        rank = _first_gold_rank(hits, g["gold"])
        top = hits[0] if hits else None
        rec = {
            "id": qid, "type": qtype, "query": query, "rank": rank,
            "hit1": rank == 1,
            "hit3": rank is not None and rank <= 3,
            "hit5": rank is not None and rank <= 5,
            "rr": (1.0 / rank) if rank else 0.0,
            "top_product": top["product"] if top else None,
            "top_dist": top["distance"] if top else None,
            "top_problem": top["problem"] if top else None,
            "grounded1": bool(top and top["distance"] <= GOOD_MATCH_MAX_DISTANCE),
            "any_grounded": any(h["distance"] <= GOOD_MATCH_MAX_DISTANCE for h in hits),
        }
        if qtype == "identifier":
            rec["product_p1"] = bool(top and top["product"] == g["product"])
        if qtype == "out_of_domain":
            rec["rejected"] = not rec["any_grounded"]
        rows_out.append(rec)
        per_type.setdefault(qtype, []).append(rec)
    return rows_out, per_type


def _pct(xs):
    return 100.0 * sum(bool(x) for x in xs) / len(xs) if xs else 0.0


def _summarize(name, rows_out, per_type):
    print(f"\n{'='*74}\n  ENGINE: {name}\n{'='*74}")
    for qtype in ("identifier", "paraphrase", "out_of_domain"):
        rows = per_type.get(qtype, [])
        if not rows:
            continue
        print(f"\n-- {qtype} ({len(rows)} queries)")
        for r in rows:
            rank = r["rank"] if r["rank"] else "-"
            gr = "grounded" if r["grounded1"] else "REJECTED"
            dist = f"{r['top_dist']:.3f}" if r["top_dist"] is not None else "  -  "
            extra = ""
            if qtype == "identifier":
                extra = "  prodP@1=" + ("Y" if r.get("product_p1") else "N")
            if qtype == "out_of_domain":
                extra = "  rejected=" + ("Y" if r.get("rejected") else "N")
            print(f"   {r['id']:>3} rank={str(rank):>2} [{dist} {gr}] "
                  f"{r['top_product']} :: {str(r['top_problem'])[:40]}{extra}")
        if qtype == "out_of_domain":
            print(f"   >> rejection rate: {_pct([r['rejected'] for r in rows]):.0f}%")
        else:
            print(f"   >> Hit@1={_pct([r['hit1'] for r in rows]):.0f}%  "
                  f"Hit@3={_pct([r['hit3'] for r in rows]):.0f}%  "
                  f"Hit@5={_pct([r['hit5'] for r in rows]):.0f}%  "
                  f"MRR@5={sum(r['rr'] for r in rows)/len(rows):.3f}")
            if qtype == "identifier":
                print(f"   >> Product P@1: {_pct([r['product_p1'] for r in rows]):.0f}%")


def main() -> int:
    settings = load_config()
    eval_rows = json.loads(EVAL_PATH.read_text(encoding="utf-8"))

    engines = [
        ("hybrid (served by app)", hybrid_search),
        ("semantic only", semantic_search),
        ("keyword only (BM25)", keyword_search),
    ]
    hybrid_rows = None
    for name, fn in engines:
        rows_out, per_type = _run_engine(fn, settings, eval_rows)
        _summarize(name, rows_out, per_type)
        if fn is hybrid_search:
            hybrid_rows = rows_out

    # Regression gate on the served engine.
    answerable = [r for r in hybrid_rows if r["type"] != "out_of_domain"]
    ood = [r for r in hybrid_rows if r["type"] == "out_of_domain"]
    hit1 = _pct([r["hit1"] for r in answerable])
    reject = _pct([r["rejected"] for r in ood])
    print(f"\n{'='*74}\n  GATE (hybrid): answerable Hit@1={hit1:.0f}%, OOD rejection={reject:.0f}%")
    if hit1 < 100.0 or reject < 100.0:
        print("  RESULT: FAIL -- served retriever regressed.")
        return 1
    print("  RESULT: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
