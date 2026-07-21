"""
Render real command output as clean terminal-window images for the deck.

    python presentation/render_terminal.py

Why render instead of screenshotting a terminal: a raw console capture carries
the shell prompt, the window chrome of whatever terminal happens to be open, and
whatever font size it was on. These come out consistent, high-resolution and
readable when projected.

The text is *real captured output*, not retyped -- the commands are run here and
their stdout is what gets drawn. Nothing is edited except trimming to the
relevant block and stripping progress-bar carriage returns.

Needs Pillow (`pip install pillow`), which is deliberately not a project
dependency -- this is a one-off asset step.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(__file__).resolve().parent / "screenshots"

SCALE = 2                      # retina
FONT_SIZE = 15 * SCALE
LINE_H = 24 * SCALE
PAD = 28 * SCALE
TITLEBAR = 44 * SCALE

BG = (24, 22, 20)
FG = (226, 222, 216)
DIM = (140, 134, 126)
GREEN = (94, 214, 140)
RED = (255, 92, 104)
YELLOW = (240, 190, 100)
CYAN = (120, 200, 220)


def _font(bold: bool = False) -> ImageFont.FreeTypeFont:
    for name in (("consolab.ttf", "consola.ttf") if bold else ("consola.ttf",)):
        try:
            return ImageFont.truetype(name, FONT_SIZE)
        except OSError:
            continue
    return ImageFont.load_default()


def colour_for(line: str) -> tuple[int, int, int]:
    """Colour by meaning so the important line reads first from the back row."""
    if "RESULT: PASS" in line or "passed" in line:
        return GREEN
    # Deliberately narrow. Matching "error" anywhere painted a *correctly
    # rejected* out-of-domain row red ("...generic error code on boot"), which
    # reads as a failure on a slide when it is the system working.
    if "RESULT: FAIL" in line or "Traceback" in line or " failed" in line:
        return RED
    if line.strip().startswith(">>") or "GATE" in line:
        return YELLOW
    if line.strip().startswith("$"):
        return CYAN
    if line.startswith("=") or line.startswith("--"):
        return DIM
    return FG


def render(lines: list[str], out_name: str, title: str) -> None:
    font, bold = _font(), _font(bold=True)
    width = max(
        int(bold.getlength(title)) + 2 * PAD,
        max((int(font.getlength(l)) for l in lines), default=0) + 2 * PAD,
    )
    height = TITLEBAR + len(lines) * LINE_H + 2 * PAD

    im = Image.new("RGB", (width, height), BG)
    d = ImageDraw.Draw(im)

    # title bar + traffic lights
    d.rectangle([0, 0, width, TITLEBAR], fill=(34, 31, 28))
    for i, c in enumerate([(255, 95, 86), (255, 189, 46), (39, 201, 63)]):
        cx = PAD + i * 20 * SCALE
        r = 6 * SCALE
        d.ellipse([cx - r, TITLEBAR // 2 - r, cx + r, TITLEBAR // 2 + r], fill=c)
    tw = bold.getlength(title)
    d.text(((width - tw) / 2, TITLEBAR / 2 - FONT_SIZE / 2 - 1), title, font=bold, fill=(190, 185, 178))

    y = TITLEBAR + PAD
    for line in lines:
        d.text((PAD, y), line, font=font, fill=colour_for(line))
        y += LINE_H

    im.save(OUT / (out_name + ".png"))
    print(f"  {out_name}.png  ({width}x{height})")


def run(cmd: str) -> str:
    """Run a command in the project root and return combined output."""
    p = subprocess.run(cmd, shell=True, cwd=ROOT, capture_output=True, text=True)
    return p.stdout + p.stderr


def clean(text: str) -> list[str]:
    """Drop progress-bar redraws and HF noise; keep everything meaningful."""
    out = []
    for raw in text.splitlines():
        line = raw.split("\r")[-1].rstrip()
        if not line.strip():
            out.append("")
            continue
        if "it/s]" in line or "HF_TOKEN" in line or "Loading weights" in line:
            continue
        out.append(line)
    # collapse runs of blank lines
    collapsed: list[str] = []
    for l in out:
        if l == "" and collapsed and collapsed[-1] == "":
            continue
        collapsed.append(l)
    return [l for l in collapsed if l is not None]


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    print("rendering terminal slides...")

    # --- slide 05: ingestion -------------------------------------------------
    ingest = clean(run("uv run python -m rag.ingest"))
    render(["$ uv run python -m rag.ingest", ""] + ingest,
           "slide-05-ingest-terminal", "Data ingestion + quality gate")

    # --- slide 06: indexing --------------------------------------------------
    index = clean(run("uv run python -m rag.index"))
    render(["$ uv run python -m rag.index", ""] + index,
           "slide-06-index-terminal", "Embedding + vector index build")

    # --- slide 18: retrieval evaluation (hybrid block + gate) ---------------
    ev = run("uv run python -m eval.eval_retriever")
    lines = clean(ev)
    try:
        start = next(i for i, l in enumerate(lines) if "ENGINE: hybrid" in l)
        end = next(i for i, l in enumerate(lines) if "ENGINE: semantic" in l)
        block = lines[start:end]
    except StopIteration:
        block = lines
    gate = [l for l in lines if "GATE (hybrid)" in l or "RESULT:" in l]
    render(["$ uv run python -m eval.eval_retriever", ""] + block + [""] + gate,
           "slide-18-eval-terminal", "Retrieval evaluation (regression gate)")

    # --- slide 19: test suite ------------------------------------------------
    tests = clean(run("uv run pytest -q"))
    tail = [l for l in tests if "passed" in l or "failed" in l or l.startswith("=")]
    render(["$ uv run pytest -q", ""] + (tail or tests[-6:]),
           "slide-19-tests-terminal", "Automated test suite")


if __name__ == "__main__":
    main()
