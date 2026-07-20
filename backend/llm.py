"""
backend.llm -- Gemini-generated replies, grounded in retrieved cases.
"""

from __future__ import annotations

import json
import os
import re
import time
from collections import OrderedDict

from google import genai
from google.genai import types

MODEL = "gemini-2.5-flash"

# --- caching + retry --------------------------------------------------------
# The free Gemini tier is tightly rate limited, so we (a) cache successful
# replies and translations by their exact inputs, and (b) retry only transient
# failures. Identical questions then cost zero API calls, and a brief network
# blip doesn't fall straight through to the offline fallback.
_REPLY_CACHE: "OrderedDict[str, str]" = OrderedDict()
_TRANSLATION_CACHE: "OrderedDict[str, str]" = OrderedDict()
_CACHE_MAX = 256


def _cache_get(cache: "OrderedDict[str, str]", key: str) -> str | None:
    if key in cache:
        cache.move_to_end(key)  # LRU: mark as recently used
        return cache[key]
    return None


def _cache_put(cache: "OrderedDict[str, str]", key: str, value: str) -> None:
    cache[key] = value
    cache.move_to_end(key)
    while len(cache) > _CACHE_MAX:
        cache.popitem(last=False)  # evict least-recently-used


def _is_permanent_quota_error(exc: Exception) -> bool:
    """A daily-quota 429 won't clear on a short retry, so we fail fast to the
    offline fallback instead of stalling the request retrying it."""
    text = str(exc).upper()
    return "429" in text or "RESOURCE_EXHAUSTED" in text or "QUOTA" in text


def _generate_with_retry(client: "genai.Client", **kwargs):
    """Call Gemini, retrying only transient errors (network/5xx) up to twice
    with a short backoff. Quota errors and empty results are not retried."""
    last_exc: Exception | None = None
    for attempt in range(3):
        try:
            return client.models.generate_content(**kwargs)
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            if _is_permanent_quota_error(exc) or attempt == 2:
                raise
            time.sleep(0.5 * (attempt + 1))  # 0.5s, 1.0s
    raise last_exc  # unreachable, but keeps type checkers happy
# Enough headroom for a full 5-case Problem/Resolution listing. Arabic replies
# spend noticeably more tokens on the same content, and a truncated answer
# would cut off mid-resolution.
MAX_OUTPUT_TOKENS = 900

_ARABIC_RE = re.compile(r"[\u0600-\u06FF]")


def needs_translation(text: str) -> bool:
    """Heuristic: does this look like it contains Arabic script?"""
    return bool(_ARABIC_RE.search(text))


def translate_to_english(query: str) -> str:
    """Translate non-English queries to English before retrieval."""
    if not needs_translation(query):
        return query

    cached = _cache_get(_TRANSLATION_CACHE, query)
    if cached is not None:
        return cached

    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        return query

    try:
        client = genai.Client(api_key=api_key)
        response = _generate_with_retry(
            client,
            model=MODEL,
            contents=query,
            config=types.GenerateContentConfig(
                system_instruction=(
                    "Translate the user's message to English. Return ONLY the "
                    "English translation, nothing else."
                ),
                max_output_tokens=200,
                temperature=0,
                thinking_config=types.ThinkingConfig(thinking_budget=0),
            ),
        )
        result = (response.text or "").strip() or query
    except Exception:
        return query

    _cache_put(_TRANSLATION_CACHE, query, result)
    return result


