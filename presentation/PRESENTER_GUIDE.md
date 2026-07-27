# SupportBot — Presenter's Guide

Everything you need to walk through the deck with confidence and answer any
question thrown at you. Read it once end-to-end, then skim the **Say this**
lines the night before.

- **Team:** Youssef Bassem, Mahmoud Alsayed, Somaya Ahmed
- **Deck:** `presentation/SupportBot.pptx` — 19 slides, 3 sections
- **One-line pitch:** *SupportBot turns Elsewedy's resolved support cases into a
  shared memory any field engineer can search in plain language, in seconds.*

---

## How to present (read this first)

**Timing.** Aim for ~10–12 minutes: about 30–40 seconds per content slide, a
beat of silence on each section separator. Don't rush the metrics slides
(12–13) — those are where you earn credibility.

**Golden rules**
1. **Talk about the user, not the code.** Say *"an engineer describes a problem
   and gets the exact past fix"* — not *"we call a hybrid retriever."* The
   machinery comes up only if someone asks.
2. **Never oversell.** The strongest thing you can do in the room is state a
   limitation before anyone asks. It reads as mastery, not weakness.
3. **Every number on the deck is real and reproducible.** If challenged, you can
   run it live: `uv run python -m eval.eval_retriever`.
4. **One idea per slide.** Say the headline, give one concrete example, move on.
5. **Drive from a screenshot.** Point at the actual thing on screen; don't
   describe it in the abstract.

**If a demo is possible**, have the app open in a second window (backend on
:8000, frontend on :5173) and show one real question after slide 5. A single
live query is worth three slides.

---

## Section 0 — Open

### Slide 1 — SupportBot (cover)
*On screen:* title, tagline "An AI support assistant for Elsewedy field
engineers", and your three names.

**Say this:** *"Good [morning]. We're Youssef, Mahmoud and Somaya, and this is
SupportBot — an AI assistant that helps Elsewedy field engineers find the fix
for a device problem in seconds, using the company's own past support cases."*

Keep it to two sentences. Don't explain how it works yet — that's the whole rest
of the deck.

---

### Slide 2 — The problem
*On screen:* the pain, plus one big stat — **"1 in 3"** resolved cases repeat a
problem already solved elsewhere.

**Say this:** *"A device fails in the field. Almost always, someone has already
solved that exact problem — it's sitting in an old ticket, or in a senior
engineer's head. But reaching it means asking around and waiting. In our own
case base, one resolved case in three is a repeat of a problem already fixed on
another unit. And when an experienced engineer leaves, the fixes they carried
leave with them. SupportBot makes that knowledge searchable."*

**Why this slide matters:** it frames *why anyone should care* before you show a
single feature. The "1 in 3" is measured from our real data (22 of 66 cases
repeat a problem) — say "measured," not "estimated."

**If asked "where does 1 in 3 come from?"** *"We grouped our 66 cleaned cases by
the problem they describe — 22 of them repeat a fault already solved on another
unit. It's counted from the data, not a guess."*

---

## Section 1 — The Product (separator slide 3: "01 · The Product")

> On the separator, pause for a second and say: *"First, what it does for an
> engineer."* Then advance.

### Slide 4 — Find the fix
*On screen:* the landing page / search.

**Say this:** *"An engineer describes the problem the way they'd say it out loud
— no error codes, no lookup tables. SupportBot searches 66 resolved cases across
7 products and 8 issue categories, by meaning rather than exact keywords. Type
just a product name and it tells you how many past cases exist for it. And there
are suggested questions to get started in one click."*

**Key phrase:** *"by meaning, not keywords."* That's the core idea of the whole
project — plant it here.

---

### Slide 5 — Cited answers
*On screen:* an answer citing a Case ID, problem, and resolution.

**Say this:** *"Every answer names the exact past case behind it — the Case ID,
the original problem, and the resolution that actually worked. It's not a
paraphrase or a guess; it's the fix that was really recorded. And you can copy
it, or mark it helpful or not, which tells us where the knowledge base needs a
better case."*

