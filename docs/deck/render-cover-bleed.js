// Renders JUST the cover as its own single-page, zero-margin PDF so the artwork
// can bleed to the true physical edge. Chromium's print-to-PDF hard-clips content
// to the page.pdf() margin box regardless of CSS (negative margins do NOT escape
// it — confirmed empirically), so a full-bleed cover needs its own zero-margin
// render; splice-cover.py then swaps it in for page 1 of the main document.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// set CHROMIUM_PATH when Playwright's bundled browser is not where it expects it
const EXE = process.env.CHROMIUM_PATH || undefined;

// the fragments live at <dir>/fonts.html + <dir>/pages/ when run from a merged
// working copy (assemble.py's own convention), or at <dir>/src/... in a plain
// checkout of this repo — try the flat layout first, then fall back to src/.
function findFragment(dir, relPath) {
  const flat = path.join(dir, relPath);
  if (fs.existsSync(flat)) return flat;
  const nested = path.join(dir, 'src', relPath);
  if (fs.existsSync(nested)) return nested;
  throw new Error(`Could not find ${relPath} under ${dir} or ${dir}/src`);
}

(async () => {
  const dir = process.argv[2];
  const fonts = fs.readFileSync(findFragment(dir, 'fonts.html'), 'utf8');
  const style = fs.readFileSync(findFragment(dir, 'pages/_style.html'), 'utf8');
  const cover = fs.readFileSync(findFragment(dir, 'pages/00-cover.html'), 'utf8');

  const html = '<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8">\n'
    + '<title>Cover</title>\n' + fonts + style
    // this render supplies its own zero page.pdf() margin, so the negative-margin
    // bleed trick the normal book layout relies on must be neutralised here —
    // .cover just needs to sit flush at (0,0) and fill the page, no offset needed.
    + '<style>.page.cover,.cover{margin:0 !important;break-after:auto !important;}</style>\n'
    + '</head><body>\n' + cover + '\n</body></html>\n';

  const tmp = path.join(dir, '_cover-only.html');
  fs.writeFileSync(tmp, html);

  const browser = await chromium.launch(EXE ? { executablePath: EXE } : {});
  const page = await browser.newPage();
  await page.goto('file://' + tmp, { waitUntil: 'networkidle' });
  try { await page.evaluate(() => document.fonts.ready); } catch (e) {}
  await page.pdf({
    path: path.join(dir, '_cover-bleed.pdf'),
    format: 'A4',
    printBackground: true,
    margin: { top: 0, bottom: 0, left: 0, right: 0 },
    displayHeaderFooter: false,
  });
  await browser.close();
  fs.unlinkSync(tmp);
  console.log('cover bleed rendered: _cover-bleed.pdf');
})();
