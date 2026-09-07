"""Model C — physiological wellness signal (spec 7.3). REAL model, step 3.6."""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass

import joblib
import numpy as np
import pandas as pd

from app.config import BAND_MIDPOINTS, BANDS_ORDERED
from app.models.registry import registry
from app.schemas.physiological import PhysiologicalSignals
from app.services.physio_features import (
    FEATURE_ORDER_C,
    PhysiologicalBaseline,
    deviation_features,
)

logger = logging.getLogger("sentinel.model_c")

IS_STUB = False

MODEL_FILE = "model_c.joblib"
META_FILE = "model_c_meta.json"


class ModelNotLoadedError(RuntimeError):
    """Raised when a prediction is requested before the artifact is available."""


@dataclass
class _LoadedModel:
    calibrator: object
    isolation: object
    meta: dict
    midpoints: np.ndarray


_state: _LoadedModel | None = None


def artifacts_dir() -> str:
    return os.environ.get("ARTIFACTS_DIR", "artifacts")


def load(artifacts: str | None = None) -> bool:
    global _state
    base = artifacts or artifacts_dir()
    model_path = os.path.join(base, MODEL_FILE)
    meta_path = os.path.join(base, META_FILE)

    if not (os.path.exists(model_path) and os.path.exists(meta_path)):
        logger.warning("Model C artifacts not found in %s; run training/train_model_c.py", base)
        _state = None
        registry.mark_loaded("c", False)
        return False

    with open(meta_path, encoding="utf-8") as fh:
        meta = json.load(fh)

    if tuple(meta["feature_order"]) != tuple(FEATURE_ORDER_C):
        raise RuntimeError(
            "physiological feature pipeline has changed since Model C was trained; "
            "retrain with training/train_model_c.py"
        )

    bundle = joblib.load(model_path)
    _state = _LoadedModel(
        calibrator=bundle["calibrator"],
        isolation=bundle["isolation"],
        meta=meta,
        midpoints=np.array([BAND_MIDPOINTS[b] for b in BANDS_ORDERED]) / 100.0,
    )
    registry.mark_loaded("c", True)
    logger.info("Model C loaded (trained %s)", meta.get("trained_at"))
    return True


def is_loaded() -> bool:
    return _state is not None


def metadata() -> dict:
    if _state is None:
        raise ModelNotLoadedError("Model C is not loaded")
    return _state.meta


def predict(
    consent: bool,
    signals: PhysiologicalSignals | None,
    baseline: PhysiologicalBaseline | None = None,
) -> tuple[float | None, bool]:
    """Return (score_c, used).

    Returns a clean `(None, False)` — never an error — when the signal cannot
    or should not be used. The whole system is required to work without it.
    """
    if not consent or signals is None:
        return None, False

    if baseline is None:
        # See the module docstring: population-referenced scoring measured at
        # chance, so contributing nothing is strictly better than contributing
        # noise to a person's welfare score.
        logger.info("physiological signal skipped: no personal baseline supplied")
        return None, False

    if _state is None:
        raise ModelNotLoadedError(
            "Model C artifacts are not loaded; run training/train_model_c.py"
        )

    features = deviation_features(signals.model_dump(), baseline)
    row = np.array([[features[name] for name in FEATURE_ORDER_C]], dtype=float)

    anomaly = -_state.isolation.score_samples(row[:, :4])
    row = np.column_stack([row, anomaly])

    proba = _state.calibrator.predict_proba(pd.DataFrame(row))[0]
    score_c = float(proba @ _state.midpoints)

    return round(score_c, 6), True