**Why it matters:** trust. An engineer won't act on an answer they can't verify.
Citation is what makes this usable in the field.

**If asked "how do you stop it making things up?"** *"Two ways. First, it only
ever answers from a real retrieved case — if nothing matches closely enough, it
refuses. Second, the answer always cites the case, so it's checkable. We'll show
the refusal behaviour in a moment."* (That's slide 9.)

---

### Slide 6 — It remembers
*On screen:* a follow-up question understood in context.

**Say this:** *"Conversations work like conversations. If you then ask 'does it
happen on the FlowMeter X100 too?', it understands that in the context of what
you just asked — you never have to restate the problem. And every follow-up is
still grounded in its own cited case."*

---

### Slide 7 — Shows its work
*On screen:* the embedding-space map ("See how this was found").

**Say this:** *"This is our favourite feature. 'See how this was found' opens up
the actual search space behind the answer. Each dot is a past case; the
highlighted ones are what your question matched. So instead of asking an
engineer to just trust the AI, we show them why an answer was chosen."*

**Why it matters:** this is the one feature that makes the invisible mechanism
*visible*. It's the signature of the project — spend an extra beat here.

**If asked "what am I actually looking at?"** *"The system represents every case
as a point in a high-dimensional 'meaning space.' We flatten that to 2D just for
this picture. Close together means similar in meaning. The caption says honestly
that this is an approximation of the real search, which happens in full
dimensions."*

---

## Section 2 — Trust (separator slide 8: "02 · Trust")

> Say: *"A support tool is only useful if you can trust what it says — and trust
> what it refuses to say."*

### Slide 9 — Stays in scope
*On screen:* it declining an out-of-scope question (e.g. "capital of France").

**Say this:** *"It knows what it's for. Ask it general-knowledge questions and it
politely declines — this is a product-support tool, not a chatbot. And if
nothing in the knowledge base matches your problem, it says so, instead of
dressing up an unrelated case as an answer."*

**Why it matters:** a system that *refuses* correctly is more trustworthy than
one that always answers. This is the honesty guardrail.

---

### Slide 10 — Small talk
*On screen:* a friendly reply to a greeting.

**Say this:** *"It's still human to talk to. Greetings and small talk get a warm,
natural reply — and then it steers back to what it can actually help with. The
key detail: small talk never invents a fake Case ID. The citation format only
appears when there's a real case behind it."*

---

### Slide 11 — Always answers
*On screen:* the offline fallback listing cases directly.

**Say this:** *"Even if the answer-writing service is unavailable, you still get
help. It lists the matching cases in full — Case ID, problem, resolution — and
just tells you the written summary is missing. It degrades gracefully instead of
throwing an error screen at an engineer in the field."*

**Why it matters:** reliability. The retrieval half is fully local, so the tool
keeps working even when the AI-writing half doesn't.

---

### Slide 12 — How we measured it  ⭐ (the credibility slide)
*On screen:* three big numbers — **100% Hit@1**, **MRR@5 = 1.000**, **100%
correct abstention.**

**Say this:** *"We didn't just build it and hope. We built a 15-question test
set — 5 exact-model-number questions, 7 'described in plain words' questions, and
3 out-of-scope questions — each hand-labelled with the correct case. We measure
whether the right case comes back first, and whether out-of-scope questions are
correctly refused. On this set it gets the right case first every time, and
refuses every out-of-scope question. And this runs automatically on every code
change, so it can't silently break."*

**The abstention threshold (say it simply):** *"We also had to pick a cutoff for
'close enough to answer.' We didn't guess it — real answerable questions land at
a distance of 0.582 or below, out-of-scope ones at 0.874 or above, so we set the
line at 0.735, right in the clear gap between them. That exact value is what's
running in the backend."*

> **This is the slide a technical reviewer will attack. See "Defending the
> perfect score" below — rehearse it.**

---

### Slide 13 — Why hybrid search
*On screen:* three numbers — **100% meaning-only**, **71% keyword-only**, **100%
hybrid.**

