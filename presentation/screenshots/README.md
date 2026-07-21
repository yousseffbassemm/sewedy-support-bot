# Screenshots

Filenames map to slide numbers in `../SLIDES.md`. `slide-11-*.png` goes on slide 11.
All images are 2x resolution so they stay sharp when projected.

| File | Slide | Shows |
|---|---|---|
| `slide-03-landing-hero-light.png` | 3 | Landing page, light mode |
| `slide-05-ingest-terminal.png` | 5 | `rag.ingest` — 69 rows → 66 clean, 3 to review |
| `slide-06-index-terminal.png` | 6 | `rag.index` — 66 cases embedded, dim=384 |
| `slide-08-threshold-rejected.png` | 8 | Off-domain question refused |
| `slide-09-grounded-answer.png` | 9 | Live grounded answer citing Case ID 3008-2359 |
| `slide-10-followup-memory.png` | 10 | Follow-up resolving "it" to the previous topic |
| `slide-11-embedding-map.png` | 11 | Embedding plot with legend |
| `slide-12-small-talk.png` | 12 | Chit-chat redirected to product help |
| `slide-13-offline-fallback.png` | 13 | Cases served with the LLM unavailable |
| `slide-14-auth-signin.png` | 14 | Sign-in screen |
| `slide-15-arabic-rtl.png` | 15 | Arabic, full RTL |
| `slide-16-dark-mode.png` | 16 | Landing, dark mode |
| `slide-16b-dark-chat.png` | 16 | Chat in dark mode (optional) |
| `slide-17-mobile-landing.png` | 17 | Landing at 390px |
| `slide-17b-mobile-drawer.png` | 17 | Mobile drawer open (optional) |
| `slide-18-eval-terminal.png` | 18 | Evaluation output + GATE PASS |
| `slide-19-tests-terminal.png` | 19 | `pytest -q` — 55 passed |

Slide 4 (architecture) is the only one you draw yourself.

## How these were made

**Web screenshots** — `../capture_screenshots.mjs` drives a real headless Edge
over the DevTools Protocol: it logs in against the live API with your account,
opens the chat, asks real questions and waits for real answers before capturing.
Slides 9 and 10 are genuine Gemini responses.

Static `--screenshot` captures could not be used: the landing preview stages its
reveal through `requestAnimationFrame`, which does not advance under headless
virtual-time, so the preview box renders empty.

```bash
DECK_EMAIL=you@example.com DECK_PASSWORD=... node ../capture_screenshots.mjs
node ../capture_screenshots.mjs chat dark      # only matching steps
```

Credentials are read from the environment and never written to disk.

**Terminal images** (5, 6, 18, 19) — `../render_terminal.py` runs the real
commands and draws their actual stdout into a clean terminal window. This beats
photographing a console: consistent size, high resolution, no shell prompt or
window chrome, readable from the back of a room. The text is real output, only
trimmed to the relevant block.

```bash
python ../render_terminal.py     # needs Pillow
```

## Slide 13 was produced deliberately

The offline fallback only appears when the LLM is unreachable. Rather than
exhausting Gemini's 20-requests-per-day free tier to trigger it — which would
have left nothing for a live demo — the backend was briefly restarted with the
API key unset, the screenshot taken, and the key restored. The screenshot shows
the real fallback path, not a mock.
