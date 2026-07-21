# SupportBot deck — how it's built

`SupportBot.pptx` (10 slides) is generated, not hand-made, so it can be rebuilt
after any copy or screenshot change.

## Rebuild

```bash
uv run python presentation/build_deck.py     # -> presentation/SupportBot.pptx
```

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
history — it duplicates template slides in the order `1,3,2,2,3,2,2,2,2,4`
(cover, separator, white ×2, separator, white ×4, thank-you) and deletes the
four originals.

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

Hence `BODY_LEFT=2.6in`, `IMG_TOP=3.0in`, `IMG_BOTTOM_LIMIT=11.4in`,
`IMG_RIGHT_LIMIT=26.6in`.

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
