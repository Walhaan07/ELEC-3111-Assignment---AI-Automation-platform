const { chromium } = require('playwright');
// set CHROMIUM_PATH when Playwright's bundled browser is not where it expects it
const EXE = process.env.CHROMIUM_PATH || undefined;
(async () => {
  const b = await chromium.launch(EXE ? { executablePath: EXE } : {});
  const p = await b.newPage({ viewport: { width: 680, height: 1024 } });
  await p.goto('file://' + process.cwd() + '/plan-print.html', { waitUntil: 'networkidle' });
  await p.emulateMedia({ media: 'print' });
  await p.evaluate(() => document.fonts.ready);
  const rows = await p.evaluate(() => [...document.querySelectorAll('.page')].map((el, i) => {
    const h2 = el.querySelector('h2'), h1 = el.querySelector('h1');
    return { i: i + 1, h: Math.round(el.getBoundingClientRect().height),
             title: (h2 || h1) ? (h2 || h1).textContent.replace(/\s+/g, ' ').slice(0, 44) : 'cover' };
  }));
  const LIMIT = 1024;
  for (const r of rows) {
    const over = r.h - LIMIT;
    console.log(`${String(r.i).padStart(2)}  ${String(r.h).padStart(5)}px  ${over > 0 ? 'OVER by ' + String(over).padStart(4) : 'ok        '}  ${r.title}`);
  }
  require('fs').writeFileSync('heights.json', JSON.stringify(rows.map(r => r.h)));
  console.log('total est. pages:', rows.reduce((a, r) => a + Math.max(1, Math.ceil(r.h / LIMIT)), 0));
  await b.close();
})();
