# The complete build guide

`ELEC3111-AI-Automation-Platform-Plan.pdf` — **98 A4 pages, 33 diagrams**, written for a team that has
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
python3 assemble.py          # concatenate, highlight code, number figures, build the contents
node measure.js              # page-height check
node audit.js                # diagram check — must print "All clear."
node render.js .             # write the PDF
python3 paginate.py          # read the PDF back and record each section's real page number
python3 assemble.py && node render.js .   # second pass, so the contents page numbers are exact
node render-cover-bleed.js . # render the cover on its own, at zero margin, for a true bleed
python3 splice-cover.py      # swap it in for page 1 — Chromium clips negative-margin bleed
                              # tricks to the print margin, so the cover must be a separate render
```

Set `CHROMIUM_PATH` if Playwright's bundled browser is not where it expects it
(`CHROMIUM_PATH=/path/to/chrome node render.js .`, same for the other two `.js` scripts).

**Why the cover needs its own render:** Chromium's `page.pdf()` hard-clips every page to the margin
box passed to it — a negative CSS margin on `.cover` does not escape it (verified empirically: a
same-margin test page with a full-bleed coloured `<div>` still comes back with a border on all four
sides). `render-cover-bleed.js` renders `pages/00-cover.html` alone with a zero print margin instead,
and `splice-cover.py` replaces page 1 of the main PDF with that render — page numbering for every
other page is untouched, since nothing else about the main render changes.

`assemble.py` numbers figures sequentially (write `<b>Figure @.</b>` in a caption and it fills the
number in), builds the whole contents page from the pages themselves, and syntax-highlights any
`<pre class="code" data-lang="js">` block — un-escaping the fragment's HTML entities first, so `&lt;`
inside a code sample reaches the reader as `<` rather than as the literal text `&lt;`.

`paginate.py` then reads the rendered PDF back with PyMuPDF and finds which printed page each section
actually starts on, writing `pages.json`; the second `assemble.py` pass uses it. That is why the
contents page is exact even though code sections now run across several printed pages each.

## What audit.js checks

Five classes of bug that are invisible until someone prints the document — run it after every edit
to a `<svg>` figure, and treat anything other than `All clear.` as a blocker:

1. **Text escaping its shape** — for every `<text>` it finds the rectangle the text actually sits
   inside and reports anything that comes within **11 units** of that shape's edge, or leaves the
   viewBox on the right/bottom. Requiring real padding rather than mere non-overlap is what catches
   text that *touches* a border, which reads as a bug even though it technically fits.
2. **Text escaping the viewBox on the left or top** — a centred label wider than its slot overflows
   equally in both directions, and the left/top edge is the page's own margin: nothing clips it in a
   browser tab, but Chromium's print-to-PDF genuinely slices the glyph off. Caught a clipped "R" in
   the dress-rehearsal timeline (§3.3) that every other check missed, because they all only ever
   looked for the *far* edge.
3. **Text colliding with a neighbouring shape** — text that partially overlaps a shape it does not
   sit inside. Text fully contained in an outer container is ignored, so nested boxes do not produce
   noise. This catches arrow labels drifting onto the box next door.
4. **Text colliding with a neighbouring text run** — every pair of `<text>` elements in the same
   `<svg>` is checked for a real bounding-box overlap (more than 4 units on both axes; two ordinary
   stacked caption lines touch by 2–3 units from glyph ascent/descent padding alone, which is not a
   bug and is deliberately not flagged). This is the check that catches one label's tail running into
   the next label's head — e.g. two adjacent timeline entries, or a status row whose columns are
   narrower than the text meant to fill them — which no shape-based check can see at all.
5. **Unreadable colour** — any text below 4.5:1 contrast against the shape behind it.

It reads the **computed** fill, not the `fill` attribute. In SVG a CSS class beats a presentation
attribute, so `class="s2" fill="#e8eaed"` renders in the class colour. Keep in-figure colours as
`style="fill:…"`, which does win.

## A page-break gotcha worth remembering

`break-inside: avoid` does not fail gracefully when it is nested: a `.fwrap` label+code wrapper that
avoids breaking, wrapping a `.code` block that *also* avoids breaking, and is taller than a page, does
not "flow across the break" — Chromium instead relocates the whole `.code` block to a fresh page and
leaves the short label stranded, alone, on an otherwise-blank page in between. This produced eight
near-empty pages (one filename floating at the top of each) before it was diagnosed; the tallest code
sample in the book triggered a second-order version of the same bug (skipping a *second* page) even
after the wrapper was fixed. The fix that held: only the label gets `break-after: avoid` (glue it to
whatever follows); the wrapper and the code block itself do not use `break-inside: avoid` at all, so a
block too tall for one page simply flows onto the next, exactly like the shorter blocks already did
without complaint. If you reintroduce `break-inside: avoid` on either `.fwrap` or `.code`, re-run the
near-empty-page check below before trusting the page count.

```bash
python3 -c "
import pymupdf
d = pymupdf.open('ELEC3111-AI-Automation-Platform-Plan.pdf')
for i, p in enumerate(d):
    if len(p.get_text().strip()) < 120:
        print(i + 1, repr(p.get_text()[:80]))
"
```

## Two conventions worth keeping

**Terms are defined where they are used, not in a glossary.** Each `.tbox` says what a term is, what it
does *in that section*, and how it connects to the rest. Adding a new one is three sentences in the
page it belongs to — never a separate list somebody has to flip back to.

**Every part names its own people and prerequisites.** The `.band-meta` block under each title carries
who builds that part and what skills it needs, so anyone can find the piece that matches what they can
already do.
