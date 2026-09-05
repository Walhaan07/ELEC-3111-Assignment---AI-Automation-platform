# The complete build guide

`ELEC3111-AI-Automation-Platform-Plan.pdf` — **121 A4 pages, 33 diagrams**, written for a team that has
*used* n8n and is now going to build one. It is deliberately a hybrid: every part is explained twice,
once as a concept and once as the code.

| Part | What it covers |
|---|---|
| 1 · The big picture | §1.1 is the whole system on one page, colour-coded by the phase that builds each box. Then what a workflow, a node, an item, the engine and the canvas/API split really are — and §1.9 installs every tool click by click |
| 2 · Building it | Six phases. Each opens with a band naming **who builds it** and **what you need to know**, then a **concept page** (what, why, what it was in n8n, tools, how to proceed, done-when) followed by a **build page** with the actual commands and code, an **expected-output** block, and a **connection strip** naming what that part receives and hands on. §2.8 puts every seam in one picture |
| 3 · Putting it together | Repository layout and the one-command start, four levels of testing with real test code and the CI workflow, then the demo-day runbook and acceptance checklist |
| 4 · Running the project | Eight people in four pairs, the Weeks 4–6 idle-hands problem and its fix, risks, habits, this week |

## Three things every build page carries

1. **`.where`** — which program to paste the code into, which files it goes in, and the exact clicks to
   create them.
2. **Expected output** — a window mockup of what should appear: a terminal receipt, a browser screen, a
   spreadsheet, an inbox, a GitHub checks list. Each one is paired with a second mockup showing what the
   *failures* look like, because the failure screens are the evidence that the code is defensive.
3. **`.conn`** — a three-box strip: what this part receives, what it hands on, what it shares with
   everything else, and the one seam the group has to agree on in writing. §2.8 draws all of them at
   once as a single wiring diagram.

## Code standard

Every code block is the hardened version, not the illustrative one: input validation, timeouts, retries
with exponential backoff and jitter, a step limit and a cycle guard in the engine, an Express error
middleware and graceful shutdown, optimistic locking on saves, HMAC and idempotency on webhooks,
`protect: true` on schedules, single-flight token refresh, batched Sheets writes, RFC 2047 headers on
Gmail, and both a time *and* a memory limit on the Code node. Where a guard exists, the page also shows
the terminal output proving it fires.

## Design

Colour is functional, not decoration. Parts 0 and 1 use one quiet slate accent; each phase in Part 2
owns a colour from a cool blue → azure → cyan → teal ramp, carried through its heading, its file-name
chips and every diagram belonging to it. Warm tones (coral) are reserved for genuine warnings — the
hard gate, the feature freeze, demo-day risks — so they still mean something when they appear. Code is
syntax-highlighted from the same palette.

## Regenerating it

The document is assembled from per-page fragments in `src/pages/`, plus `src/fonts.html` (three
typefaces embedded as data URIs, so it renders identically anywhere).

```bash
python3 assemble.py     # concatenate, highlight code, number figures, build the contents
node measure.js         # page-height check
node audit.js           # diagram check — must print nothing
node render.js .        # write the PDF
python3 paginate.py     # read the PDF back and record each section's real page number
python3 assemble.py && node render.js .    # second pass, so the contents page numbers are exact
```

Set `CHROMIUM_PATH` if Playwright's bundled browser is not where it expects it
(`CHROMIUM_PATH=/path/to/chrome node render.js .`).

`assemble.py` numbers figures sequentially (write `<b>Figure @.</b>` in a caption and it fills the
number in), builds the whole contents page from the pages themselves, and syntax-highlights any
`<pre class="code" data-lang="js">` block — un-escaping the fragment's HTML entities first, so `&lt;`
inside a code sample reaches the reader as `<` rather than as the literal text `&lt;`.

`paginate.py` then reads the rendered PDF back with PyMuPDF and finds which printed page each section
actually starts on, writing `pages.json`; the second `assemble.py` pass uses it. That is why the
contents page is exact even though code sections now run across several printed pages each.

## What audit.js checks

Three classes of bug that are invisible until someone prints the document:

1. **Text escaping its shape** — for every `<text>` it finds the rectangle the text actually sits
   inside and reports anything that comes within **11 units** of that shape's edge, or leaves the
   viewBox. Requiring real padding rather than mere non-overlap is what catches text that *touches* a
   border, which reads as a bug even though it technically fits.
2. **Text colliding with a neighbour** — text that partially overlaps a shape it does not sit inside.
   Text fully contained in an outer container is ignored, so nested boxes do not produce noise. This
   catches arrow labels drifting onto the box next door.
3. **Unreadable colour** — any text below 4.5:1 contrast against the shape behind it.

It reads the **computed** fill, not the `fill` attribute. In SVG a CSS class beats a presentation
attribute, so `class="s2" fill="#e8eaed"` renders in the class colour. Keep in-figure colours as
`style="fill:…"`, which does win.

## Two conventions worth keeping

**Terms are defined where they are used, not in a glossary.** Each `.tbox` says what a term is, what it
does *in that section*, and how it connects to the rest. Adding a new one is three sentences in the
page it belongs to — never a separate list somebody has to flip back to.

**Every part names its own people and prerequisites.** The `.band-meta` block under each title carries
who builds that part and what skills it needs, so anyone can find the piece that matches what they can
already do.
