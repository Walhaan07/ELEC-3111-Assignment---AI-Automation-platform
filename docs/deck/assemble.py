import pathlib, re, html as _html

# ---------------------------------------------------------------- syntax colours
KW = {
 'js':  r'\b(const|let|var|function|async|await|return|if|else|for|of|in|new|import|from|export|'
        r'default|class|try|catch|finally|throw|typeof|instanceof|null|undefined|true|false|'
        r'interface|type|extends|implements|string|number|boolean|Promise|void|this|delete)\b',
 'sql': r'\b(CREATE|TABLE|INDEX|PRIMARY|KEY|DEFAULT|NOT|NULL|UNIQUE|REFERENCES|ON|DELETE|CASCADE|'
        r'SELECT|FROM|WHERE|INSERT|INTO|VALUES|UPDATE|SET|RETURNING|ORDER|BY|LIMIT|AND|OR)\b',
 'bash':r'(?:^|\n)(\s*)(npm|npx|node|docker|docker compose|git|curl|mkdir|cd|ssh|scp|python3|psql|k6)\b',
 'yaml':r'^(\s*)([\w.\-]+)(:)',
 'http':r'\b(GET|POST|PUT|PATCH|DELETE)\b',
 'json':None,
}
TYPES = r'\b(string|number|boolean|uuid|text|jsonb|timestamptz|bytea|int|Promise|Buffer|Map|Set|Worker)\b'

def highlight(code, lang):
    """Tokenise the RAW code, then escape each span — no placeholders, so nothing
    downstream can mangle a string literal."""
    comment = {'js': r'//[^\n]*', 'ts': r'//[^\n]*', 'sql': r'--[^\n]*',
               'yaml': r'#[^\n]*', 'bash': r'#[^\n]*', 'conf': r'#[^\n]*',
               'http': r'#[^\n]*', 'json': None}.get(lang)
    parts = [r"'[^'\n]*'", r'"[^"\n]*"', r'`[^`\n]*`']
    if comment: parts.insert(0, comment)
    scanner = re.compile('|'.join(parts))

    def plain(txt):
        out = _html.escape(txt)
        if KW.get(lang):
            if lang == 'yaml':
                out = re.sub(KW['yaml'], r'\1<span class="tk-f">\2</span>\3', out, flags=re.M)
            elif lang == 'bash':
                out = re.sub(KW['bash'],
                             lambda m: m.group(0)[:-len(m.group(2))] +
                                       f'<span class="tk-k">{m.group(2)}</span>', out)
            else:
                out = re.sub(KW[lang], r'<span class="tk-k">\1</span>', out)
        if lang in ('js', 'ts'):
            out = re.sub(TYPES, r'<span class="tk-p">\1</span>', out)
            out = re.sub(r'\b([a-zA-Z_$][\w$]*)(?=\()', r'<span class="tk-f">\1</span>', out)
        out = re.sub(r'(?<![\w#-])(\d+(?:\.\d+)?)(?![\w;-])', r'<span class="tk-n">\1</span>', out)
        return out

    res, pos = [], 0
    for m in scanner.finditer(code):
        res.append(plain(code[pos:m.start()]))
        cls = 'tk-c' if (comment and re.fullmatch(comment, m.group(0))) else 'tk-s'
        res.append(f'<span class="{cls}">{_html.escape(m.group(0))}</span>')
        pos = m.end()
    res.append(plain(code[pos:]))
    return ''.join(res)

def paint(doc):
    def sub(m):
        lang = m.group(1)
        return f'<pre class="code"><code>{highlight(m.group(2), lang)}</code></pre>'
    return re.sub(r'<pre class="code" data-lang="(\w+)"><code>(.*?)</code></pre>', sub, doc, flags=re.S)

# ---------------------------------------------------------------- assemble
order = sorted(p for p in pathlib.Path("pages").glob("*.html") if p.name != "_style.html")
doc = ('<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8">\n'
       '<title>ELEC 3111 — Building an AI Automation Platform</title>\n'
       + pathlib.Path("fonts.html").read_text()
       + pathlib.Path("pages/_style.html").read_text()
       + "</head><body>\n"
       + "\n".join(p.read_text() for p in order)
       + "\n</body></html>\n")
doc = paint(doc)

doc = doc.replace("<b>Figure @.</b>", "<b>Figure §.</b>")
n = 0
def fig(m):
    global n; n += 1
    return f"<b>Figure {n}.</b>"
doc = re.sub(r"<b>Figure (?:\d+|§)\.</b>", fig, doc)

pages = doc.split('<div class="page')[1:]
page_figs = [[int(x) for x in re.findall(r"<b>Figure (\d+)\.</b>", p)] for p in pages]

# ---- build the contents automatically from the pages themselves ----
import json
REAL = {}
if pathlib.Path("pages.json").exists():
    REAL = {int(k): v for k, v in json.loads(pathlib.Path("pages.json").read_text()).items()}
def printed_page(i):
    return REAL.get(i, i + 1)

GROUPS = {"1": "Part 1 — The big picture, and how it works",
          "2": "Part 2 — Building it, phase by phase", "3": "Part 3 — Putting it together",
          "4": "Part 4 — Running the project"}
rows, last = [], None
for idx, pg in enumerate(pages):
    if idx < 2: continue
    m = re.search(r'<span class="secno">([\d.]+[a-z]?)</span><h2>(.*?)</h2>', pg, re.S)
    if not m:
        m2 = re.search(r'<h2>(.*?)</h2>', pg, re.S)
        if not m2: continue
        num, title = "", m2.group(1)
    else:
        num, title = m.group(1), m.group(2)
    title = re.sub(r"<[^>]+>", "", title).replace("\n", " ")
    title = re.sub(r"\s+", " ", title).strip()
    grp = GROUPS.get(num[:1])
    if grp and grp != last:
        rows.append(f'<div class="grp">{grp}</div>'); last = grp
    figs = page_figs[idx]
    ref = (f' · Figure {figs[0]}' if len(figs) == 1
           else f' · Figures {figs[0]}–{figs[-1]}' if figs else '')
    build = ' class="bld"' if num.endswith(("b", "c")) else ''
    rows.append(f'<div class="row"{build}><span class="n">{num}</span>'
                f'<span><b>{title}</b>{ref}</span><span class="pg">{idx+1}</span></div>')
doc = doc.replace('<div class="toc" data-auto></div>',
                  '<div class="toc">' + "".join(rows) + '</div>')
print("contents rows:", sum(1 for r in rows if "class=\"row\"" in r))

pathlib.Path("plan-print.html").write_text(doc)
print("assembled: %d pages, %d figures, %.0f KB" % (len(pages), n, len(doc)/1024))
