# SupportBot — Presentation Guide

Slide-by-slide content for the graduation presentation, plus the exact screenshot
to place on each slide.

**How to use this file**
- Each slide has: a **title**, **what to put on the slide** (keep it short — these
  are bullets, not paragraphs), and **what to say** (the spoken version).
- `SCREENSHOT:` tells you which image goes on that slide. Filenames are numbered
  by slide, so `slide-09-*.png` belongs on slide 9.
- Slides marked **[cut if short on time]** can be dropped without breaking the flow.

**Every number in this file was measured from the actual project.** If you change
the code before presenting, re-run the commands in Appendix A and update them.

---

## Screenshots — all captured, in `presentation/screenshots/`

Every image below is already taken at **2x resolution** and named for its slide.
Drop `slide-09-*.png` on slide 9 and so on. Nothing here needs recapturing.

| File | Slide | What it shows |
|---|---|---|
| `slide-03-landing-hero-light.png` | 3 | Landing page, light mode, preview conversation animated in |
| `slide-05-ingest-terminal.png` | 5 | Real `rag.ingest` output: 69 rows → 66 clean, 3 to review |
| `slide-06-index-terminal.png` | 6 | Real `rag.index` output: 66 cases embedded, dim=384 |
| `slide-08-threshold-rejected.png` | 8 | Bot refusing "what is the capital of France" |
| `slide-09-grounded-answer.png` | 9 | **The money shot** — live answer citing Case ID 3008-2359 |
| `slide-10-followup-memory.png` | 10 | Follow-up "does it happen on the FlowMeter X100 too" resolving the pronoun |
| `slide-11-embedding-map.png` | 11 | Embedding plot open, with legend and caption |
| `slide-12-small-talk.png` | 12 | Friendly redirect on chit-chat |
| `slide-13-offline-fallback.png` | 13 | Cases still served with the LLM unavailable |
| `slide-14-auth-signin.png` | 14 | Sign-in screen |
| `slide-15-arabic-rtl.png` | 15 | Landing page in Arabic, full RTL |
| `slide-16-dark-mode.png` | 16 | Landing page, dark mode |
| `slide-16b-dark-chat.png` | 16 | Chat in dark mode (optional second image) |
| `slide-17-mobile-landing.png` | 17 | Landing at 390px |
| `slide-17b-mobile-drawer.png` | 17 | Mobile drawer open (optional second image) |
| `slide-18-eval-terminal.png` | 18 | Real evaluation output: hybrid block + GATE PASS |
| `slide-19-tests-terminal.png` | 19 | Real `pytest -q` output: 55 passed |

**Only slide 4 needs you** — the architecture diagram, which you draw in
PowerPoint from the ASCII flow on that slide.

Two notes on how these were produced, in case you are asked:

- The **web screenshots** are a real browser driven automatically, signed in as
  your real account, holding a real conversation against the live backend. The
  answers on slides 9 and 10 came from Gemini, not from a mock.
- The **terminal images** (5, 6, 18, 19) are rendered from *real captured
  output* — the commands were run and their stdout was drawn into a clean
  terminal window so it stays readable when projected. Nothing was retyped or
  edited beyond trimming to the relevant block. Re-generate them any time with
  `python presentation/render_terminal.py`.

To retake the web screenshots:

```bash
DECK_EMAIL=you@example.com DECK_PASSWORD=... node presentation/capture_screenshots.mjs
```

---

## Slide 1 — Title

**On the slide**
- SupportBot — Retrieval-Augmented Support Assistant for Elsewedy Electric
- Your name · Graduation Project · Internship 2026
- Elsewedy Electric logo

**What to say**
> I built an internal support assistant that answers device troubleshooting
> questions by searching every past resolved support case, and gives the engineer
> the exact fix that worked before — with the case number to verify it.

---

## Slide 2 — The problem

**On the slide**
- Field engineers hit the same faults repeatedly
- The fixes exist — buried in a spreadsheet of past tickets
- Keyword search fails: people describe the same fault in different words
- *"the device is completely dead"* vs *"unit does not power on"* — same problem, no shared keywords
- Result: time re-diagnosing problems that were already solved

**What to say**
> The knowledge already exists. The problem is retrieval. A spreadsheet only finds
> what you literally typed, and nobody describes a fault the same way twice.

---

## Slide 3 — What we built

**SCREENSHOT: `slide-03-landing-hero-light.png`**

**On the slide**
- A web app that searches 66 resolved cases **by meaning**, not keywords
- Ask in plain English or Arabic → get the closest past cases and the fix that worked
- Every answer cites its **Case ID** so it can be verified
- Full stack: data pipeline → vector search → LLM answer → web app

**What to say**
> Type the problem the way you'd say it out loud. It finds the closest resolved
> cases and tells you what fixed them.

---

