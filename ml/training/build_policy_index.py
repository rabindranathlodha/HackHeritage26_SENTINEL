"""Build the policy vector index for the RAG engine (spec Section 11)."""

from __future__ import annotations

import argparse
import os
import shutil

from app.privacy.claims import ClinicalClaimError, assert_no_clinical_claims
from app.services.rag import COLLECTION, CORPUS_DIR, EMBEDDING_MODEL, INDEX_DIR

REQUIRED_FIELDS = ("id", "title", "publisher", "source_url", "authoritative", "file")


def chunk_markdown(text: str, max_chars: int = 900) -> list[str]:
    """Split on headings first, then on length.

    Heading-aware because the corpus is organised by stressor category, and a
    chunk that straddles two topics retrieves badly for both.
    """
    sections, current = [], []
    for line in text.splitlines():
        if line.startswith("#") and current:
            sections.append("\n".join(current).strip())
            current = [line]
        else:
            current.append(line)
    if current:
        sections.append("\n".join(current).strip())

    chunks = []
    for section in sections:
        if not section:
            continue
        if len(section) <= max_chars:
            chunks.append(section)
            continue
        paragraphs, buffer = section.split("\n\n"), ""
        for paragraph in paragraphs:
            if len(buffer) + len(paragraph) > max_chars and buffer:
                chunks.append(buffer.strip())
                buffer = paragraph
            else:
                buffer = f"{buffer}\n\n{paragraph}" if buffer else paragraph
        if buffer.strip():
            chunks.append(buffer.strip())
    return [c for c in chunks if len(c) > 80]


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the policy index.")
    parser.add_argument("--corpus", default=CORPUS_DIR)
    parser.add_argument("--index", default=INDEX_DIR)
    args = parser.parse_args()

    import chromadb
    from sentence_transformers import SentenceTransformer

    from app.services.rag import load_manifest

    manifest = load_manifest(args.corpus)
    documents = manifest.get("documents", [])
    if not documents:
        raise SystemExit("the manifest declares no documents")

    declared_files = set()
    for entry in documents:
        missing = [f for f in REQUIRED_FIELDS if f not in entry]
        if missing:
            raise SystemExit(
                f"manifest entry {entry.get('id', '?')} is missing {missing}; "
                "an untraceable chunk cannot be cited and will not be indexed"
            )
        declared_files.add(entry["file"])

    # Anything sitting in the corpus directory but absent from the manifest is a
    # document nobody recorded the provenance of. Refuse rather than index it.
    present = {
        name for name in os.listdir(args.corpus)
        if name.endswith((".md", ".txt")) and name != "README.md"
    }
    undeclared = present - declared_files
    if undeclared:
        raise SystemExit(
            f"undeclared documents in the corpus: {sorted(undeclared)}. "
            "Add a manifest entry with publisher and source_url, or remove them."
        )

    if os.path.isdir(args.index):
        shutil.rmtree(args.index)
    os.makedirs(args.index, exist_ok=True)

    print(f"embedding with {EMBEDDING_MODEL} (local)")
    embedder = SentenceTransformer(EMBEDDING_MODEL)
    client = chromadb.PersistentClient(path=args.index)
    collection = client.create_collection(COLLECTION, metadata={"hnsw:space": "cosine"})

    total, non_authoritative = 0, 0
    for entry in documents:
        path = os.path.join(args.corpus, entry["file"])
        if not os.path.exists(path):
            raise SystemExit(
                f"manifest names {entry['file']} but it is not present. Source "
                "documents are regenerable and therefore not committed — run "
                "`python -m training.fetch_policy_corpus` first."
            )

        chunks = chunk_markdown(open(path, encoding="utf-8").read())

        # Filter on the way in, not on the way out. Guidance text uses clinical
        # vocabulary the claims guard forbids, and relaxing the output guard for
        # quoted text would let anything through behind a citation.
        admissible, blocked = [], 0
        for chunk in chunks:
            try:
                assert_no_clinical_claims(chunk)
                admissible.append(chunk)
            except ClinicalClaimError:
                blocked += 1
        chunks = admissible
        if blocked:
            print(f"  {entry['id']}: {blocked} chunks withheld by the claims guard")

        if not chunks:
            print(f"  {entry['id']}: no usable chunks, skipped")
            continue

        embeddings = embedder.encode(chunks, normalize_embeddings=True).tolist()
        collection.add(
            ids=[f"{entry['id']}#chunk{i}" for i in range(len(chunks))],
            documents=chunks,
            embeddings=embeddings,
            metadatas=[{
                "doc_id": entry["id"],
                "chunk": i,
                "title": entry["title"],
                "publisher": entry["publisher"],
                "source_url": entry["source_url"],
                "authoritative": bool(entry["authoritative"]),
            } for i in range(len(chunks))],
        )
        total += len(chunks)
        if not entry["authoritative"]:
            non_authoritative += len(chunks)
        flag = "" if entry["authoritative"] else "  [NON-AUTHORITATIVE]"
        print(f"  {entry['id']}: {len(chunks)} chunks{flag}")

    print(f"\nindexed {total} chunks -> {args.index}")
    if non_authoritative:
        print(f"WARNING: {non_authoritative} of {total} chunks are NON-AUTHORITATIVE "
              "placeholder text.")
        print("Every /recommend response drawing on them says so. Replace the corpus")
        print("with sourced documents before this is used for anything real —")
        print("see ml/data/policy_corpus/README.md.")


if __name__ == "__main__":
    main()
