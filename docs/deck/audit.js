const { chromium } = require('playwright');
// set CHROMIUM_PATH when Playwright's bundled browser is not where it expects it
const EXE = process.env.CHROMIUM_PATH || undefined;
(async () => {
  const b = await chromium.launch(EXE ? { executablePath: EXE } : {});
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
    const res = { overflow: [], contrast: [], textoverlap: [] };
    document.querySelectorAll('svg').forEach((svg, si) => {
      const vb = svg.viewBox.baseVal;
      const rects = [...svg.querySelectorAll('rect')].map(r => {
        const bb = r.getBBox();
        return { x: bb.x, y: bb.y, w: bb.width, h: bb.height, fill: r.getAttribute('fill') || '' };
      });
      // text vs text: two separate <text> nodes whose rendered boxes actually intersect.
      // Shape-hosting/contrast checks below only ever compare a text run against rects,
      // so a label like "PHASE 2 ADDS" running into the neighbouring "AFTER PHASE 2"
      // label was invisible to every other check — this catches that class of bug.
      const texts = [...svg.querySelectorAll('text')].map(t => {
        let bb; try { bb = t.getBBox(); } catch (e) { return null; }
        if (!bb.width || !bb.height) return null;
        return { bb, txt: t.textContent.trim().slice(0, 30) };
      }).filter(Boolean);
      for (let i = 0; i < texts.length; i++) {
        for (let j = i + 1; j < texts.length; j++) {
          const A = texts[i].bb, B = texts[j].bb;
          const ox = Math.min(A.x + A.width, B.x + B.width) - Math.max(A.x, B.x);
          const oy = Math.min(A.y + A.height, B.y + B.height) - Math.max(A.y, B.y);
          // stacked caption/label lines (title above subtitle, same x-span) legitimately
          // show a couple of px of vertical bbox overlap from glyph ascent/descent padding
          // even when they look perfectly clean on the page — real collisions, where two
          // labels actually run into each other side by side, overlap by a lot more than
          // that. 4px cleanly separates the two in practice (measured: genuine touching
          // labels start at 5px; benign stacked lines top out at 3px).
          if (ox > 4 && oy > 4)
            res.textoverlap.push({ f: si + 1, by: Math.round(Math.min(ox, oy)),
                                   a: texts[i].txt, b: texts[j].txt });
        }
      }
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
        // left/top edge underflow — e.g. a centred label whose string is wider than
        // its slot runs off the LEFT of the viewBox just as easily as the right, and
        // that edge is the page's own margin: nothing clips it in the browser preview,
        // but Chromium's print-to-PDF genuinely slices the glyph off. Missed by every
        // other check here, which only ever looks for the right/bottom edge.
        if (bb.x < -0.5)
          res.overflow.push({ f: si + 1, kind: 'viewBox-L', over: Math.round(-bb.x), txt });
        if (bb.y < -0.5)
          res.overflow.push({ f: si + 1, kind: 'viewBox-T', over: Math.round(-bb.y), txt });
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
          const small = Math.min(host.w, host.h) < 26;
          const PAD = small ? 0 : Math.min(11, Math.max(2, Math.min(host.w, host.h) * 0.22));
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
  console.log('== TEXT OVERLAPPING TEXT ==');
  out.textoverlap.forEach(x => console.log(` fig ${String(x.f).padStart(2)} by ${String(x.by).padStart(3)}px   "${x.a}"  ×  "${x.b}"`));
  const total = out.overflow.length + out.contrast.length + out.textoverlap.length;
  console.log(total === 0 ? '\nAll clear.' : `\n${total} finding(s).`);
  await b.close();
  process.exit(total === 0 ? 0 : 1);
})();