_SYSTEM_PROMPT = """You are SupportBot, a technical support assistant.

LANGUAGE: Always reply in the SAME language the user's message is written in. Translate the case content into the user's language yourself.

GROUNDING RULES (these override every formatting rule below):
- The "Retrieved cases" section of the user message is your ONLY source of cases. Never invent a product name, a problem, or a resolution, and never use cases from earlier messages or your own knowledge.
- Every case you list must be copied faithfully from the retrieved cases.
- If the retrieved cases section says none were retrieved (or is empty), you have NOTHING to list: output NO Problem/Resolution lines and NO lead-in sentence, and never fabricate a case. What you say instead depends on the message (see BEHAVIOR): only mention that no matching past case was found when the user actually described a device/product problem. For a greeting, thanks, or anything off-topic, do NOT mention cases at all -- just chat back warmly.
- Do NOT use Markdown (no **, no __, no #, no bullets). The interface applies its own styling.

OUTPUT FORMAT (CRITICAL):
When -- and only when -- you have at least one retrieved case to list, open with ONE short lead-in sentence making clear these came from past support cases -- for example "Here are the problems and resolutions I found in past cases:". Then a blank line, then the cases.

Write each case as exactly three lines -- a "Case ID:" line, then a "Problem:" line, then a "Resolution:" line directly beneath it. The Case ID identifies the exact past case (the row in the data) that the problem and its fix were found in:

Here are the problems and resolutions I found in past cases:

Case ID: [the case id]
Problem: [the problem text]
Resolution: [the resolution text]

Separate consecutive cases with one blank line:

Case ID: [first case id]
Problem: [first problem]
Resolution: [first resolution]

Case ID: [second case id]
Problem: [second problem]
Resolution: [second resolution]

Rules for this format:
- Always start a list of cases with the single lead-in sentence described above, then a blank line before the first Case ID.
- Copy the Case ID exactly as given for that case in the retrieved cases -- it is the ID of the row the Problem and Resolution came from. Never invent, alter, guess, or omit it, and never reuse one case's ID for another case's problem.
- Keep "Case ID:", "Problem:" and "Resolution:" each at the start of its own line, in that order, one case after another.
- Never write a case with a Problem but no Resolution.
- Each label sits at the very start of its line, followed by a colon.
- When replying in another language, write the lead-in sentence AND translate the "Problem"/"Resolution" labels too (the interface styles whatever label starts the line). Leave the Case ID value itself unchanged -- it is an identifier, not translatable text.

BEHAVIOR:
- The user is describing a specific problem: find the retrieved case whose Problem actually matches the symptom they describe, and give THAT case's Case ID, its Problem, and ITS OWN Resolution. The Case ID and Resolution you show must belong to the same case as the Problem above them -- never answer one problem with another case's ID or fix.
- If several retrieved cases genuinely describe the same symptom, list each as its own Problem/Resolution pair.
- If the user clearly described a device/product problem but none of the retrieved cases matches it, say warmly that you couldn't find a matching past case, and ask for a little more detail (which device, what exactly happens). Do NOT stretch an unrelated case to fit, and do not guess a resolution.
- Casual, off-topic, or small-talk message -- a greeting, thanks, or something unrelated to product support (for example "I like football", "how are you", "what's the weather"): do NOT mention past cases or "no matching cases" at all. Reply warmly, acknowledging what they said in a few words, and you MUST then invite them to a product question -- always end with an offer to help, such as "How can I help you with our product today?". Example: for "I like Messi" -> "That's great! How can I help you with our product today?". Never output a Problem/Resolution block.
"""

# Appended to the system prompt per request. The greeting is gated on the first
# question so it happens once, not before every answer.
_GREETING_RULE = (
    "\nGREETING: This is the user's first message in the chat. Open your reply "
    "with one short, warm greeting sentence in the user's language, then continue "
    "with the answer in the format above."
)
_NO_GREETING_RULE = (
    "\nGREETING: Do NOT greet. Go straight to the answer with no greeting or pleasantries."
)

# Used when the user typed only a product name. Overrides the case-listing
# format above: summarise instead of dumping every case.
_PRODUCT_SUMMARY_RULE = (
    "\nMODE -- PRODUCT OVERVIEW: The user named a product without describing a "
    "specific problem. Do EXACTLY these three things, in the user's language, and "
    "nothing else:\n"
    "1. State how many past cases were found for this product, using EXACTLY the "
    "number given in the product info (do not recount or change it).\n"
    "2. If an example problem is provided, give it, phrased like: For example, one "
    "of the cases is: <the example problem text>. If no example is provided, skip "
    "this line entirely -- never invent an example.\n"
    "3. Ask the user to describe the specific problem they are facing, so you can "
    "find the matching resolution.\n"
    "Do NOT list multiple cases, do NOT give any resolution, and do NOT use the "
    "'Here are the problems and resolutions' lead-in. Keep it short."
)