**Say this:** *"You might ask: if we already score 100%, why combine two search
methods? Meaning-based search is great at plain-language questions but blurs
exact model numbers — 'G2' and 'G3' look almost identical to it. Keyword search
keeps those exact numbers distinct but misses paraphrases — only 71%. So we run
both and merge the results. We're honest about this: on our test set the
combination doesn't beat meaning-search — we run it for robustness on exact model
and part numbers, not for a higher score."*

**Why it matters:** this is the slide that proves you understand your own
trade-offs. Stating "it doesn't beat meaning-search here" is a *strength* — it
shows you're not cherry-picking.

---

## Section 3 — The Experience (separator slide 14: "03 · The Experience")

> Say: *"Finally, the things that make it usable for a real engineer on a real
> day."*

### Slide 15 — Fully bilingual
*On screen:* the Arabic, right-to-left interface.

**Say this:** *"One toggle switches the whole interface between English and
Arabic — including a true right-to-left layout — and it remembers your choice.
Ask a question in Arabic and the answer comes back in Arabic. And Arabic is set
in a proper typeface, not left to a browser default."*

**If asked "how does Arabic search work if the model is English?"** *"Good
question — behind the scenes we translate the Arabic question to English just for
the search step, because our search model is English-trained. The answer still
comes back to the engineer in Arabic."* (Only go here if asked — it's backend.)

---

### Slide 16 — Light and dark
*On screen:* dark mode.

**Say this:** *"One click re-themes the entire app. It follows your operating
system's setting by default and remembers if you override it. Every colour pair
was contrast-checked for accessibility in both themes, keyboard focus is visible
throughout, and motion is reduced for anyone whose system asks for that."*

**Why it matters:** shows craft and accessibility awareness, not just features.

---

### Slide 17 — On any screen
*On screen:* three phones — landing, chat, and the slide-in menu drawer.

**Say this:** *"The full experience runs right down to phone width — which is
where field support actually happens. Chat, cited answers, the case view: they
all reflow to a single column, nothing is cut off. The sidebar becomes a
slide-in drawer from the menu button — and it opens from the correct side in
Arabic too."*

---

### Slide 18 — Your account
*On screen:* the sign-in screen.

**Say this:** *"Engineers get a real account and stay signed in — a refresh never
logs you out mid-job. A forgotten password is reset with a code sent to your
email. And sign-in is protected against repeated password guessing."*

---

### Slide 19 — Thank you
**Say this:** *"That's SupportBot — the company's own resolved cases, turned into
a searchable memory any engineer can use in seconds. Thank you — we'd love your
questions."*

Then **stop talking** and let them ask. Don't fill the silence.

---

## Defending the perfect score (rehearse this out loud)

A sharp reviewer will say: *"100% and a perfect MRR of 1.000? That's suspicious
— walk me through it."* Here is the honest, winning answer.

**1. Offer to run it.** *"Happy to — I can run it right now."*
`uv run python -m eval.eval_retriever` prints every query's result for all three
search methods and a PASS/FAIL gate. It also runs in CI on every commit.

**2. Explain what "perfect" means here.** *"It's a 15-question safety check over
our 66 cases, not a giant benchmark. It's a regression gate — 'nothing we care
about broke, and refusals are correct' — not a claim that retrieval is flawless
in general."*

**3. Explain why 100% is achievable honestly.**
- *"The correct answers are fixed to the actual case text, not to whatever the
  system returned — otherwise it'd be circular."*
- *"Many faults repeat across products, so several questions have several
  correct answers. 'Temperature reading is offset' matches five real cases —
  ranking any one of them first is a legitimate hit."*

**4. Address the earlier ~0.77 head-on** (the mentor raised this): *"That was
before two real fixes. We cleaned up how the keyword search weights common
filler words, which fixed the one paraphrase it used to miss; and we completed 9
cases that had no recorded solution, growing the searchable set from 57 to 66.
And that ~0.77 hasn't disappeared — keyword-search **on its own** still scores
about 0.71 on paraphrases today. That's the honest 'not everything is perfect'
number, and it's exactly why we don't ship keyword-search alone."*

