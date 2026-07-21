"""
Build the SupportBot presentation from the Elsewedy template.

The mentor's rule is that the template's design is fixed -- so this script
never restyles, moves, or recolours a single template shape. It only:
  * rewrites the text inside the template's own text boxes (reusing their
    existing runs, so font, size and colour are inherited, not re-declared), and
  * adds our own content (body copy + product screenshots) into the empty
    canvas of the white content slide, clear of every template graphic.

Structure comes from presentation/structure.pptx, which is produced by
PowerPoint itself (COM) duplicating the template slides -- that copies the
grouped freeforms and their image relationships natively, which a hand-rolled
XML deepcopy does not do reliably.

Run:
    uv run python presentation/build_deck.py
"""

from __future__ import annotations

import copy
from pathlib import Path

from PIL import Image
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.util import Emu, Inches, Pt
from lxml import etree

ROOT = Path(__file__).resolve().parent
STRUCTURE = ROOT / "structure.pptx"
OUT = ROOT / "SupportBot.pptx"
SHOTS = ROOT / "screenshots"

# --- template geometry ------------------------------------------------------
# The white content slide is 28.67 x 16.00in. These bounds keep our content
# clear of: the red vertical rule (~x=1.8in), the Elsewedy mark (top right,
# below y=2.6in), the WEDY.AI mark (bottom left) and the red network graphic
# (bottom right, from roughly x=21.5in / y=11.5in).
BODY_LEFT = Inches(2.6)
BODY_TOP = Inches(3.0)
BODY_WIDTH = Inches(9.0)
BODY_HEIGHT = Inches(8.0)

IMG_TOP = Inches(3.0)
IMG_BOTTOM_LIMIT = Inches(11.4)   # keeps clear of the bottom-right graphic
IMG_RIGHT_LIMIT = Inches(26.6)
IMG_LEFT = Inches(12.4)

BODY_FONT = "Poppins"      # the template's own body face (see cover subtitle)
BODY_SIZE = Pt(34)
BODY_COLOR = RGBColor(0x33, 0x33, 0x33)
RED = RGBColor(0xE5, 0x1B, 0x29)


# ---------------------------------------------------------------------------
# Text helpers
# ---------------------------------------------------------------------------
def set_lines(shape, lines: list[str]) -> None:
    """Rewrite a template text box's content, keeping its existing styling.

    Works by reusing paragraph 0 / run 0 as the style carrier and cloning it
    for extra lines, so we never restate font, size or colour -- whatever the
    template set stays set. Replacing the text frame outright would drop all
    of it and force us to re-declare the design we were told not to touch.
    """
    tf = shape.text_frame
    paras = tf.paragraphs
    template_p = copy.deepcopy(paras[0]._p)

    # Drop every paragraph after the first, and every run after the first.
    for p in list(paras[1:]):
        p._p.getparent().remove(p._p)
    first = tf.paragraphs[0]
    for r in list(first.runs[1:]):
        r._r.getparent().remove(r._r)

    if not first.runs:  # nothing to carry style -- nothing we can safely do
        first.text = lines[0]
    else:
        first.runs[0].text = lines[0]

    for line in lines[1:]:
        new_p = copy.deepcopy(template_p)
        # keep only the first run in the clone, then set its text
        runs = new_p.findall(
            "{http://schemas.openxmlformats.org/drawingml/2006/main}r"
        )
        for extra in runs[1:]:
            new_p.remove(extra)
        if runs:
            t = runs[0].find(
                "{http://schemas.openxmlformats.org/drawingml/2006/main}t"
            )
            t.text = line
        tf._txBody.append(new_p)


def set_number(shape, digits: str) -> None:
    """Separator numerals: the template styles the 2nd digit red, 1st white.
    Reuse those two runs so the two-tone treatment survives."""
    runs = shape.text_frame.paragraphs[0].runs
    if len(runs) >= 2:
        runs[0].text = digits[0]
        runs[1].text = digits[1]
        for extra in runs[2:]:
            extra._r.getparent().remove(extra._r)
    else:
        set_lines(shape, [digits])


def by_name(slide, name: str):
    for sh in slide.shapes:
        if sh.name == name:
            return sh
    raise KeyError(f"{name!r} not found on slide (have: {[s.name for s in slide.shapes]})")


def add_body(slide, bullets: list[str]) -> None:
    """Our own body copy, placed in the white slide's empty canvas."""
    box = slide.shapes.add_textbox(BODY_LEFT, BODY_TOP, BODY_WIDTH, BODY_HEIGHT)
    tf = box.text_frame
    tf.word_wrap = True
    for i, text in enumerate(bullets):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        run = p.add_run()
        run.text = text
        run.font.size = BODY_SIZE
        run.font.name = BODY_FONT
        run.font.color.rgb = BODY_COLOR
        p.line_spacing = 1.35
        p.space_after = Pt(22)


def add_image(slide, filename: str, left=None, top=None, max_w=None, max_h=None):
    """Place a screenshot, scaled to fit inside the safe canvas."""
    path = SHOTS / filename
    with Image.open(path) as im:
        ar = im.size[0] / im.size[1]

    top = IMG_TOP if top is None else top
    max_h = (IMG_BOTTOM_LIMIT - top) if max_h is None else max_h
    left = IMG_LEFT if left is None else left
    max_w = (IMG_RIGHT_LIMIT - left) if max_w is None else max_w

    width = max_w
    height = Emu(int(width / ar))
    if height > max_h:
        height = max_h
        width = Emu(int(height * ar))

    return slide.shapes.add_picture(str(path), left, top, width=width, height=height)


# ---------------------------------------------------------------------------
# Slide transitions
# ---------------------------------------------------------------------------
P_NS = "http://schemas.openxmlformats.org/presentationml/2006/main"


