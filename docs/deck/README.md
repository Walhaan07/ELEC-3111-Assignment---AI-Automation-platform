# Presentation deck

`ELEC3111-AI-Automation-Platform-Plan.pdf` — 25 A4 pages, 22 diagrams, written to be presented and to
be read by someone who has *used* n8n but never built one. Staffed for eight people.

| Part | Pages | What it covers |
|---|---|---|
| 0 · The vocabulary | 3–4 | Sixteen terms — node, item, trigger, canvas, engine, server, API, endpoint, JSON, database, token, container — each with a plain definition and where you already met it in n8n |
| 1 · How it all works | 5–11 | What a workflow, a node, an item, the engine, the canvas and the API really are, before any code |
| 2 · Building it | 12–18 | Six phases, each with its own colour: what we are doing, what it was in n8n, the tools, how to proceed, and a “done when” |
| 3 · Putting it together | 19–21 | Integration, four levels of testing, and the demo-day runbook with an acceptance checklist |
| 4 · Running the project | 22–25 | Eight people in four pairs, the Weeks 4–6 idle-hands problem and its fix, the three risks that end demos, six habits, and one task each for this week |

Colour is introduced gradually: Parts 0 and 1 are a quiet single accent, and each phase in Part 2
carries its own colour through its heading and every diagram belonging to it.

## Editing and regenerating

The document is assembled from `src/body1.html` … `src/body9.html` plus `src/fonts.html` (the three
typefaces embedded as data URIs, so it renders identically anywhere).

```bash
python3 assemble.py     # concatenates, numbers the figures, fills in the contents page
node measure.js         # every page must be under 1024 px tall or it spills onto a second sheet
node audit.js           # must print nothing — see below
node render.js .        # writes the PDF
```

`assemble.py` numbers figures sequentially in document order (write `<b>Figure @.</b>` in a caption
and it fills in the number) and rewrites the contents page with real page numbers and figure
references, so neither can drift out of date.

## What audit.js checks

Two classes of bug that are invisible until someone prints the document:

1. **Text escaping its shape.** For every `<text>` it finds the rectangle the text actually sits
   inside and reports anything overflowing that shape or the viewBox.
2. **Unreadable colour.** It reports any text below 4.5:1 contrast against the shape behind it.

It reads the **computed** fill, not the `fill` attribute. That matters: in SVG a CSS class beats a
presentation attribute, so `class="s2" fill="#e8eaed"` renders in the class colour, not the one you
asked for. Seventy-two labels in this document were silently wrong for exactly that reason — they are
now written as `style="fill:…"`, which does win. Keep it that way.
