"""Model A — structured behavioural risk (spec 7.1). REAL model, step 3.5."""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass

import joblib
import numpy as np
import pandas as pd

from app.config import (
    BAND_MIDPOINTS,
    BANDS_ORDERED,
    RiskBand,
    apply_top_band_trigger,
    band_for_score,
)
from app.models.registry import registry
from app.schemas.structured import ShapCategories, StructuredFeatures
from app.services.explain import aggregate_shap
from app.services.feature_pipeline import FEATURE_ORDER

logger = logging.getLogger("sentinel.model_a")

IS_STUB = False

MODEL_FILE = "model_a.json"
CALIBRATOR_FILE = "model_a_calibrator.joblib"
META_FILE = "model_a_meta.json"


class ModelNotLoadedError(RuntimeError):
    """Raised when a prediction is requested before the artifact is available."""


@dataclass
class _LoadedModel:
    booster: object
    calibrator: object
    explainer: object
    meta: dict
    midpoints: np.ndarray


_state: _LoadedModel | None = None


def artifacts_dir() -> str:
    return os.environ.get("ARTIFACTS_DIR", "artifacts")


def load(artifacts: str | None = None) -> bool:
    """Load the trained artifacts. Returns False if they are not present.

    A missing artifact is not an error at import time — the service still
    starts, `/health` reports `models_loaded.a = false`, and the endpoint
    answers 503. It never silently falls back to a stub.
    """
    global _state
    base = artifacts or artifacts_dir()
    model_path = os.path.join(base, MODEL_FILE)
    calibrator_path = os.path.join(base, CALIBRATOR_FILE)
    meta_path = os.path.join(base, META_FILE)

    if not all(os.path.exists(p) for p in (model_path, calibrator_path, meta_path)):
        logger.warning("Model A artifacts not found in %s; run training/train_model_a.py", base)
        # Drop any previously loaded model. Keeping a stale one here would leave
        # /health reporting the model as unloaded while the endpoint quietly
        # kept serving from it — the two must never disagree.
        _state = None
        registry.mark_loaded("a", False)
        return False

    import shap
    import xgboost as xgb

    with open(meta_path, encoding="utf-8") as fh:
        meta = json.load(fh)

    # Fail loudly on a pipeline change that was never retrained.
    if tuple(meta["feature_order"]) != tuple(FEATURE_ORDER):
        raise RuntimeError(
            "feature pipeline has changed since Model A was trained: artifact expects "
            f"{meta['feature_order']} but the pipeline produces {list(FEATURE_ORDER)}. "
            "Retrain with training/train_model_a.py."
        )
    if tuple(meta["classes"]) != tuple(BANDS_ORDERED):
        raise RuntimeError("band definitions have changed since Model A was trained")

    booster = xgb.XGBClassifier()
    booster.load_model(model_path)
    calibrator = joblib.load(calibrator_path)

    # TreeExplainer needs the tree structure, so it explains the raw booster.
    # The calibrator is a monotone transform of the booster's output, so the
    # ordering of feature attributions is unchanged by it.
    explainer = shap.TreeExplainer(booster)

    _state = _LoadedModel(
        booster=booster,
        calibrator=calibrator,
        explainer=explainer,
        meta=meta,
        midpoints=np.array([BAND_MIDPOINTS[b] for b in BANDS_ORDERED]) / 100.0,
    )
    registry.mark_loaded("a", True)
    logger.info(
        "Model A loaded (trained %s, macro-F1 %.4f)",
        meta.get("trained_at"), meta.get("metrics", {}).get("macro_f1", float("nan")),
    )
    return True


def is_loaded() -> bool:
    return _state is not None


def metadata() -> dict:
    if _state is None:
        raise ModelNotLoadedError("Model A is not loaded")
    return _state.meta


def _feature_frame(features: StructuredFeatures) -> pd.DataFrame:
    values = features.model_dump()
    return pd.DataFrame([[float(values[name]) for name in FEATURE_ORDER]],
                        columns=list(FEATURE_ORDER))


def _severity(proba: np.ndarray) -> float:
    """Collapse the four ordinal band probabilities into one 0-1 severity.

    Weighting each band by its midpoint keeps the ordinal information that
    "probability of the top class" would throw away — it distinguishes a
    confident MODERATE from a borderline ELEVATED.
    """
    return float(proba @ _state.midpoints)


def _category_attribution(frame: pd.DataFrame, class_index: int) -> ShapCategories:
    """Category-level SHAP for the band the model assigned.

    Attribution is taken for the assigned class: the question an officer is
    answering is "what is driving this band", not "what drives every band".
    Feature-level values never leave this function — `aggregate_shap` folds
    them into the six categories before anything is returned.
    """
    raw = _state.explainer.shap_values(frame)

    if isinstance(raw, list):  # older shap: one array per class
        values = np.asarray(raw[class_index])[0]
    else:
        values = np.asarray(raw)
        # (n_samples, n_features, n_classes) for multiclass
        values = values[0, :, class_index] if values.ndim == 3 else values[0]

    feature_shap = {name: float(v) for name, v in zip(FEATURE_ORDER, values, strict=True)}
    return aggregate_shap(feature_shap)


def predict(features: StructuredFeatures) -> tuple[float, RiskBand, ShapCategories]:
    """Return (score_a, band, category-level attribution)."""
    if _state is None:
        raise ModelNotLoadedError(
            "Model A artifacts are not loaded; run training/train_model_a.py"
        )

    frame = _feature_frame(features)
    proba = _state.calibrator.predict_proba(frame)[0]

    score_a = _severity(proba)
    # Correct the expected value's regression toward the middle (see
    # config.apply_top_band_trigger and the 3.10 audit).
    score_a, _triggered = apply_top_band_trigger(
        score_a, float(proba[BANDS_ORDERED.index("PRIORITY_REVIEW")])
    )
    band = band_for_score(score_a * 100.0)
    class_index = BANDS_ORDERED.index(band.value)
    shap_categories = _category_attribution(frame, class_index)

    return round(score_a, 6), band, shap_categories