def set_transition(slide, kind: str = "fade", speed: str = "med") -> None:
    """Add a slide transition.

    python-pptx has no API for this, so the element goes in by hand. Order
    inside <p:sld> is schema-enforced: cSld, clrMapOvr, transition, timing --
    inserting it anywhere else makes PowerPoint call the file corrupt.
    """
    sld = slide._element
    for existing in sld.findall(f"{{{P_NS}}}transition"):
        sld.remove(existing)

    transition = etree.SubElement(sld, f"{{{P_NS}}}transition")
    transition.set("spd", speed)
    transition.set("advClick", "1")
    etree.SubElement(transition, f"{{{P_NS}}}{kind}")

    # Re-seat it directly after clrMapOvr (or cSld) to satisfy the schema.
    anchor = sld.find(f"{{{P_NS}}}clrMapOvr")
    if anchor is None:
        anchor = sld.find(f"{{{P_NS}}}cSld")
    sld.remove(transition)
    anchor.addnext(transition)


# ---------------------------------------------------------------------------
# Content
# ---------------------------------------------------------------------------
def build() -> None:
    prs = Presentation(STRUCTURE)
    s = prs.slides

    # 1 -- cover -------------------------------------------------------------
    set_lines(by_name(s[0], "TextBox 17"), ["SupportBot"])
    set_lines(
        by_name(s[0], "TextBox 18"),
        ["An AI support assistant for", "Elsewedy field engineers"],
    )

    # 2 -- separator 01 ------------------------------------------------------
    set_number(by_name(s[1], "TextBox 8"), "01")
    set_lines(by_name(s[1], "TextBox 7"), ["The Product"])

    # 3 -- what it is --------------------------------------------------------
    set_lines(by_name(s[2], "TextBox 6"), ["Find the fix"])
    add_body(
        s[2],
        [
            "Engineers in the field describe a problem the way they'd say it out "
            "loud — no error codes, no lookup tables.",
            "SupportBot searches 66 resolved support cases by meaning, not by "
            "keyword, and surfaces the closest ones.",
            "They get the case that already solved it, and the fix that worked.",
        ],
    )
    add_image(s[2], "slide-03-landing-hero-light.png")

    # 4 -- the answer --------------------------------------------------------
    set_lines(by_name(s[3], "TextBox 6"), ["Cited answers"])
    add_body(
        s[3],
        [
            "Every answer names the exact past case behind it — Case ID, the "
            "original problem, and its resolution.",
            "If nothing in the knowledge base actually matches, it says so "
            "instead of guessing.",
            "Answers can be copied, or rated helpful or not helpful to flag "
            "where the knowledge base needs a better case.",
        ],
    )
    add_image(s[3], "slide-09-grounded-answer.png")

    # 5 -- separator 02 ------------------------------------------------------
    set_number(by_name(s[4], "TextBox 8"), "02")
    set_lines(by_name(s[4], "TextBox 7"), ["The Experience"])

    # 6 -- bilingual ---------------------------------------------------------
    set_lines(by_name(s[5], "TextBox 6"), ["Fully bilingual"])
    add_body(
        s[5],
        [
            "One toggle switches the entire interface between English and "
            "Arabic — including a true right-to-left layout.",
            "Ask a question in Arabic and the answer comes back in Arabic.",
            "Arabic is set in a dedicated typeface, not left to a browser "
            "fallback.",
        ],
    )
    add_image(s[5], "slide-15-arabic-rtl.png")

    # 7 -- theming -----------------------------------------------------------
    set_lines(by_name(s[6], "TextBox 6"), ["Light and dark"])
    add_body(
        s[6],
        [
            "One click re-themes the whole application instantly.",
            "It follows the operating system by default, and remembers an "
            "explicit choice permanently.",
            "Every text and surface pairing was contrast-checked for "
            "accessibility in both themes.",
        ],
    )
    add_image(s[6], "slide-16-dark-mode.png")

    # 8 -- responsive --------------------------------------------------------
    set_lines(by_name(s[7], "TextBox 6"), ["Built for the field"])
    add_body(
        s[7],
        [
            "The full experience works down to phone width — where support "
            "actually happens.",
            "The sidebar becomes a slide-in drawer that opens from the correct "
            "side in Arabic.",
            "A refresh never signs you out mid-job.",
        ],
    )
    # two portrait shots side by side
    add_image(s[7], "slide-17-mobile-landing.png", left=Inches(14.6), max_w=Inches(5.0))
    add_image(s[7], "slide-17b-mobile-drawer.png", left=Inches(20.2), max_w=Inches(5.0))

    # 9 -- transparency ------------------------------------------------------
    set_lines(by_name(s[8], "TextBox 6"), ["It shows its work"])
    add_body(
        s[8],
        [
            "“See how this was found” opens a live map of the search space "
            "behind the answer.",
            "Each point is a past case; the highlighted ones are what the "
            "question actually matched.",
            "Engineers can see why an answer was chosen — not just be asked to "
            "trust it.",
        ],
    )
    add_image(s[8], "slide-11-embedding-map.png")

    # 10 -- thank you --------------------------------------------------------
    set_lines(by_name(s[9], "TextBox 17"), ["Thank you"])

    # transitions ------------------------------------------------------------
    # Fade throughout, with a push on the two section separators so a section
    # change reads as a change. Deliberately restrained: this is a template
    # deck, not a showreel.
    for i, slide in enumerate(s, start=1):
        set_transition(slide, "push" if i in (2, 5) else "fade")

    prs.save(OUT)
    print(f"[deck] wrote {OUT}  ({len(s.__iter__.__self__._sldIdLst)} slides)")


if __name__ == "__main__":
    build()