## Slide 4 — How it works (architecture)

**SCREENSHOT: `slide-04-architecture.png` — draw this yourself**

Draw this as a left-to-right flow:

```
support_cases.csv
      ↓  clean · normalise · deduplicate · quality-gate
cases_clean.jsonl  ──────────────→  review_queue.jsonl
      ↓  MiniLM embeddings (384-dim)
   ChromaDB vector index
      ↓
 ┌─ semantic search (cosine) ─┐
 │                            ├─ Reciprocal Rank Fusion → top 5
 └─ keyword search (BM25) ────┘
      ↓  grounding threshold (0.65)
 Gemini 2.5 Flash → answer + Case ID citation
      ↓
 FastAPI  →  React front end
```

**What to say**
> Five stages. Clean the data, turn it into vectors, search it two different ways
> and fuse the results, filter out weak matches, and only then let the language
> model write an answer from what survived.

---

## Slide 5 — Stage 1: Ingestion and the quality gate

**SCREENSHOT: `slide-05-ingest-terminal.png`**

**On the slide**
- 69 raw rows → **66 searchable** · **3 held back for review** · 0 duplicates
- Cleaning: whitespace, casing, product-name canonicalisation by majority vote
- **Design rule: a case with no recorded fix is not indexed**
- 7 products · 8 fault categories

**What to say**
> The most important decision here is the quality gate. If a ticket has no
> recorded resolution, there is nothing to retrieve, so it goes to a review queue
> instead of into the index. That rule is what surfaced our data problems instead
> of hiding them — which is the next slide.

---

## Slide 6 — What the quality gate found

**SCREENSHOT: `slide-06-index-terminal.png`**

**On the slide**
- 12 cases were initially unusable — logged with a cause but **no resolution**
- Investigated each: 9 had a clear cause, so the real fix was recoverable
- Corpus went **57 → 66 searchable**; review queue **12 → 3**
- The remaining 3 have no cause and a one-line vague problem — **deliberately still gated**

**What to say**
> This is a data-quality finding, not a code bug. Nine tickets had enough
> information to recover the fix, so we completed them. Three genuinely don't —
> they say things like "customer unhappy with the unit" with no cause. We left
> those out rather than inventing a resolution. The gate is doing its job.

---

## Slide 7 — Stage 2 & 3: Embeddings and hybrid search

**On the slide**
- Embeddings: `all-MiniLM-L6-v2`, 384 dimensions, runs **locally** — no API cost, no data leaves the machine
- Vector store: **ChromaDB**, persistent on disk
- Two searches run in parallel:
  - **Semantic** (cosine distance) — catches meaning
  - **BM25 keyword** — catches exact model numbers like *G2* vs *G3*
- Fused with **Reciprocal Rank Fusion**

**What to say**
> Semantic search understands that "completely dead" and "does not power on" are
> the same fault. But it's weak on exact identifiers — G2 and G3 look almost
> identical to an embedding model. BM25 is the opposite. Fusing them covers both.

---

## Slide 8 — Stage 4: The grounding threshold [anti-hallucination]

**SCREENSHOT: `slide-08-threshold-rejected.png`**

**On the slide**
- Vector search **always** returns its nearest neighbours — even for nonsense
- Without a filter, the LLM would confidently answer from irrelevant cases
- Fix: a **code-level distance threshold (0.65)**. Anything weaker is never shown to the model
- Out-of-domain questions are refused, not answered

**What to say**
> This is the single most important safety decision in the project. A vector
> database has no concept of "no good match" — ask it about the weather and it
> still returns the five closest support cases. If we passed those to the language
> model it would write a confident, completely wrong answer. So the filter is in
> code, before the model, not a polite instruction in the prompt.

---

## Slide 9 — Stage 5: The answer, with a citation

**SCREENSHOT: `slide-09-grounded-answer.png`**

**On the slide**
- Gemini 2.5 Flash writes the answer **only** from cases that passed the threshold
- Every answer states the **Case ID**, the original problem, and the resolution
- The engineer can open that exact ticket and verify it
- Prompt forbids inventing case numbers or reassigning them between cases

**What to say**
> The Case ID is the trust mechanism. The user never has to take the model's word
> for anything — they can go and read the original ticket. That's what separates
> this from a chatbot that sounds confident.

---

## Slide 10 — Conversation memory [cut if short on time]

**SCREENSHOT: `slide-10-followup-memory.png`**

**On the slide**
- Recent turns are sent with each question, so follow-ups work naturally
- Harder problem: **the search query itself** needs the context
- *"does it happen on the X100 too"* alone retrieves nothing useful
- Solution: short follow-ups containing a referring word get the previous question folded in
- Measured: correct cases at distance **0.215** vs **0.36+** before

