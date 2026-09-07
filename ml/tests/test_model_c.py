"""Model C tests (spec 7.3, step 3.6).

The consent gate is tested in both directions because the whole system is
required to function without this signal, and because an evaluator will try to
obtain a physiological score for someone who never agreed to give one.
"""

from __future__ import annotations

import json
import os

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models import model_c
from app.schemas.physiological import PhysiologicalSignals
from app.services.physio_features import (
    FEATURE_ORDER_C,
    PhysiologicalBaseline,
    baseline_from_history,
    deviation_features,
)

client = TestClient(app)

ARTIFACTS = os.environ.get("ARTIFACTS_DIR", "artifacts")

requires_model_c = pytest.mark.skipif(
    not os.path.exists(os.path.join(ARTIFACTS, model_c.MODEL_FILE)),
    reason="run training/train_model_c.py first",
)

pytestmark = requires_model_c


@pytest.fixture(scope="module", autouse=True)
def loaded():
    model_c.load()
    yield
    model_c.load()


SIGNALS = {
    "resting_hr": 82.0,
    "hrv_ms": 24.0,
    "sleep_hours": 4.6,
    "sleep_efficiency": 0.68,
}

# A person whose own normal sits well below those readings.
CALM_BASELINE = {
    "resting_hr_mean": 66.0, "resting_hr_sd": 3.2,
    "hrv_ms_mean": 52.0, "hrv_ms_sd": 7.5,
    "sleep_hours_mean": 6.9, "sleep_hours_sd": 0.6,
    "sleep_efficiency_mean": 0.885, "sleep_efficiency_sd": 0.035,
}

# A person for whom those same readings ARE normal.
HIGH_BASELINE = {
    "resting_hr_mean": 81.0, "resting_hr_sd": 3.2,
    "hrv_ms_mean": 25.0, "hrv_ms_sd": 7.5,
    "sleep_hours_mean": 4.7, "sleep_hours_sd": 0.6,
    "sleep_efficiency_mean": 0.690, "sleep_efficiency_sd": 0.035,
}


def post(payload: dict) -> dict:
    response = client.post("/predict/physiological", json=payload)
    assert response.status_code == 200, response.text
    return response.json()


# The consent gate (spec principle 7)


def test_no_consent_returns_a_clean_null_even_when_signals_are_supplied():
    """Sending signals must not amount to granting permission to use them."""
    body = post({"user_id": "u1", "consent": False, "signals": SIGNALS,
                 "baseline": CALM_BASELINE})

    assert body == {"score_c": None, "used": False}


def test_consent_without_signals_returns_a_clean_null():
    body = post({"user_id": "u1", "consent": True, "signals": None})

    assert body == {"score_c": None, "used": False}


def test_consent_and_signals_and_baseline_produce_a_contribution():
    body = post({"user_id": "u1", "consent": True, "signals": SIGNALS,
                 "baseline": CALM_BASELINE})

    assert body["used"] is True
    assert 0.0 <= body["score_c"] <= 1.0


def test_model_never_raises_on_a_missing_signal():
    """Spec 5.3: absence is a normal outcome, not an error."""
    for consent, signals in ((False, None), (True, None), (False, SIGNALS)):
        payload = {"user_id": "u1", "consent": consent}
        if signals:
            payload["signals"] = signals
        assert client.post("/predict/physiological", json=payload).status_code == 200


# The personal-baseline requirement


def test_without_a_personal_baseline_the_model_declines_to_contribute():
    """Population-referenced scoring measured at chance, so it is not offered.

    Contributing nothing is strictly better than contributing noise to
    somebody's welfare score.
    """
    body = post({"user_id": "u1", "consent": True, "signals": SIGNALS})

    assert body == {"score_c": None, "used": False}


def test_identical_readings_score_differently_against_different_baselines():
    """The core claim of the per-person approach, tested directly.

    Same four readings. For one person they are a large departure from their
    own normal; for the other they are their normal. A population-threshold
    model would score these identically and flag the second person for being
    physiologically themselves.
    """
    departure = post({"user_id": "u1", "consent": True, "signals": SIGNALS,
                      "baseline": CALM_BASELINE})
    normal_for_them = post({"user_id": "u2", "consent": True, "signals": SIGNALS,
                            "baseline": HIGH_BASELINE})

    assert departure["score_c"] > normal_for_them["score_c"], (
        "the same readings must not score the same for two different people"
    )


