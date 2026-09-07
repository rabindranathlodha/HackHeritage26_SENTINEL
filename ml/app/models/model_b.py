"""Model B — self-assessment NLP (spec 7.2). REAL model, step 3.7."""

from __future__ import annotations

import json
import logging
import os
import unicodedata
from dataclasses import dataclass

logger = logging.getLogger("sentinel.model_b")

IS_STUB = False

OUTPUT_DIR = "model_b"
META_FILE = "model_b_meta.json"

DISTRESS_LABEL = "distress_signal"

# Scripts we can identify cheaply and honestly, without a language-ID dependency.
_DEVANAGARI_LANGUAGES = {"hi", "mr", "ne", "sa", "bho", "mai"}


class ModelNotLoadedError(RuntimeError):
    """Raised when a prediction is requested before the artifact is available."""


@dataclass
class _LoadedModel:
    tokenizer: object
    model: object
    meta: dict
    max_length: int
    distress_index: int


_state: _LoadedModel | None = None


def artifacts_dir() -> str:
    return os.environ.get("ARTIFACTS_DIR", "artifacts")


def load(artifacts: str | None = None) -> bool:
    global _state
    base = artifacts or artifacts_dir()
    model_dir = os.path.join(base, OUTPUT_DIR)
    meta_path = os.path.join(base, META_FILE)

    from app.models.registry import registry

    if not (os.path.isdir(model_dir) and os.path.exists(meta_path)):
        logger.warning("Model B artifacts not found in %s; run training/train_model_b.py", base)
        _state = None
        registry.mark_loaded("b", False)
        return False

    import torch  # noqa: F401  (imported for its side effect of initialising threads)
    from transformers import AutoModelForSequenceClassification, AutoTokenizer

    with open(meta_path, encoding="utf-8") as fh:
        meta = json.load(fh)

    tokenizer = AutoTokenizer.from_pretrained(model_dir)
    model = AutoModelForSequenceClassification.from_pretrained(model_dir)
    model.eval()

    label2id = {v: int(k) for k, v in model.config.id2label.items()} \
        if isinstance(next(iter(model.config.id2label)), int) \
        else {v: int(k) for k, v in model.config.id2label.items()}
    distress_index = label2id.get(DISTRESS_LABEL, 1)

    _state = _LoadedModel(
        tokenizer=tokenizer,
        model=model,
        meta=meta,
        max_length=int(meta.get("hyperparameters", {}).get("max_length", 160)),
        distress_index=distress_index,
    )
    registry.mark_loaded("b", True)
    logger.info("Model B loaded (base %s)", meta.get("base_model"))
    return True


def is_loaded() -> bool:
    return _state is not None


def metadata() -> dict:
    if _state is None:
        raise ModelNotLoadedError("Model B is not loaded")
    return _state.meta


def detect_script_language(text: str, requested: str) -> str:
    """Identify the script, and report it honestly.

    Deliberately script detection rather than a language-ID model. Devanagari
    is shared by Hindi, Marathi, Nepali and others, so claiming to tell them
    apart from a short self-report would be an overclaim. When the requested
    language uses the script we observe, that request is taken at its word;
    otherwise the script is reported.
    """
    devanagari = latin = 0
    for char in text:
        if not char.isalpha():
            continue
        name = unicodedata.name(char, "")
        if name.startswith("DEVANAGARI"):
            devanagari += 1
        elif name.startswith("LATIN"):
            latin += 1

    total = devanagari + latin
    if total == 0:
        return requested

    devanagari_share = devanagari / total
    if 0.15 < devanagari_share < 0.85:
        # Code-mixing is the norm in Indian-language self-reports; say so rather
        # than forcing it into one bucket.
        return "mixed"
    if devanagari_share >= 0.85:
        return requested if requested in _DEVANAGARI_LANGUAGES else "hi"
    return requested if requested not in _DEVANAGARI_LANGUAGES else "en"


def predict(text: str, language: str) -> tuple[float, str]:
    """Return (score_b, language_detected).

    `text` is never stored, never logged, and never echoed back.
    """
    if _state is None:
        raise ModelNotLoadedError(
            "Model B artifacts are not loaded; run training/train_model_b.py"
        )

    import torch

    encoded = _state.tokenizer(
        text, truncation=True, padding="max_length",
        max_length=_state.max_length, return_tensors="pt",
    )
    with torch.no_grad():
        logits = _state.model(**encoded).logits

    probabilities = torch.softmax(logits, dim=-1)[0]
    score_b = float(probabilities[_state.distress_index])

    return round(score_b, 6), detect_script_language(text, language)