**What to say**
> Two different problems. Giving the model chat history is easy. But the vector
> search still ran on the raw sentence, which on its own is meaningless. Now a
> follow-up gets rewritten before searching — and self-contained questions are
> deliberately left alone.

---

## Slide 11 — Explainability: the embedding map

**SCREENSHOT: `slide-11-embedding-map.png`**

**On the slide**
- "See how this was found" — shows *why* those cases were returned
- Projects 384-dimensional embeddings to 2D using **SVD** (raw NumPy, no scikit-learn)
- Your question is the red point; retrieved cases cluster around it
- Turns the system from a black box into something inspectable

**What to say**
> I wanted the retrieval to be inspectable rather than magic. This projects the
> high-dimensional space down to two dimensions so you can literally see your
> question sitting next to the cases it matched.

---

## Slide 12 — Guardrails: staying in scope [cut if short on time]

**SCREENSHOT: `slide-12-small-talk.png`**

**On the slide**
- Off-topic and small talk get a **conversational redirect**, not an error
- Early version replied *"No matching past cases were found"* to "I like Messi" — technically correct, felt broken
- Now: friendly reply + steer back to product support

**What to say**
> A support tool that answers "no matching cases found" to a greeting feels
> broken. Handling this well costs very little and changes how the whole thing feels.

---

## Slide 13 — Reliability: graceful degradation

**SCREENSHOT: `slide-13-offline-fallback.png`**

**On the slide**
- Gemini free tier: **20 requests per day** — it *will* run out
- When it does, the app **still works**: it lists the matching cases directly
- Retrieval is local, so the core value never depends on an external API
- Plus: LRU caching of replies and translations, retry with backoff on transient errors

**What to say**
> The language model is the part I don't control. When the quota runs out, the
> retrieval still works — so instead of an error page you get the matching cases
> and their fixes, just without the conversational wrapper. The system degrades
> instead of failing.

---

## Slide 14 — Security and hardening

**SCREENSHOT: `slide-14-auth-signin.png`**

**On the slide**
- Real authentication: **bcrypt** password hashing + **JWT** sessions
- Email verification on password reset
- **Per-IP rate limiting** (sliding window) on every endpoint
- **Account lockout**: 5 failed logins → locked for 15 minutes
- Structured request logging
- 12 API endpoints, all rate-limited

**What to say**
> Passwords are hashed with bcrypt, never stored. Brute force is blocked two ways:
> per-IP rate limiting and per-account lockout. To be clear about scope — this is
> solid for an internal tool, but I wouldn't call it production-hardened for public
> internet exposure.

---

## Slide 15 — Bilingual: full Arabic support

**SCREENSHOT: `slide-15-arabic-rtl.png`**

**On the slide**
- Complete English / Arabic UI — **91 translated strings**, full RTL layout
- Includes backend error messages and the offline fallback text
- **The real problem:** the embedding model is English-only — Arabic queries retrieved almost randomly
- **Solution:** Arabic questions are translated to English *before* retrieval, then the answer is returned in Arabic

**What to say**
> Translating the interface was the easy half. The real issue was that the
> embedding model only understands English, so an Arabic question retrieved
> essentially random cases. The fix was to translate the query before searching —
> so the user writes Arabic, the search happens in English, and the answer comes
> back in Arabic.

---

## Slide 16 — Design and accessibility

**SCREENSHOT: `slide-16-dark-mode.png`** (and `slide-16b-dark-chat.png` for the chat in dark)

**On the slide**
- Light and dark themes, switchable, remembered between visits
- Follows the OS preference by default
- Whole palette is design tokens — a theme switch is one attribute change
- **Every text/background pair measured against WCAG AA** (4.5:1 normal, 3:1 large)
- Keyboard focus states, reduced-motion support

**What to say**
> Dark mode isn't just inverted colours. Brand red on near-black fails contrast
> for small text, so buttons keep the true brand red while text uses a lifted
> version — and I measured every combination rather than eyeballing it.

---

## Slide 17 — Responsive [cut if short on time]

**SCREENSHOT: `slide-17-mobile-landing.png`** (and `slide-17b-mobile-drawer.png` if you want two)

**On the slide**
- Works on phones — the sidebar becomes a slide-in drawer
- Direction-aware: slides from the left in English, the right in Arabic
- Field engineers are the target users, and they're on phones

**What to say**
> The people who need this most are standing in front of a broken device, holding
> a phone.

---

## Slide 18 — How we know it works: evaluation

**SCREENSHOT: `slide-18-eval-terminal.png`**

**On the slide**
- 15-query evaluation set with hand-labelled correct answers
- Three query types: exact identifiers · paraphrases · out-of-domain
- **Results (hybrid — what the app serves):**
  - Identifier queries: **100% Hit@1**, MRR 1.000
  - Paraphrase queries: **100% Hit@1**, MRR 1.000
  - Out-of-domain: **100% correctly refused**
