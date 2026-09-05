const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 680, height: 1024 } });
  await p.goto('file://' + process.cwd() + '/plan-print.html', { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);
  const out = await p.evaluate(() => {
    const lum = (hex) => {
      const c = hex.replace('#', '');
      const v = [0, 2, 4].map(i => {
        let x = parseInt(c.length === 3 ? c[i / 2].repeat(2) : c.substr(i, 2), 16) / 255;
        return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
    };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
    const res = { overflow: [], contrast: [] };
    document.querySelectorAll('svg').forEach((svg, si) => {
      const vb = svg.viewBox.baseVal;
      const rects = [...svg.querySelectorAll('rect')].map(r => {
        const bb = r.getBBox();
        return { x: bb.x, y: bb.y, w: bb.width, h: bb.height, fill: r.getAttribute('fill') || '' };
      });
      svg.querySelectorAll('text').forEach(t => {
        let bb; try { bb = t.getBBox(); } catch (e) { return; }
        if (!bb.width) return;
        const px = bb.x + 1, py = bb.y + bb.height / 2;
        const hosts = rects.filter(r => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h
                                        && r.fill && r.fill !== 'none');
        hosts.sort((a, c) => (a.w * a.h) - (c.w * c.h));
        const host = hosts[0];
        const txt = t.textContent.trim().slice(0, 46);
        if (bb.x + bb.width > vb.width - 1)
          res.overflow.push({ f: si + 1, kind: 'viewBox', over: Math.round(bb.x + bb.width - vb.width), txt });
        // text that runs into a neighbouring shape it is not inside
        for (const r of rects) {
          if (r === host || !r.fill || r.fill === 'none') continue;
          const hit = bb.x + bb.width > r.x + 2 && bb.x < r.x + r.w - 2 &&
                      bb.y + bb.height > r.y + 2 && bb.y < r.y + r.h - 2;
          const inside = bb.x >= r.x && bb.y >= r.y &&
                         bb.x + bb.width <= r.x + r.w && bb.y + bb.height <= r.y + r.h;
          if (hit && !inside) { res.overflow.push({ f: si + 1, kind: 'collides',
                     over: Math.round(bb.x + bb.width - r.x), txt }); break; }
        }
        if (host) {
          const PAD = 11;
          const overR = bb.x + bb.width - (host.x + host.w) + PAD;
          const overB = bb.y + bb.height - (host.y + host.h) + 2;
          if (overR > 1) res.overflow.push({ f: si + 1, kind: 'box-right', over: Math.round(overR), txt });
          else if (overB > 1) res.overflow.push({ f: si + 1, kind: 'box-bottom', over: Math.round(overB), txt });
          const fg = getComputedStyle(t).fill || t.getAttribute('fill');
          const hx = (s) => { const m = /^#([0-9a-f]{3,6})$/i.exec(s || ''); if (m) return s;
            const m2 = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(s || '');
            return m2 ? '#' + [1,2,3].map(i => (+m2[i]).toString(16).padStart(2,'0')).join('') : null; };
          const a = hx(fg), c = hx(host.fill);
          if (a && c) { const r = ratio(a, c);
            if (r < 4.5) res.contrast.push({ f: si + 1, r: r.toFixed(2), fg: a, bg: c, txt }); }
        }
      });
    });
    return res;
  });
  console.log('== OVERFLOWS ==');
  out.overflow.forEach(x => console.log(` fig ${String(x.f).padStart(2)} ${x.kind.padEnd(10)} +${String(x.over).padStart(3)}  ${x.txt}`));
  console.log('== LOW CONTRAST (<4.5:1) ==');
  out.contrast.forEach(x => console.log(` fig ${String(x.f).padStart(2)}  ${x.r}:1  ${x.fg} on ${x.bg}   ${x.txt}`));
  await b.close();
})();
