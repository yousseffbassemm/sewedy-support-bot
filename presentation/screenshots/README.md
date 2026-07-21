# Screenshots

Filenames map to slide numbers in `../SLIDES.md`. `slide-11-*.png` goes on slide 11.

## Already captured — usable as-is

| File | Slide | Note |
|---|---|---|
| `slide-03-landing-hero-light.png` | 3 | Landing hero, light mode |
| `slide-11-embedding-map.png` | 11 | Embedding plot is slightly cropped at the bottom — retake if you want the whole panel |
| `slide-12-small-talk.png` | 12 | |
| `slide-13-offline-fallback.png` | 13 | Genuine offline fallback (Gemini quota spent) — correct for this slide |
| `slide-14-auth-signin.png` | 14 | |
| `slide-15-arabic-rtl.png` | 15 | |
| `slide-16-dark-mode.png` | 16 | |
| `slide-17-mobile.png` | 17 | Drawer is closed — reshoot with the hamburger open if you want to show it |

## Still to capture

| File | Slide | How |
|---|---|---|
| `slide-04-architecture.png` | 4 | Draw the diagram yourself in PowerPoint |
| `slide-05-ingest-terminal.png` | 5 | `uv run python -m rag.ingest` |
| `slide-06-index-terminal.png` | 6 | `uv run python -m rag.index` |
| `slide-08-threshold-rejected.png` | 8 | Ask the bot `what is the capital of France` |
| `slide-09-grounded-answer.png` | 9 | **Most important slide.** Needs Gemini quota available — see below |
| `slide-10-followup-memory.png` | 10 | Same session as slide 9, then ask `does it happen on the FlowMeter X100 too` |
| `slide-18-eval-terminal.png` | 18 | `uv run python -m eval.eval_retriever` — capture the **hybrid** block and the GATE line |
| `slide-19-tests-ci.png` | 19 | `uv run pytest -q` |

## Important: slides 9 and 10 need Gemini quota

Gemini's free tier allows **20 requests per day**. That was spent during this
session, so any chat screenshot taken now shows the offline fallback with
*"Answer-writing service unavailable"* — which is correct for slide 13 but wrong
for slide 9.

The quota resets daily. Check it's back with:

```bash
curl -s -X POST http://127.0.0.1:8000/chat \
  -H "Content-Type: application/json" \
  -d '{"query":"my ThermoNode T5 firmware update keeps failing halfway"}'
```

If the response contains `"grounded":true`, the LLM is answering and you can take
slides 9 and 10.

## reference/

Extra captures not tied to a slide — spare framing options for the landing page,
the empty chat state, and dark-mode chat. Use them if you want an extra visual.

## Automated capture

`../capture_screenshots.mjs` drives headless Edge over the DevTools Protocol and
retakes all of these. Needs the backend on :8000 and the frontend on :5173:

```bash
node presentation/capture_screenshots.mjs           # everything
node presentation/capture_screenshots.mjs chat      # just the chat slides
```

It logs a warning instead of saving slide 9 if it detects the offline fallback,
so it will never pass a fallback screenshot off as a live answer.
