import pathlib, re
head = ('<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8">\n'
        '<title>ELEC 3111 — Building an AI Automation Platform</title>\n')
fonts = pathlib.Path("fonts.html").read_text()
doc = head + fonts + "</head><body>\n" + "".join(
    pathlib.Path(f"body{i}.html").read_text() for i in range(1, 10))

doc = doc.replace("<b>Figure @.</b>", "<b>Figure §.</b>")
n = 0
def fig(m):
    global n; n += 1
    return f"<b>Figure {n}.</b>"
doc = re.sub(r"<b>Figure (?:\d+|§)\.</b>", fig, doc)

pages = doc.split('<div class="page')[1:]
page_figs = [[int(x) for x in re.findall(r"<b>Figure (\d+)\.</b>", p)] for p in pages]

rows = list(re.finditer(
    r'<div class="row"><span class="n">([\d.]+)</span><span>(.*?)</span><span class="pg"[^>]*>.*?</span></div>',
    doc, re.S))
assert len(rows) == 23, len(rows)
for i, m in enumerate(rows):
    figs = page_figs[2 + i]
    label = re.sub(r'\s*·\s*Figures?\s*[\d–—-]+\s*$', '', m.group(2)).rstrip()
    if len(figs) == 1:  label += f' · Figure {figs[0]}'
    elif figs:          label += f' · Figures {figs[0]}–{figs[-1]}'
    doc = doc.replace(m.group(0),
        f'<div class="row"><span class="n">{m.group(1)}</span><span>{label}</span>'
        f'<span class="pg">{3+i}</span></div>', 1)
pathlib.Path("plan-print.html").write_text(doc)
print("assembled: %d pages, %d figures, %.0f KB" % (len(pages), n, len(doc)/1024))