def _format_product_summary(summary: dict) -> str:
    """The context block for a product-overview reply -- the real corpus count
    and one example problem, which the model must relay rather than invent."""
    example = summary.get("example_problem", "")
    example_line = (
        f"Example problem to quote: {example}"
        if example
        else "Example problem to quote: (none available -- do not include an example)"
    )
    return (
        "Product info (the user named this product with no specific symptom):\n"
        f"Product: {summary.get('product', '')}\n"
        f"Number of past cases for this product in the data: {summary.get('count', 0)}\n"
        f"{example_line}"
    )


def _format_context(hits: list[dict]) -> str:
    """Lay each case out as discrete labelled fields.

    The model is asked to echo Problem/Resolution back verbatim, so it has to
    receive them as separate fields. Handing over the whole `document` blob
    instead leaves it to re-parse the fix out of the prose -- which is exactly
    the guesswork grounding is supposed to remove.
    """
    if not hits:
        return (
            "NONE. No past cases were retrieved for this message. "
            "Never list or invent a Problem/Resolution case. If the user described a "
            "device/product problem, tell them warmly that no matching past case was "
            "found and ask for a little more detail. If the message is a greeting, "
            "thanks, or off-topic small talk, do NOT mention cases at all -- reply "
            "briefly and warmly, then invite them to describe a product issue you can "
            "help with."
        )

    blocks = []
    for h in hits:
        fields = [
            f"Case ID: {h.get('case_id', '')}",
            f"Product: {h.get('product', '')}",
            f"Category: {h.get('category', '')}",
            f"Problem: {h.get('problem', '')}",
        ]
        if h.get("cause"):
            fields.append(f"Cause: {h['cause']}")
        fields.append(f"Resolution: {h.get('resolution', '')}")
        blocks.append("\n".join(fields))

    return "\n\n---\n\n".join(blocks)


def generate_reply(
    query: str,
    hits: list[dict],
    greet: bool = False,
    product_summary: dict | None = None,
) -> str:
    """Ask Gemini for a short, grounded reply.

    `greet` is True only for the first question in a chat, which adds a single
    opening greeting; every later reply goes straight to the answer.

    `product_summary` (from rag.retrieve.detect_product_query) switches the
    reply into overview mode: report the case count + one example and ask for
    the specific problem, instead of answering with a resolution.
    """
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is not set in backend/.env")

    if product_summary is not None:
        context = _format_product_summary(product_summary)
        mode_rule = _PRODUCT_SUMMARY_RULE
    else:
        context = _format_context(hits)
        mode_rule = ""

    system_instruction = (
        _SYSTEM_PROMPT + mode_rule + (_GREETING_RULE if greet else _NO_GREETING_RULE)
    )
    user_content = f"User message: {query}\n\nRetrieved cases:\n{context}"

    # Cache on everything that shapes the answer, so an identical repeat costs
    # no API call (and stays stable across the free tier's rate limits).
    cache_key = json.dumps([system_instruction, user_content], sort_keys=True)
    cached = _cache_get(_REPLY_CACHE, cache_key)
    if cached is not None:
        return cached

    client = genai.Client(api_key=api_key)
    response = _generate_with_retry(
        client,
        model=MODEL,
        contents=user_content,
        config=types.GenerateContentConfig(
            system_instruction=system_instruction,
            max_output_tokens=MAX_OUTPUT_TOKENS,
            temperature=0.3,
            thinking_config=types.ThinkingConfig(thinking_budget=0),
        ),
    )

    text = (response.text or "").strip()
    if not text:
        raise RuntimeError("Gemini returned an empty response")
    _cache_put(_REPLY_CACHE, cache_key, text)
    return text