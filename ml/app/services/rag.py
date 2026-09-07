"""RAG recommendation engine (spec Section 11)."""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass

logger = logging.getLogger("sentinel.rag")

EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
COLLECTION = "sentinel_policy"
CORPUS_DIR = os.environ.get("POLICY_CORPUS_DIR", "data/policy_corpus")
INDEX_DIR = os.path.join(os.environ.get("ARTIFACTS_DIR", "artifacts"), "policy_index")

# What each SHAP category means as a retrieval query. The category names alone
# are too terse to embed usefully, and this keeps the mapping in one auditable
# place rather than scattered through prompt strings.
CATEGORY_QUERIES = {
    "deployment_load": (
        "sustained deployment, extended posting, long separation from home station"
    ),
    "leave_pattern": "repeated denial of leave requests, untaken leave, leave scheduling",
    "duty_irregularity": (
        "irregular duty timing, night shifts, extended consecutive duty days, rest"
    ),
    "transfer_frequency": "frequent transfers, disrupted unit connections, handover",
    "training_load": "change in training load relative to the person's own norm",
    "incident_proximity": "recent serious incident, structured check-in, peer support",
}

DISCLAIMER_SUFFIX = (
    "These are prompts for a conversation, not instructions. The welfare officer "
    "decides what happens next and is expected to overrule anything their own "
    "knowledge of the person contradicts."
)


class IndexNotBuiltError(RuntimeError):
    """Raised when a recommendation is requested before the index exists."""


@dataclass(frozen=True)
class Passage:
    doc_id: str
    chunk: int
    text: str
    title: str
    source_url: str
    publisher: str
    authoritative: bool
    distance: float

    @property
    def citation(self) -> str:
        return f"{self.doc_id}#chunk{self.chunk}"


_client = None
_embedder = None


def _lazy() -> tuple[object, object]:
    global _client, _embedder
    if _client is None:
        import chromadb

        if not os.path.isdir(INDEX_DIR):
            raise IndexNotBuiltError(
                f"no policy index at {INDEX_DIR}; run training/build_policy_index.py"
            )
        _client = chromadb.PersistentClient(path=INDEX_DIR)
    if _embedder is None:
        from sentence_transformers import SentenceTransformer

        _embedder = SentenceTransformer(EMBEDDING_MODEL)
    return _client, _embedder


def is_available() -> bool:
    return os.path.isdir(INDEX_DIR)


def build_query(band: str, shap_categories: dict[str, float], top_categories: int = 3) -> str:
    """Turn category-level context into a retrieval query.

    Only the strongest categories are used: querying with all six retrieves the
    whole corpus and makes the citations meaningless.
    """
    ranked = sorted(
        ((name, value) for name, value in shap_categories.items() if name in CATEGORY_QUERIES),
        key=lambda pair: pair[1],
        reverse=True,
    )[:top_categories]
    if not ranked:
        raise ValueError("no recognised SHAP categories supplied")
    parts = [CATEGORY_QUERIES[name] for name, _ in ranked]
    return f"welfare support for a person in the {band} band: " + "; ".join(parts)


def retrieve(query: str, k: int = 4) -> list[Passage]:
    client, embedder = _lazy()
    collection = client.get_collection(COLLECTION)
    embedding = embedder.encode([query], normalize_embeddings=True).tolist()
    result = collection.query(query_embeddings=embedding, n_results=k)

    passages = []
    for text, meta, distance in zip(
        result["documents"][0], result["metadatas"][0], result["distances"][0],
        strict=True,
    ):
        passages.append(
            Passage(
                doc_id=meta["doc_id"],
                chunk=int(meta["chunk"]),
                text=text,
                title=meta["title"],
                source_url=meta["source_url"],
                publisher=meta["publisher"],
                authoritative=bool(meta["authoritative"]),
                distance=float(distance),
            )
        )
    return passages


def _extractive_suggestion(passages: list[Passage]) -> str:
    """Assemble the answer from retrieved text verbatim.

    Each passage is quoted with its citation attached. No paraphrase, so there
    is nothing for a generator to invent — the traceability guarantee holds by
    construction rather than by instruction.
    """
    lines = ["Relevant guidance retrieved for this pattern:", ""]
    for passage in passages:
        lines.append(f"[{passage.citation}] {passage.text.strip()}")
        lines.append("")
    lines.append(DISCLAIMER_SUFFIX)
    return "\n".join(lines)


def _llm_suggestion(query: str, passages: list[Passage]) -> str | None:
    """Optional hosted-LLM path, used only when LLM_API_KEY is configured.

    The prompt constrains the model to the retrieved passages. That constraint
    is an instruction, not a guarantee, which is why the extractive path is the
    default rather than the fallback.
    """
    if not os.environ.get("LLM_API_KEY"):
        return None
    logger.info("LLM_API_KEY is set but no hosted provider is configured; "
                "using the extractive path")
    return None


def recommend(band: str, shap_categories: dict[str, float], k: int = 4) -> dict:
    query = build_query(band, shap_categories)
    passages = retrieve(query, k=k)

    if not passages:
        return {
            "suggestion": None,
            "sources": [],
            "authoritative": False,
            "warning": "no guidance was retrieved for this pattern",
            "action_taken": "none",
        }

    suggestion = _llm_suggestion(query, passages) or _extractive_suggestion(passages)
    all_authoritative = all(p.authoritative for p in passages)

    return {
        "suggestion": suggestion,
        "sources": [
            {
                "citation": p.citation,
                "title": p.title,
                "publisher": p.publisher,
                "source_url": p.source_url,
                "authoritative": p.authoritative,
            }
            for p in passages
        ],
        "authoritative": all_authoritative,
        "warning": None if all_authoritative else (
            "At least one retrieved passage comes from a NON-AUTHORITATIVE placeholder "
            "corpus. Treat this as an illustration of the retrieval pipeline, not as "
            "force policy. See ml/data/policy_corpus/README.md."
        ),
        # Spec 11: the recommendation is for the officer and is never auto-sent.
        "action_taken": "none",
        "for": "welfare_officer_review",
    }


def load_manifest(corpus_dir: str = CORPUS_DIR) -> dict:
    path = os.path.join(corpus_dir, "manifest.json")
    if not os.path.exists(path):
        raise FileNotFoundError(f"no manifest at {path}; every document needs provenance")
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)
