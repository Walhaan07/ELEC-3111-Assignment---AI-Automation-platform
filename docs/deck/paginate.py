"""Read the rendered PDF and record the printed page each section starts on."""
import pathlib, re, json, unicodedata
import pymupdf

def norm(s):
    return re.sub(r"[^a-z0-9]+", "", unicodedata.normalize("NFKC", s).lower())

frag = sorted(p for p in pathlib.Path("pages").glob("*.html") if p.name != "_style.html")
keys = []
for f in frag:
    m = re.search(r'<span class="r">(.*?)</span>', f.read_text(), re.S)
    keys.append(re.sub(r"<[^>]+>", "", m.group(1)).strip() if m else None)

doc = pymupdf.open("ELEC3111-AI-Automation-Platform-Plan.pdf")
pagetext = [norm(p.get_text()) for p in doc]

mapping, cursor, missing = {}, 0, []
for i, k in enumerate(keys):
    if k is None:
        mapping[i] = 1
        continue
    target, found = norm(k), None
    for pno in range(cursor, len(pagetext)):
        if target and target in pagetext[pno]:
            found = pno + 1
            cursor = pno
            break
    if found is None:
        missing.append(k); mapping[i] = cursor + 1
    else:
        mapping[i] = found
pathlib.Path("pages.json").write_text(json.dumps(mapping))
print(f"located {len(keys) - len(missing)}/{len(keys)} sections across {doc.page_count} printed pages")
if missing:
    print("  not found:", missing[:5])
