"""Fetch real public guidance documents for the RAG corpus (spec Section 11)."""

from __future__ import annotations

import argparse
import json
import os
import re
import urllib.request
from datetime import date

SOURCES = [
    {
        "id": "who-mental-health-at-work-2022",
        "title": "WHO Guidelines on Mental Health at Work (2022)",
        "publisher": "World Health Organization",
        "landing_url": "https://www.who.int/publications/i/item/9789240053052",
        "pdf_url": (
            "https://iris.who.int/server/api/core/bitstreams/"
            "6152a556-6893-4c4e-9ed8-094478bb25eb/content"
        ),
        "licence": "CC BY-NC-SA 3.0 IGO",
        "file": "who_mental_health_at_work.md",
        "note": (
            "Organisational guidance on workload, psychosocial risk, manager "
            "training and return to work. Not CAPF-specific; it is generic "
            "workplace guidance from a body whose recommendations are "
            "evidence-graded."
        ),
    },
]

REJECTED_SOURCES = [
    {
        "id": "mha-annual-report-2023-24",
        "pdf_url": "https://www.mha.gov.in/sites/default/files/AREnglish_24032026.pdf",
        "reason": (
            "413 pages, no personnel-welfare guidance. Welfare vocabulary refers "
            "to civilians, prisoners and statistics, not to CAPF personnel."
        ),
    },
    {
        "id": "mha-annual-report-2021-22",
        "pdf_url": (
            "https://www.mha.gov.in/sites/default/files/"
            "AnnualReport202122_24112022%5B1%5D.pdf"
        ),
        "reason": "305 pages, same finding as the 2023-24 report.",
    },
]

# Vocabulary that marks a page as actionable guidance rather than reportage.
GUIDANCE_TERMS = (
    "should", "recommend", "intervention", "manager", "workload", "psychosocial",
    "support", "training", "workplace", "employee", "worker", "supervisor",
    "return to work", "reasonable accommodation", "stress", "burnout",
    "organizational", "organisational",
)

# Pages that are front matter, indexes or bibliography rather than content.
BOILERPLATE_MARKERS = (
    "isbn", "cataloguing-in-publication", "table of contents", "acknowledgements",
    "references", "bibliography", "annex", "abbreviations",
)

MIN_GUIDANCE_TERMS = 4
MIN_CHARS = 700


def clean(text: str) -> str:
    """Collapse PDF whitespace without altering wording."""
    text = text.replace("\xa0", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return "\n".join(line.strip() for line in text.splitlines()).strip()


def page_score(text: str) -> int:
    """Rank a page as actionable guidance. 0 means do not keep."""
    lowered = text.lower()
    if len(text) < MIN_CHARS:
        return 0
    boilerplate = sum(1 for marker in BOILERPLATE_MARKERS if marker in lowered)
    if boilerplate >= 2:
        return 0
    hits = sum(1 for term in GUIDANCE_TERMS if term in lowered)
    return hits if hits >= MIN_GUIDANCE_TERMS else 0


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch the policy corpus.")
    parser.add_argument("--corpus", default="data/policy_corpus")
    parser.add_argument("--max-pages", type=int, default=45)
    args = parser.parse_args()

    from pypdf import PdfReader

    os.makedirs(args.corpus, exist_ok=True)
    manifest_path = os.path.join(args.corpus, "manifest.json")
    with open(manifest_path, encoding="utf-8") as fh:
        manifest = json.load(fh)

    # Drop anything previously written by a rejected source.
    rejected_ids = {r["id"] for r in REJECTED_SOURCES}
    existing = {
        d["id"]: d for d in manifest["documents"] if d["id"] not in rejected_ids
    }
    for entry in manifest["documents"]:
        if entry["id"] in rejected_ids:
            stale = os.path.join(args.corpus, entry["file"])
            if os.path.exists(stale):
                os.remove(stale)
                print(f"removed rejected source output: {entry['file']}")

    for source in SOURCES:
        pdf_path = os.path.join(args.corpus, f"_{source['id']}.pdf")
        if not os.path.exists(pdf_path):
            print(f"downloading {source['id']} ...")
            request = urllib.request.Request(
                source["pdf_url"], headers={"User-Agent": "Mozilla/5.0"}
            )
            with urllib.request.urlopen(request, timeout=240) as response:
                data = response.read()
            if not data.startswith(b"%PDF-"):
                raise SystemExit(f"{source['id']} did not return a PDF")
            with open(pdf_path, "wb") as fh:
                fh.write(data)
            print(f"  {len(data) / 1e6:.1f} MB")

        reader = PdfReader(pdf_path)
        print(f"  {len(reader.pages)} pages; selecting guidance pages")

        kept = []
        for number, page in enumerate(reader.pages, start=1):
            try:
                text = clean(page.extract_text() or "")
            except Exception:  # noqa: BLE001 - one unreadable page is not fatal
                continue
            score = page_score(text)
            if score:
                kept.append((score, number, text))

        kept.sort(key=lambda row: row[0], reverse=True)
        kept = sorted(kept[: args.max_pages], key=lambda row: row[1])
        if not kept:
            print(f"  no guidance pages found in {source['id']}, skipped")
            continue

        out_path = os.path.join(args.corpus, source["file"])
        with open(out_path, "w", encoding="utf-8") as fh:
            fh.write(f"# {source['title']}\n\n")
            fh.write(
                f"Publisher: {source['publisher']}\n\n"
                f"Document: {source['pdf_url']}\n\n"
                f"Landing page: {source['landing_url']}\n\n"
                f"Licence: {source['licence']}\n\n"
                f"Retrieved: {date.today().isoformat()}\n\n"
                f"{source['note']}\n\n"
                "Extracted verbatim from the published PDF; page numbers are kept "
                "so any citation can be checked against the original.\n\n"
            )
            for _score, number, text in kept:
                fh.write(f"## Page {number}\n\n{text}\n\n")

        print(f"  kept {len(kept)} pages -> {source['file']}")

        existing[source["id"]] = {
            "id": source["id"],
            "title": source["title"],
            "publisher": source["publisher"],
            "source_url": source["pdf_url"],
            "landing_url": source["landing_url"],
            "retrieved_on": date.today().isoformat(),
            "licence": source["licence"],
            "authoritative": True,
            "file": source["file"],
            "scope_caveat": source["note"],
            "extraction": (
                f"pages with >= {MIN_GUIDANCE_TERMS} guidance terms, front matter "
                f"and reference pages excluded, top {args.max_pages} by density"
            ),
        }

    manifest["documents"] = list(existing.values())
    manifest["corpus_version"] = "1.0-sourced"
    manifest["note"] = (
        "Guidance documents extracted verbatim by training/fetch_policy_corpus.py. "
        "Entries with authoritative=false are placeholder text and are declared as "
        "such in every /recommend response that draws on them."
    )
    manifest["rejected_sources"] = REJECTED_SOURCES
    with open(manifest_path, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2)

    authoritative = sum(1 for d in manifest["documents"] if d["authoritative"])
    print(f"\nmanifest declares {len(manifest['documents'])} documents "
          f"({authoritative} authoritative, {len(REJECTED_SOURCES)} sources rejected)")
    print("rebuild the index: python -m training.build_policy_index")


if __name__ == "__main__":
    main()