- Runs in CI — the build **fails** if retrieval regresses

**What to say**
> Every in-domain question returns the correct case first, and every out-of-domain
> question is refused. The important part is that this runs automatically on every
> push — if someone changes the retrieval and makes it worse, the build fails.

> **If asked "is hybrid actually better?" — answer honestly:** on this 15-query
> set, semantic-only scores identically. Hybrid's advantage is on exact model
> numbers and it protects against a specific fusion bug we hit. The eval set is
> small; expanding it is on the roadmap.

---

## Slide 19 — Engineering quality

**SCREENSHOT: `slide-19-tests-terminal.png`**

**On the slide**
- **55 automated tests**, all passing — ingestion, retrieval, and the full API
- GitHub Actions CI: install → ingest → index → test → evaluation gate
- Backend containerised with Docker
- Tests use mocked model and LLM, so the suite is fast and offline

**What to say**
> Tests cover the data pipeline, the retriever, and every API endpoint including
> auth, rate limiting, and lockout. The whole thing runs on every push.

---

## Slide 20 — Value and ROI

> **Fill in the bracketed numbers with your mentor before presenting.** Do not
> present invented figures — the method is what makes this credible.

**On the slide**

The calculation:

```
Time saved per repeat fault   =  [T_before] − [T_after]  minutes
Repeat faults per month       =  [N]
Engineers using it            =  [E]

Monthly hours saved  =  (T_before − T_after) × N ÷ 60
Annual value         =  Monthly hours × 12 × [hourly cost]
```

Worked example — **illustrative, replace with real figures**:
- Diagnosing a repeat fault from scratch: **30 min** → with SupportBot: **5 min**
- 40 repeat faults/month → **16.7 hours/month** → **200 hours/year**

Costs:
- Embeddings run locally — **zero** per-query cost
- LLM: free tier today; ~small monthly cost at production volume
- Hosting: internal, existing infrastructure

**Non-financial value**
- Institutional knowledge survives staff turnover
- New engineers reach competence faster
- The quality gate found **9 tickets with missing fixes** — the corpus itself got better

**What to say**
> I want to be careful here — I don't have real ticket volumes, so I'm showing the
> method and an illustrative example rather than claiming a number. What I can say
> concretely is that the retrieval costs nothing per query because embeddings run
> locally, and that building this surfaced nine tickets whose resolutions were
> missing entirely.

---

## Slide 21 — What's next

**On the slide**
- **Admin interface** for adding and editing cases (currently CSV + re-index by hand)
- Streaming responses — answers appear word by word
- Larger evaluation set
- Chat history saved per user
- Voice input for hands-free use in the field

**What to say**
> The biggest gap is that adding a new case still means editing a CSV and
> re-running the pipeline. An admin screen is the obvious next step.

---

## Slide 22 — Closing

**On the slide**
- 69 raw tickets → a searchable, verifiable support assistant
- Grounded answers with citations · bilingual · 55 tests · CI-gated
- Thank you / Questions

---

# Appendix A — Regenerating every number

```bash
# corpus counts
uv run python -m rag.ingest

# retrieval evaluation (the numbers on slide 18)
uv run python -m eval.eval_retriever

# test count (slide 19)
uv run pytest -q
```

# Appendix B — Likely questions

**"How do you know it isn't hallucinating?"**
> Two mechanisms. The distance threshold means the model never sees a weak match
> in the first place, and every answer cites a Case ID that can be checked against
> the original ticket.

**"Why ChromaDB and not Qdrant?"**
> The course skeleton used Qdrant. ChromaDB runs embedded with no separate server,
> which suits a corpus this size and made the whole thing reproducible from one
> repository. The reasoning is written up in `DESIGN.md`.

**"Why a local embedding model instead of OpenAI embeddings?"**
> No per-query cost, no network dependency in the retrieval path, and support case
> data never leaves the machine.

**"What happens when the corpus grows to 10,000 cases?"**
> Retrieval scales fine — that's what the vector index is for. The parts that would
> need attention are the BM25 index, which is rebuilt in memory, and the review
> queue, which would need the admin interface rather than manual CSV editing.

**"What was the hardest bug?"**
> A retrieval regression where "the device is completely dead and won't power up"
> returned a *no-display* case instead of *does-not-power-on*. Generic words like
> "device" and "unit" appear in nearly every case, and BM25 was scoring them, so
> filler words were casting real votes in the fusion step. Fixed by filtering
> stopwords out of the keyword half only — the semantic half and the product-name
> detector still see the full text, so G2-vs-G3 disambiguation was unaffected.

**"What would you do differently?"**
> Build the evaluation set first. I added it after the retriever was already
> working, which meant I'd been tuning by spot-checking queries by hand. Once the
> eval existed it immediately caught a regression I'd have shipped.
