const { chromium } = require('playwright');
(async () => {
  const dir = process.argv[2];
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://' + dir + '/plan-print.html', { waitUntil: 'networkidle' });
  try { await page.evaluate(() => document.fonts.ready); } catch (e) {}
  const loaded = await page.evaluate(() =>
    [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family));
  console.log('fonts loaded:', [...new Set(loaded)].join(', ') || '(none — using fallbacks)');
  await page.pdf({
    path: dir + '/ELEC3111-AI-Automation-Platform-Plan.pdf',
    format: 'A4',
    printBackground: true,
    margin: { top: '12mm', bottom: '14mm', left: '15mm', right: '15mm' },
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate:
      '<div style="width:100%;font-family:Helvetica,Arial,sans-serif;font-size:7pt;color:#9aa1ab;' +
      'padding:0 15mm;display:flex;justify-content:space-between;">' +
      '<span>ELEC 3111 · Group 2 · AI Automation Platform</span>' +
      '<span class="pageNumber"></span></div>',
  });
  await browser.close();
})();
