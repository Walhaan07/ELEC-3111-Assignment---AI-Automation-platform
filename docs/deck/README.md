# The complete build guide

`ELEC3111-AI-Automation-Platform-Plan.pdf` — **50 A4 pages, 22 diagrams**, written for a team that has
*used* n8n and is now going to build one. It is deliberately a hybrid: every part is explained twice,
once as a concept and once as the code.

| Part | What it covers |
|---|---|
| 0 · The vocabulary | Sixteen terms — node, item, trigger, canvas, engine, server, API, endpoint, JSON, database, token, container — each with a plain definition and where you already met it in n8n |
| 1 · How it all works | What a workflow, a node, an item, the engine and the canvas/API split really are, before any code |
| 2 · Building it | Six phases. Each has a **concept page** (what, why, what it was in n8n, tools, how to proceed, done-when) followed by a **build page** with the actual commands and code |
| 3 · Putting it together | Repository layout and the one-command start, four levels of testing with real test code and the CI workflow, then the demo-day runbook and acceptance checklist |
| 4 · Running the project | Eight people in four pairs, the Weeks 4–6 idle-hands problem and its fix, risks, habits, this week |

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

`assemble.py` numbers figures sequentially (write `<b>Figure @.</b>` in a caption and it fills the
number in), builds the whole contents page from the pages themselves, and syntax-highlights any
`<pre class="code" data-lang="js">` block. `paginate.py` then reads the rendered PDF with PyMuPDF and
finds which printed page each section actually starts on — so the contents stays correct even though
code sections run across two pages.

## What audit.js checks

Two classes of bug that are invisible until someone prints the document:

1. **Text escaping its shape** — for every `<text>` it finds the rectangle the text actually sits
   inside and reports anything overflowing that shape or the viewBox.
2. **Unreadable colour** — any text below 4.5:1 contrast against the shape behind it.

It reads the **computed** fill, not the `fill` attribute. In SVG a CSS class beats a presentation
attribute, so `class="s2" fill="#e8eaed"` renders in the class colour. Keep in-figure colours as
`style="fill:…"`, which does win.
