"""
backend.llm -- Gemini-generated replies, grounded in retrieved cases.

This is the ONE piece of the stack that needs the internet and (beyond a free
tier) can cost money -- everything else (embeddings, ChromaDB, auth) is free
and local. Requires GEMINI_API_KEY in backend/.env. Get a free key at
https://aistudio.google.com/apikey -- Google AI Studio's free tier covers
light development use.

If the key is missing or the call fails for any reason (rate limit, network,
bad key), generate_reply() raises, and main.py falls back to a plain
retrieval-only reply rather than crashing the chat.

Uses the current Google GenAI SDK (`google-genai` package, `from google import
genai`) -- NOT the older, now-deprecated `google-generativeai` package that
a lot of older tutorials still show.

Model: gemini-2.5-flash -- fast and inexpensive, appropriate for short,
grounded replies over a small context.
"""

from __future__ import annotations

import os
import re

from google import genai
from google.genai import types

MODEL = "gemini-2.5-flash"
MAX_OUTPUT_TOKENS = 500

_ARABIC_RE = re.compile(r"[\u0600-\u06FF]")


def needs_translation(text: str) -> bool:
    """Heuristic: does this look like it contains Arabic script? Cheap local
    check, no API call, so English queries (the common case) never pay for
    a translation round-trip they don't need."""
    return bool(_ARABIC_RE.search(text))


def translate_to_english(query: str) -> str:
    """Translate a non-English query to English before retrieval.

    Why this exists: the embedder (MiniLM, all-MiniLM-L6-v2) was trained
    almost entirely on English text. Embedding an Arabic query with it does
    NOT produce a vector that meaningfully represents the query's meaning
    the way it does for English -- the "closest matches" ChromaDB returns
    for an Arabic query are close to random, not actually relevant. This
    silently produced wrong-looking answers with no error anywhere, which
    is worse than an outright failure. Translating to English first gives
    retrieval something the embedder can actually work with; the final
    reply is still generated in the user's original language (see
    generate_reply's LANGUAGE instruction) -- only the *retrieval* step
    uses the translation.

    Falls back to returning the original query untouched if translation
    fails for any reason (no key, network, bad response) -- never crashes
    the chat over this, same policy as generate_reply."""
    if not needs_translation(query):
        return query

    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        return query

    try:
        client = genai.Client(api_key=api_key)
        response = client.models.generate_content(
            model=MODEL,
            contents=query,
            config=types.GenerateContentConfig(
                system_instruction=(
                    "Translate the user's message to English. Return ONLY the "
                    "English translation, nothing else -- no quotes, no explanation."
                ),
                max_output_tokens=200,
                temperature=0,
                thinking_config=types.ThinkingConfig(thinking_budget=0),
            ),
        )
        translated = (response.text or "").strip()
        return translated or query
    except Exception:  # noqa: BLE001 -- translation is best-effort, never fatal
        return query


_SYSTEM_PROMPT = """You are SupportBot, a helpful teammate for Elsewedy Electric's device support team, chatting directly with an engineer.

LANGUAGE: Always reply in the SAME language the user's message is written in. If they write in Arabic, reply entirely in Arabic. If English, reply in English. The retrieved case data below is in English regardless -- translate the relevant content into the user's language yourself, in your own words. Never default to English just because the case data is in English.

GROUNDING -- this is the most important rule, more important than sounding natural:
- The cases listed below (if any) have already been filtered to only genuinely relevant matches for this exact query -- if the list below is empty, that means NOTHING relevant was found, full stop. Do not describe, hint at, or paraphrase any other case in that situation; just say plainly that nothing close was found.
- Before answering, explicitly check: does the case's own "Problem:" text describe the SAME specific symptom the user just described -- not just the same product or same general area? Same product with a DIFFERENT specific symptom is NOT a match.
  Example of what NOT to do: user asks about configuration resetting after a power cycle; the closest retrieved case is actually about random reboots caused by an undersized power supply on the SAME product. These are different problems. Do not present the power-supply fix as if it resolves the configuration-reset issue just because it's the same product and the closest thing available -- say plainly that no case matches this specific symptom instead.
- Base your answer on ONLY the single closest matching case (the first one listed below, lowest distance) unless a second case is genuinely needed to fully answer the question.
- NEVER blend or combine details from multiple different cases into one invented narrative (e.g. do not say "we've seen this with Product A and Product B" unless BOTH literally appear together in the SAME case's cause/resolution -- if they're in separate cases, only describe the one case you're actually citing).
- NEVER state a cause, fix, or product that is not written, word for word in substance, in the case content given below. If you're not sure a detail is actually in the retrieved text, leave it out rather than guess or infer a plausible-sounding elaboration.
- The resolution you describe must address the SAME problem the person described -- never repurpose a resolution that was for a different symptom, even if it's the closest thing available.

STYLE: Speak naturally and warmly, like a knowledgeable colleague, not a formal report. Do not recite case IDs or labels like "Cause:"/"Resolution:" -- just talk normally about what happened and what fixed it, restricted strictly to what that one case actually says.

Behavior:
- Casual messages (greetings, thanks, small talk, "what are you") get a natural, brief, friendly reply in the user's own language -- then gently invite them to describe an issue.
- A device issue with a relevant retrieved case: explain in your own words what was wrong and what fixed it, using ONLY that case's actual content.
- A device issue with no good matches: say plainly that nothing close was found -- don't guess.
- Keep it short: 2-3 sentences, like a real chat reply, not a summary.
"""


def _format_context(hits: list[dict]) -> str:
    if not hits:
        return "(no relevant cases retrieved for this message)"
    lines = []
    for h in hits:
        lines.append(
            f"- Case {h['case_id']} | {h['product']} / {h['category']} "
            f"(semantic distance {h['distance']:.3f}, lower = closer match)\n"
            f"  {h['document']}"
        )
    return "\n".join(lines)


def generate_reply(query: str, hits: list[dict]) -> str:
    """Ask Gemini for a short, grounded reply. Raises RuntimeError/SDK errors
    on failure -- callers should catch and fall back gracefully."""
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is not set in backend/.env")

    client = genai.Client(api_key=api_key)
    context = _format_context(hits)

    response = client.models.generate_content(
        model=MODEL,
        contents=f"User message: {query}\n\nRetrieved cases:\n{context}",
        config=types.GenerateContentConfig(
            system_instruction=_SYSTEM_PROMPT,
            max_output_tokens=MAX_OUTPUT_TOKENS,
            temperature=0.3,
            # Gemini 2.5 Flash has "thinking" on by default, and thinking
            # tokens are deducted from the SAME max_output_tokens budget as
            # the visible reply -- this silently truncates short answers
            # (a known, documented behavior, not a bug in this code). This
            # task is simple grounded Q&A, not multi-step reasoning, so we
            # turn thinking off and give the full budget to the actual reply.
            thinking_config=types.ThinkingConfig(thinking_budget=0),
        ),
    )

    text = (response.text or "").strip()
    if not text:
        raise RuntimeError("Gemini returned an empty response")
    return text
