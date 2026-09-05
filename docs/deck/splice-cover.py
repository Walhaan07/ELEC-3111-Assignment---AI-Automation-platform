"""Swap page 1 of the rendered book for the full-bleed cover render.

Run after render.js has produced the main PDF and render-cover-bleed.js has
produced _cover-bleed.pdf. Page numbering for every other page is untouched —
we only replace the physical first page's content, we don't renumber anything,
so the footer folios printed on pages 2..N (driven by the SAME single
full-document render) stay exactly correct.
"""
import pathlib
import pymupdf

MAIN = "ELEC3111-AI-Automation-Platform-Plan.pdf"
COVER = "_cover-bleed.pdf"

def main():
    main_path, cover_path = pathlib.Path(MAIN), pathlib.Path(COVER)
    if not cover_path.exists():
        raise SystemExit(f"{COVER} not found — run render-cover-bleed.js first")
    doc = pymupdf.open(main_path)
    cover = pymupdf.open(cover_path)
    doc.delete_page(0)
    doc.insert_pdf(cover, from_page=0, to_page=0, start_at=0)
    # pymupdf refuses to overwrite the file it opened; write to a temp path and swap it in
    tmp_path = main_path.with_suffix(".tmp.pdf")
    doc.save(tmp_path)
    doc.close()
    tmp_path.replace(main_path)
    print(f"spliced full-bleed cover into page 1 of {MAIN} ({pymupdf.open(main_path).page_count} pages total)")
    cover_path.unlink()

if __name__ == "__main__":
    main()
