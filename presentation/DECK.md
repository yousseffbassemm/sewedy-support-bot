# SupportBot deck — how it's built

`SupportBot.pptx` (18 slides) is generated, not hand-made, so it can be rebuilt
after any copy or screenshot change. The byline is a single constant (`BYLINE`
near the top of `build_deck.py`) — edit it to add the full team, then rebuild.

## Defending the metrics live (slides 12–13) — READ BEFORE PRESENTING

A technical reviewer will hear "100% Hit@1, MRR@5 = 1.000, 100% abstention" and
ask: *"A perfect score? Walk me through how."* Here is the honest, reproducible
answer — rehearse it, because a confident, caveated answer earns credibility and
a defensive one loses it.

**Reproduce it in front of them (one command):**
```
uv run python -m eval.eval_retriever
```
It prints per-query results for all three engines and a PASS/FAIL gate. The same
command runs in GitHub Actions on **every commit** — so the number is not a
one-off on one laptop; CI has re-derived it green every push.

**"Walk me through the perfect score":**
- It's a **15-query gold set over a 66-case corpus** — 5 exact-identifier, 7
  paraphrase, 3 out-of-domain. It's a **regression gate**, not a benchmark
  leaderboard. Perfect on it means "no regressions on the cases we care about
  and correct abstention", not "retrieval is flawless in general".
- The gold labels are **objective**, tied to the case text: q6 "the numbers keep
  creeping upward" is labelled with the cases whose problem literally reads
  "Readings drift higher over time". They are not "whatever the retriever
  returned" — that would be circular; these are the semantically correct cases.
- Several **paraphrase queries have several valid answers**, because the same
  fault genuinely recurs across products (the 1-in-3 recurrence from slide 2).
  "Temperature reading is offset" matches five cases across five products;
  ranking any one of them first is a correct hit. That is realistic, and it is
  why Hit@1 is achievable — say so plainly rather than hide it.