**5. Close with the limitation.** *"To be clear: a perfect score means our test
set is green, not that the problem is solved. The real next step is a larger,
independently-labelled evaluation set."*

Saying step 5 unprompted is what separates a good presenter from a great one.

---

## Plain-English glossary — every term on the deck

If a mentor points at a word on a slide and asks "what does that mean?", say the
**one line** next to it. Don't add more — the short answer sounds confident.

| Term (on the slide) | Say exactly this |
|---|---|
| **Case / Case ID** | *"A past support ticket that was solved, and its ID number."* |
| **By meaning (semantic search)** | *"It finds cases that mean the same thing, even if the words are different — 'won't turn on' finds 'does not power up.'"* |
| **Keyword search** | *"It matches the exact words you type — good for model numbers, weak for wording."* |
| **Hybrid search** | *"We use both — meaning search and keyword search — and merge the results."* |
| **Grounded answer** | *"The answer is built from a real past case, not made up by the AI."* |
| **Hit@1** | *"How often the correct case comes back as the number-one result. 100% means it was first every time."* |
| **MRR@5** | *"A score for how high the right case ranks. 1.0 means it was always at the very top."* |
| **Abstention / it refuses** | *"When nothing matches well enough, it chooses not to answer instead of guessing."* |
| **Out-of-scope / out-of-domain** | *"A question the tool isn't meant to answer — like a general-knowledge question."* |
| **Gold Set / test set** | *"Our fixed list of 15 questions with known correct answers, that we grade the system against."* |
| **Distance** | *"How different two things are in meaning. Smaller distance means more similar."* |
| **Threshold (0.735)** | *"The cutoff for 'close enough to answer.' Closer than this, it answers; further, it refuses."* |
| **Embedding / embedding space** | *"Turning text into points, so things with similar meaning sit close together. That's the map on slide 7."* |
| **CI (runs on every commit)** | *"An automatic check that re-runs all our tests every time we change the code, so nothing quietly breaks."* |

---

## Tough-question cheat sheet

| If they ask… | Say… |
|---|---|
| *Is the data real?* | *"It's a realistic support-case dataset — 66 cleaned cases across 7 products. The pipeline that cleans and checks it is real; the format matches a real ticket export."* |
| *Could it give a wrong fix?* | *"It only answers from a real retrieved case above a strict similarity cutoff, and it cites that case so it's checkable. Below the cutoff, it refuses rather than guess."* |
| *What if the AI service is down?* | *"It still lists the matching cases in full — the search half is fully local. We showed that on slide 11."* |
| *Why not just use ChatGPT?* | *"A general chatbot doesn't know Elsewedy's cases and will confidently invent a fix. Ours only answers from real recorded resolutions and cites them."* |
| *How do you handle Arabic?* | *"The interface is fully Arabic with right-to-left layout; for search we translate the question to English behind the scenes, then answer back in Arabic."* |
| *Is it secure / production-ready?* | *"Passwords are properly hashed, sessions are signed, sign-in is rate-limited. We're honest that it's a strong internal-demo standard, not a fully hardened production deployment — that would need a security review."* |
| *What was the hardest part?* | *"Stopping it from confidently giving a plausible-but-wrong fix. Prompting alone didn't hold — the fix that worked was a strict, data-derived similarity cutoff in code, so weak matches never reach the answer step at all."* |
| *What would you build next?* | *"An admin screen to add and edit cases without touching files, and a larger independently-labelled test set."* |

---

## The 30-second version (if you're cut short)

*"Field engineers waste time re-solving problems the company already solved —
one in three of our cases is a repeat. SupportBot lets any engineer describe a
problem in plain language, English or Arabic, and get the exact past fix, with
the case cited so they can trust it. It refuses when it doesn't know, it shows
its own reasoning, and we measured it: on our 15-question test set it returns the
right case first every time and correctly refuses every out-of-scope question —
verified automatically on every code change."*
