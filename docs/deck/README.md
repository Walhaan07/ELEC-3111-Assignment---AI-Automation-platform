# Presentation deck

`ELEC3111-AI-Automation-Platform-Plan.pdf` — 15 A4 pages, 14 diagrams. Written to be *presented*:
four introduction pages that explain what a workflow engine is, then one page per phase covering what
we are doing, the tools that phase uses, how to proceed, and how we know it is finished.

`plan-print.html` is the source. Fonts are embedded as data URIs so it renders identically anywhere.
To regenerate after editing:

```bash
npm i -g playwright            # already present in the dev container
node render.js .               # see the snippet below, or use any headless Chromium print-to-PDF
```

Minimal renderer:

```js
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.goto('file://' + process.cwd() + '/plan-print.html', { waitUntil: 'networkidle' });
  await p.pdf({ path: 'ELEC3111-AI-Automation-Platform-Plan.pdf', format: 'A4',
    printBackground: true,
    margin: { top: '12mm', bottom: '14mm', left: '15mm', right: '15mm' } });
  await b.close();
})();
```

Keep every page under ~1024 CSS px tall at 680 px wide, or it will spill onto a second sheet.

## Checking a page before you regenerate

Two scripts guard the two things that break silently when you edit a diagram:

- `node measure.js` — prints each page's height against the 1024 px printable limit. Anything marked
  OVER will spill onto a second sheet.
- `node audit.js` — walks every `<text>` in every SVG and reports two classes of bug: text that
  escapes the box it sits in (or the viewBox), and text whose colour falls below 4.5:1 contrast
  against the shape behind it. Both must print nothing before you render.

Run both, then `node render.js .`.