**"Earlier runs showed ~0.77 MRR and a paraphrase miss — why is it 1.000 now?"**
Two real engineering changes closed that gap, both in commit `32dd604`:
1. A **BM25 stopword filter** fixed a fusion regression on q11 ("device is
   completely dead") where filler tokens ("device"/"unit") cast spurious
   keyword votes. That is the "known paraphrase miss".
2. **Nine resolution-less cases were completed** and re-indexed (57 → 66
   searchable), which also gave the recurring-fault paraphrases more valid
   targets.
The ~0.77 figure is what **keyword-only (BM25)** still scores on paraphrase
today (MRR@5 = 0.714) — so it is real, and it is exactly why we do not ship
BM25 alone. Show that row.

**"If semantic-only is already 100%, why hybrid?"** (slide 13 answers this
honestly and you must too):
- On this gold set, **semantic-only also scores 100% / MRR 1.000**. Hybrid does
  **not** beat it here. Do not claim it does.
- We run hybrid for **robustness on exact model/part numbers** — G2 vs G3 sit
  almost on top of each other in embedding space, and BM25's exact tokens keep
  them distinct. Hybrid keeps semantic's paraphrase recall *and* that exact-match
  safety, trading away neither. That is a design choice for the real world, not
  a scoreboard win — slide 13 says exactly this.

**The one thing not to say:** never present MRR = 1.000 as evidence the system
is "solved". It is evidence the gate is green. If asked about scale, be honest:
the next step is a larger, independently-labelled evaluation set.

## Rebuild

```bash
uv run python presentation/build_deck.py                  # -> presentation/SupportBot.pptx
uv run python presentation/build_deck.py /tmp/draft.pptx  # draft, to a different path
```

The optional output path exists because PowerPoint holds an **exclusive lock**
on an open file: rebuilding while the deck is open fails with `PermissionError`.
Build a draft elsewhere, review it, then write the real file once PowerPoint is
closed. Never kill the PowerPoint process to break the lock — it may be someone
looking at the deck.

That reads `presentation/structure.pptx` + `presentation/screenshots/*.png`.

## Why there are three .pptx files

| File | What it is |
|---|---|
| `template.pptx` | An unblocked copy of the mentor's *AI Internship Presentation Template*. Untouched. |
| `structure.pptx` | The template's 4 slides duplicated into the 10-slide running order. Built **by PowerPoint itself** (COM), because duplicating a slide natively copies its grouped freeforms *and their image relationships* — a hand-rolled XML deepcopy does not do that reliably. |
| `SupportBot.pptx` | The deliverable. |

All three are git-ignored (~50MB combined); `build_deck.py` and the screenshots
are the tracked source of truth.

To rebuild `structure.pptx` from scratch, see the COM snippet in the project
history — it duplicates template slides in the order
`1, 2, 3, 2,2,2,2, 3, 2,2,2,2,2, 3, 2,2,2,2, 4` (cover, problem, separator,
white ×4, separator, white ×5, separator, white ×4, thank-you) and deletes the
four originals. **If you change the running order, update both that array and
the separator indices in `set_transition` at the bottom of `build_deck.py`** —
they are the same positions (currently 3, 8, 14) and will silently disagree
otherwise.

## The template rule

The mentor's instruction was to change the text only, not the design. So the
build script **never** restyles, moves, resizes or recolours a template shape.
It does exactly two things:

1. **Rewrites text inside the template's own text boxes**, reusing their
   existing runs — so font, size and colour are inherited rather than
   re-declared. (This is why the separator numerals keep their two-tone
   treatment: `0` white, `1` red, straight from the template's own runs.)
2. **Adds our content** — body copy and product screenshots — into the white
   slide's empty canvas.

### Safe-area constants

The white content slide is 28.67 × 16.00in. `build_deck.py` keeps everything
clear of the template's graphics:

- the red vertical rule at ~x=1.8in
- the Elsewedy mark, top right, above y≈2.6in
- the WEDY.AI mark, bottom left
- the red network graphic, bottom right from roughly x=21.5in / y=11.5in

Hence `CONTENT_TOP=3.0in`, `IMG_BOTTOM_LIMIT=11.4in` (right column),
`CONTENT_BOTTOM_TEXT=12.6in` (left column), `IMG_RIGHT_LIMIT=26.6in`.

**Vertical centring.** Body text is put in a box spanning the whole content
band and middle-anchored (`MSO_ANCHOR.MIDDLE`), so short copy sits at the
optical centre instead of clinging to the top; images and stat callouts are
centred in the same band. **Every screenshot gets a soft drop shadow** via
`_add_shadow` (python-pptx has no shadow API, so the `a:outerShdw` element is
appended to the picture's `spPr` by hand — valid as the last child).

## Running order (19 slides, 3 sections)

| # | Slide | Screenshot |
|---|---|---|
| 1 | SupportBot (cover + author byline) | — |
| 2 | The problem | — (stat callout) |
| 3 | **01 · The Product** | — |
| 4 | Find the fix | landing hero |
| 5 | Cited answers | grounded answer |
| 6 | It remembers | follow-up memory |
| 7 | Shows its work | embedding map |
| 8 | **02 · Trust** | — |
| 9 | Stays in scope | out-of-scope refusal |
| 10 | Small talk | small talk |
| 11 | Always answers | offline fallback |
| 12 | How we measured it | — (stat callouts) |
| 13 | Why hybrid search | — (stat callouts) |
| 14 | **03 · The Experience** | — |
| 15 | Fully bilingual | Arabic RTL |
| 16 | Light and dark | dark mode (theming only) |
| 17 | On any screen | mobile chat (captured live, demo account) |
| 18 | Your account | sign-in |
| 19 | Thank you | — |

Slide 16 (theming) and 17 (mobile) used to be one combined slide; they were
split on request so responsive/mobile stands on its own, with a fresh mobile
chat screenshot captured at phone-width on a clean demo account (`slide-19-
mobile-chat.png`). One phone, not two — the older drawer/landing mobile shots
carry a personal name/email, so pairing them next to the clean chat shot looked
inconsistent.

Slides 2, 12 and 13 were added on mentor feedback: frame the problem, show the
measurement discipline (Gold Set / Hit@k / MRR / the derived abstention
threshold), and state the retrieval architecture trade-off. They carry no
screenshot — instead they use `add_stats` big-number callouts. **Every number
on them is real:** the recurrence stat is measured from `data/cases_clean.jsonl`
(22 of 66 cases repeat a problem), and the retrieval metrics reproduce from
`uv run python -m eval.eval_retriever`. The abstention threshold on slide 12
(0.735) is the value actually deployed in `backend/main.py` — code, eval and
deck all agree.

**Feature audit.** The body copy names, across slides 3-14: plain-language
search, 66 cases over 7 products and 8 issue categories, the product-name
overview query, suggested questions, Case ID citation, verbatim resolutions,
copy, helpful/not-helpful rating, conversation memory, "see how this was
found", out-of-scope refusal, no-match refusal, small talk without fabricated
citations, the offline fallback, English/Arabic with RTL and a remembered
language choice, the Arabic typeface, theming with OS default and remembered
choice, contrast checking, phone width with drawer, keyboard focus, reduced
motion, accounts, session persistence, password reset by emailed code, and
sign-in throttling.

Deliberately excluded as chrome rather than features: the Live pill, sign-out,
the empty-state watermark, copy confirmation, the theme-transition animation,
and the three-step "How it works" explainer (already visible in the slide-3
screenshot). Deliberately excluded as backend: hybrid BM25 + semantic search,
the ingestion quality gate, the grounding-distance threshold, the eval harness,
tests/CI and Docker — their user-visible effects are stated, the machinery is
not.

Every non-terminal screenshot is used except `slide-16b-dark-chat.png` and
`slide-17-mobile-landing.png` (near-duplicates of ones already shown) and the
four terminal captures, which are backend and deliberately out of scope.

Each screenshot is matched to what it actually contains — worth checking before
relabelling a slide. `slide-08-threshold-rejected.png` is the *out-of-scope*
refusal ("what is the capital of France"), not a no-match case;
`slide-12-small-talk.png` is the football question. They are different
guardrails and get their own slides.

### Title length is a hard constraint

The template's headline box is **7.16in at 60pt** — roughly **15–19 characters**
depending on letter widths. Longer titles wrap onto a second line and collide
with the body copy. Both were caught by rendering the deck and looking at it:
"Answers in seconds" and "Ask in plain words" both wrapped, and became
"Find the fix" and "Cited answers".

**Widening the box would be the obvious fix and is exactly what we must not do.**
Keep titles short instead.

## Fonts

The template uses **Poppins** and **Canva Sans**, neither of which is installed
on this machine — PowerPoint substitutes them. Body copy is therefore set in
`Poppins`, the template's own body face, rather than a locally-installed font:
on a machine without it everything substitutes together, and on a machine with
it everything matches. Setting Arial would have looked *different from the
headlines* on any machine that has the real fonts.

## Transitions

Fade on every slide, push on the two section separators, applied by injecting
`<p:transition>` (python-pptx has no API for it). Schema order inside `<p:sld>`
is enforced — `cSld, clrMapOvr, transition, timing` — and getting it wrong makes
PowerPoint declare the file corrupt, so the element is re-seated after
`clrMapOvr`.

## Verifying a change

Always render and look; do not trust the XML:

```powershell
$app = New-Object -ComObject PowerPoint.Application
$pres = $app.Presentations.Open("<abs path>\SupportBot.pptx", $true, $false, $false)
for ($i=1; $i -le $pres.Slides.Count; $i++) { $pres.Slides.Item($i).Export("<outdir>\s$i.png","PNG",1700,949) }
$pres.Close(); $app.Quit()
```

If PowerPoint opens the file without a repair prompt, the injected XML is valid.