def test_larger_deviation_from_ones_own_baseline_scores_higher():
    mild = post({"user_id": "u1", "consent": True, "baseline": CALM_BASELINE,
                 "signals": {"resting_hr": 69.0, "hrv_ms": 49.0,
                             "sleep_hours": 6.6, "sleep_efficiency": 0.87}})
    severe = post({"user_id": "u1", "consent": True, "baseline": CALM_BASELINE,
                   "signals": SIGNALS})

    assert severe["score_c"] > mild["score_c"]


# Feature engineering


def test_deviation_features_are_measured_in_the_persons_own_units():
    baseline = PhysiologicalBaseline(**CALM_BASELINE)

    features = deviation_features(SIGNALS, baseline)

    assert set(features) == set(FEATURE_ORDER_C)
    # 82 bpm against a mean of 66 with sd 3.2 is a large personal departure.
    assert features["resting_hr_z"] == pytest.approx((82.0 - 66.0) / 3.2, abs=1e-6)
    # Absolute readings are carried through unchanged alongside the deviations.
    assert features["resting_hr"] == 82.0


def test_a_flat_baseline_cannot_turn_noise_into_an_extreme_deviation():
    """Dividing by a near-zero personal sd would make ordinary noise look severe."""
    flat = PhysiologicalBaseline(
        resting_hr_mean=66.0, resting_hr_sd=0.0001,
        hrv_ms_mean=52.0, hrv_ms_sd=0.0001,
        sleep_hours_mean=6.9, sleep_hours_sd=0.0001,
        sleep_efficiency_mean=0.885, sleep_efficiency_sd=0.0001,
    )

    features = deviation_features({"resting_hr": 67.0, "hrv_ms": 51.0,
                                   "sleep_hours": 6.8, "sleep_efficiency": 0.88}, flat)

    assert all(abs(features[f"{s}_z"]) <= 6.0 for s in
               ("resting_hr", "hrv_ms", "sleep_hours", "sleep_efficiency"))


def test_baseline_is_summary_statistics_not_raw_readings():
    """What crosses the wire must not be the person's daily history."""
    import pandas as pd

    history = pd.DataFrame({
        "resting_hr": [64.0, 66.0, 68.0, 65.0],
        "hrv_ms": [50.0, 52.0, 54.0, 51.0],
        "sleep_hours": [6.8, 7.0, 7.2, 6.9],
        "sleep_efficiency": [0.88, 0.89, 0.90, 0.885],
    })

    baseline = baseline_from_history(history)
    fields = baseline.__dict__

    assert len(fields) == 8
    assert all(k.endswith(("_mean", "_sd")) for k in fields)


# Artifact integrity


def test_model_loads_and_health_reports_it():
    assert model_c.is_loaded()
    assert client.get("/health").json()["models_loaded"]["c"] is True


def test_metadata_records_the_measured_case_for_the_personal_baseline():
    """The design choice is evidence-backed, and the evidence is kept."""
    by_mode = model_c.metadata()["metrics"]["by_mode"]

    assert by_mode["personal"]["roc_auc"] > by_mode["population_not_offered"]["roc_auc"]


def test_missing_artifacts_leave_the_model_unloaded_rather_than_stubbed(tmp_path):
    assert model_c.load(str(tmp_path)) is False
    assert not model_c.is_loaded()

    model_c.load()


def test_load_refuses_an_artifact_trained_on_a_different_feature_pipeline(tmp_path):
    import shutil

    staged = tmp_path / "artifacts"
    staged.mkdir()
    for name in (model_c.MODEL_FILE, model_c.META_FILE):
        shutil.copy(os.path.join(ARTIFACTS, name), staged / name)

    meta_path = staged / model_c.META_FILE
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    meta["feature_order"] = list(reversed(meta["feature_order"]))
    meta_path.write_text(json.dumps(meta), encoding="utf-8")

    with pytest.raises(RuntimeError, match="feature pipeline has changed"):
        model_c.load(str(staged))

    model_c.load()


def test_score_is_on_the_same_severity_scale_as_model_a():
    """Fusion averages the signals, so they must share a scale."""
    body = post({"user_id": "u1", "consent": True, "signals": SIGNALS,
                 "baseline": CALM_BASELINE})

    assert 0.0 <= body["score_c"] <= 1.0


def test_direct_model_call_matches_the_endpoint():
    direct, used = model_c.predict(
        True, PhysiologicalSignals(**SIGNALS), PhysiologicalBaseline(**CALM_BASELINE)
    )
    via_api = post({"user_id": "u1", "consent": True, "signals": SIGNALS,
                    "baseline": CALM_BASELINE})

    assert used is True
    assert direct == pytest.approx(via_api["score_c"])
