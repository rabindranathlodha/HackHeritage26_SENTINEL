"""Model A tests (spec 7.1, step 3.5).

Covers the properties that separate a real trained model from a convincing
stub: it varies with its input, it orders people the way the hidden ground
truth does, its attribution is category-level only, and it refuses to serve
rather than inventing a score when its artifact is missing or stale.
"""

from __future__ import annotations

import json
import os
import shutil

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.config import BANDS_ORDERED, band_for_score
from app.main import app
from app.models import model_a
from app.services.explain import FEATURE_CATEGORIES
from app.services.feature_pipeline import FEATURE_ORDER, compute_features
from tests.conftest import requires_db

client = TestClient(app)

ARTIFACTS = os.environ.get("ARTIFACTS_DIR", "artifacts")

requires_model_a = pytest.mark.skipif(
    not os.path.exists(os.path.join(ARTIFACTS, model_a.MODEL_FILE)),
    reason="run training/train_model_a.py first",
)

pytestmark = requires_model_a


@pytest.fixture(scope="module", autouse=True)
def loaded():
    model_a.load()
    yield
    model_a.load()  # restore for any later module


FEATURES = {
    "leave_deviation_30d": 0.0,
    "leave_deviation_90d": 0.0,
    "leave_denied_count_90d": 0,
    "deployment_days": 245,
    "days_since_home_posting": 427,
    "remote_hazardous": True,
    "transfers_12mo": 0,
    "shift_irregularity_90d": 0.3736,
    "night_shift_ratio_90d": 0.205,
    "consecutive_duty_days_max_90d": 9,
    "training_load_trend_90d": 0.0151,
    "days_since_incident": 99,
}

HIGH_RISK_FEATURES = {
    **FEATURES,
    "leave_denied_count_90d": 6,
    "deployment_days": 1100,
    "days_since_home_posting": 1400,
    "shift_irregularity_90d": 4.5,
    "consecutive_duty_days_max_90d": 34,
    "days_since_incident": 4,
}


# Loading


def test_model_loads_and_health_reports_it():
    assert model_a.is_loaded()
    assert client.get("/health").json()["models_loaded"]["a"] is True


def test_artifact_records_the_feature_order_it_was_trained_on():
    assert tuple(model_a.metadata()["feature_order"]) == tuple(FEATURE_ORDER)
    assert tuple(model_a.metadata()["classes"]) == tuple(BANDS_ORDERED)


def test_load_refuses_an_artifact_trained_on_a_different_feature_pipeline(tmp_path):
    """A pipeline edit without a retrain must fail loudly, not score silently.

    Scoring the right values in the wrong order produces plausible-looking
    output, which is the worst possible failure mode here.
    """
    staged = tmp_path / "artifacts"
    staged.mkdir()
    for name in (model_a.MODEL_FILE, model_a.CALIBRATOR_FILE, model_a.META_FILE):
        shutil.copy(os.path.join(ARTIFACTS, name), staged / name)

    meta_path = staged / model_a.META_FILE
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    meta["feature_order"] = list(reversed(meta["feature_order"]))
    meta_path.write_text(json.dumps(meta), encoding="utf-8")

    with pytest.raises(RuntimeError, match="feature pipeline has changed"):
        model_a.load(str(staged))


def test_missing_artifacts_leave_the_model_unloaded_rather_than_stubbed(tmp_path):
    assert model_a.load(str(tmp_path)) is False
    assert not model_a.is_loaded()

    response = client.post(
        "/predict/structured", json={"user_id": "u1", "features": FEATURES}
    )
    assert response.status_code == 503

    model_a.load()  # restore


# Behaviour


def test_prediction_varies_with_its_input():
    """The property a constant stub would fail."""
    low = client.post(
        "/predict/structured", json={"user_id": "u1", "features": FEATURES}
    ).json()
    high = client.post(
        "/predict/structured", json={"user_id": "u2", "features": HIGH_RISK_FEATURES}
    ).json()

    assert high["score_a"] > low["score_a"]


def test_prediction_is_deterministic():
    body = {"user_id": "u1", "features": FEATURES}

    first = client.post("/predict/structured", json=body).json()
    second = client.post("/predict/structured", json=body).json()

    assert first == second


def test_band_is_derived_from_the_shared_thresholds_not_the_argmax_class():
    for features in (FEATURES, HIGH_RISK_FEATURES):
        body = client.post(
            "/predict/structured", json={"user_id": "u1", "features": features}
        ).json()

        assert body["band"] == band_for_score(body["score_a"] * 100.0).value


@requires_db
def test_scores_order_people_the_way_the_hidden_ground_truth_does():
    """Mean score_a must increase across the true bands.

    The label is never exposed by the API; this reads it from the training-only
    table purely to check the ordering holds.
    """
    persons_path = os.path.join(ARTIFACTS, "synthetic_persons.parquet")
    if not os.path.exists(persons_path):
        pytest.skip("run data_gen.generate_synthetic first")

    from app.db import load_hr_history

    truth = pd.read_parquet(persons_path)
    means = []
    for band in BANDS_ORDERED:
        ids = truth[truth["risk_band"] == band]["user_id"].head(15).tolist()
        scores = [
            model_a.predict(compute_features(load_hr_history(u)))[0] for u in ids
        ]
        means.append(sum(scores) / len(scores))

    assert means == sorted(means), f"score_a is not ordered across bands: {means}"
    assert means[-1] - means[0] > 0.3, "bands are barely separated"


# Explainability and its privacy boundary


def test_shap_attribution_is_category_level_and_normalised():
    body = client.post(
        "/predict/structured", json={"user_id": "u1", "features": HIGH_RISK_FEATURES}
    ).json()
    categories = body["shap_categories"]

    assert set(categories) == set(FEATURE_CATEGORIES)
    assert sum(categories.values()) == pytest.approx(1.0, abs=1e-4)
    assert all(v >= 0.0 for v in categories.values())


def test_no_feature_level_detail_leaks_into_the_response():
    body = client.post(
        "/predict/structured", json={"user_id": "u1", "features": HIGH_RISK_FEATURES}
    ).json()
    serialised = json.dumps(body).lower()

    for feature in FEATURE_ORDER:
        assert feature not in serialised, f"raw feature name {feature} leaked"
    for banned in ("date", "incident_on", "event"):
        assert banned not in serialised


def test_attribution_responds_to_which_stressors_are_present():
    """Attribution must track the input, or it is decoration rather than SHAP."""
    incident_heavy = client.post(
        "/predict/structured",
        json={"user_id": "u1", "features": {**HIGH_RISK_FEATURES, "days_since_incident": 1}},
    ).json()["shap_categories"]
    no_incident = client.post(
        "/predict/structured",
        json={"user_id": "u1", "features": {**HIGH_RISK_FEATURES, "days_since_incident": 999}},
    ).json()["shap_categories"]

    assert incident_heavy != no_incident


# Reported metrics


def test_metadata_reports_per_class_metrics_not_just_accuracy():
    """At 70/20/7/3 prevalence, headline accuracy would be misleading."""
    metrics = model_a.metadata()["metrics"]

    assert "macro_f1" in metrics
    assert set(metrics["per_class"]) >= set(BANDS_ORDERED)
    for band in BANDS_ORDERED:
        assert {"precision", "recall", "f1-score"} <= set(metrics["per_class"][band])


def test_metadata_records_which_decision_rule_was_evaluated():
    """Evaluating a rule the service does not use would be a silent mismatch."""
    assert "threshold" in model_a.metadata()["decision_rule"]
