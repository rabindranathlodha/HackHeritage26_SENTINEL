"""Endpoint contract tests (spec Section 5 / step 3.4).

These check the wiring and the contract, not model quality — at this step every
model behind the routes is a stub. What must be real from the first slice: the
schemas, 422 on malformed input, the consent gate, category-level-only
attribution, weight renormalisation over available signals, and the disclaimer.
"""

from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient

from app.config import BAND_ORDER, DISCLAIMER, band_for_score
from app.main import app
from app.models import model_b, model_c
from app.services.explain import FEATURE_CATEGORIES, aggregate_shap
from app.services.feature_pipeline import FEATURE_ORDER

client = TestClient(app)

ARTIFACTS = os.environ.get("ARTIFACTS_DIR", "artifacts")

# These tests were written at step 3.4, when every model was a stub that always
# returned a value. Now that the models are real, a test that needs one has to
# say so — otherwise it fails wherever that artifact is absent, which is exactly
# what CI is (it trains A and C, but not the multi-GB Model B stack).
requires_model_b = pytest.mark.skipif(
    not os.path.isdir(os.path.join(ARTIFACTS, model_b.OUTPUT_DIR)),
    reason="Model B artifact absent; run training/train_model_b.py",
)
requires_model_c = pytest.mark.skipif(
    not os.path.exists(os.path.join(ARTIFACTS, model_c.MODEL_FILE)),
    reason="Model C artifact absent; run training/train_model_c.py",
)

VALID_FEATURES = {
    "leave_deviation_30d": 0.4,
    "leave_deviation_90d": 0.2,
    "leave_denied_count_90d": 3,
    "deployment_days": 540,
    "days_since_home_posting": 610,
    "remote_hazardous": True,
    "transfers_12mo": 2,
    "shift_irregularity_90d": 1.8,
    "night_shift_ratio_90d": 0.42,
    "consecutive_duty_days_max_90d": 21,
    "training_load_trend_90d": 0.15,
    "days_since_incident": 12,
}

CATEGORY_NAMES = set(FEATURE_CATEGORIES)


def response_text(body: dict) -> str:
    return str(body).lower()


# /predict/structured


def test_structured_returns_the_contract_shape():
    response = client.post(
        "/predict/structured", json={"user_id": "u1", "features": VALID_FEATURES}
    )

    assert response.status_code == 200
    body = response.json()
    assert 0.0 <= body["score_a"] <= 1.0
    assert body["band"] in [b.value for b in BAND_ORDER]
    assert set(body["shap_categories"]) == CATEGORY_NAMES


def test_structured_attribution_is_category_level_only():
    """No raw feature name and no event detail may appear in the response."""
    body = client.post(
        "/predict/structured", json={"user_id": "u1", "features": VALID_FEATURES}
    ).json()

    leaked = set(body["shap_categories"]) & set(FEATURE_ORDER)
    assert not leaked, f"feature-level attribution leaked: {leaked}"
    assert "date" not in response_text(body)
    assert "incident_date" not in response_text(body)


@pytest.mark.parametrize(
    "mutation",
    [
        {"leave_denied_count_90d": "many"},
        {"remote_hazardous": "yes please"},
        {"deployment_days": None},
    ],
)
def test_structured_rejects_malformed_input_with_422(mutation):
    features = {**VALID_FEATURES, **mutation}

    response = client.post(
        "/predict/structured", json={"user_id": "u1", "features": features}
    )

    assert response.status_code == 422


def test_structured_requires_every_feature():
    incomplete = {k: v for k, v in VALID_FEATURES.items() if k != "deployment_days"}

    response = client.post(
        "/predict/structured", json={"user_id": "u1", "features": incomplete}
    )

    assert response.status_code == 422


# /predict/text


@requires_model_b
@pytest.mark.parametrize(
    ("text", "language"),
    [
        ("I have not been sleeping well since the posting change.", "en"),
        ("मुझे पिछले कुछ हफ्तों से नींद नहीं आ रही है।", "hi"),
    ],
)
def test_text_returns_a_score_for_english_and_hindi(text, language):
    response = client.post(
        "/predict/text", json={"user_id": "u1", "text": text, "language": language}
    )

    assert response.status_code == 200
    body = response.json()
    assert 0.0 <= body["score_b"] <= 1.0
    assert body["language_detected"] == language


def test_text_rejects_an_empty_submission():
    response = client.post("/predict/text", json={"user_id": "u1", "text": ""})

    assert response.status_code == 422


@requires_model_b
def test_text_response_never_echoes_the_submitted_text():
    """The raw text must not leave the service, let alone be persisted."""
    secret = "a distinctive phrase that must not come back"

    body = client.post(
        "/predict/text", json={"user_id": "u1", "text": secret, "language": "en"}
    ).json()

    assert secret not in str(body)
    assert set(body) == {"score_b", "language_detected"}


# /predict/physiological — the consent gate


SIGNALS = {
    "resting_hr": 78.0,
    "hrv_ms": 31.0,
    "sleep_hours": 5.2,
    "sleep_efficiency": 0.74,
}


BASELINE = {
    "resting_hr_mean": 66.0, "resting_hr_sd": 3.2,
    "hrv_ms_mean": 52.0, "hrv_ms_sd": 7.5,
    "sleep_hours_mean": 6.9, "sleep_hours_sd": 0.6,
    "sleep_efficiency_mean": 0.885, "sleep_efficiency_sd": 0.035,
}


@requires_model_c
def test_physiological_returns_a_contribution_with_consent():
    response = client.post(
        "/predict/physiological",
        json={"user_id": "u1", "consent": True, "signals": SIGNALS,
              "baseline": BASELINE},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["used"] is True
    assert 0.0 <= body["score_c"] <= 1.0


@pytest.mark.parametrize(
    "payload",
    [
        {"user_id": "u1", "consent": False, "signals": SIGNALS},
        {"user_id": "u1", "consent": True, "signals": None},
        {"user_id": "u1"},
        # Consent and signals but no personal baseline: Model C declines rather
        # than scoring against population statistics, which measured at chance.
        {"user_id": "u1", "consent": True, "signals": SIGNALS},
    ],
)
def test_physiological_without_consent_is_a_clean_null_not_an_error(payload):
    """Spec 5.3: no error. The system must work fully without this signal."""
    response = client.post("/predict/physiological", json=payload)

    assert response.status_code == 200
    assert response.json() == {"score_c": None, "used": False}


# /predict/fusion


def test_fusion_returns_the_contract_shape_with_the_disclaimer():
    response = client.post(
        "/predict/fusion",
        json={
            "user_id": "u1",
            "score_a": 0.5,
            "score_b": 0.4,
            "score_c": 0.3,
            "shap_categories": {"deployment_load": 0.5, "leave_pattern": 0.5},
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {
        "sentinel_score", "band", "confidence", "override_fired",
        "shap_categories", "disclaimer",
    }
    assert body["disclaimer"] == DISCLAIMER
    assert body["band"] == band_for_score(body["sentinel_score"]).value
    assert body["confidence"]["low"] <= body["confidence"]["high"]


def test_fusion_works_on_score_a_alone():
    """A person with no self-report and no biometric consent is still scored."""
    response = client.post(
        "/predict/fusion",
        json={"user_id": "u1", "score_a": 0.6, "score_b": None, "score_c": None},
    )

    assert response.status_code == 200
    body = response.json()
    # With only signal A available its weight renormalises to 1.0.
    assert body["sentinel_score"] == pytest.approx(60.0, abs=0.01)


def test_fusion_renormalises_weights_over_available_signals_only():
    """Missing signals must not drag the score down as if they were zero."""
    a_only = client.post(
        "/predict/fusion", json={"user_id": "u1", "score_a": 0.8}
    ).json()
    all_three = client.post(
        "/predict/fusion",
        json={"user_id": "u1", "score_a": 0.8, "score_b": 0.8, "score_c": 0.8},
    ).json()

    assert a_only["sentinel_score"] == pytest.approx(all_three["sentinel_score"], abs=0.01)


def test_fusion_never_returns_a_raw_binary_label():
    """Spec principle 3: always a band, a confidence interval and attribution."""
    body = client.post("/predict/fusion", json={"user_id": "u1", "score_a": 0.9}).json()

    assert body["band"] in [b.value for b in BAND_ORDER]
    assert isinstance(body["confidence"]["low"], float)
    assert isinstance(body["confidence"]["high"], float)
    assert not any(isinstance(v, bool) for k, v in body.items() if k != "override_fired"), (
        "no boolean flag may stand in for the band"
    )


@pytest.mark.parametrize("bad_score", [-0.1, 1.5])
def test_fusion_rejects_out_of_range_scores(bad_score):
    response = client.post(
        "/predict/fusion", json={"user_id": "u1", "score_a": bad_score}
    )

    assert response.status_code == 422


# Band thresholds and category mapping


@pytest.mark.parametrize(
    ("score", "expected"),
    [
        (0.0, "LOW"), (25.0, "LOW"),
        (26.0, "MODERATE"), (55.0, "MODERATE"),
        (56.0, "ELEVATED"), (80.0, "ELEVATED"),
        (81.0, "PRIORITY_REVIEW"), (100.0, "PRIORITY_REVIEW"),
    ],
)
def test_band_thresholds_match_the_spec(score, expected):
    assert band_for_score(score).value == expected


def test_every_feature_maps_to_exactly_one_category():
    mapped = [f for features in FEATURE_CATEGORIES.values() for f in features]

    assert sorted(mapped) == sorted(FEATURE_ORDER)
    assert len(mapped) == len(set(mapped)), "a feature appears in two categories"


def test_shap_aggregation_produces_normalised_category_shares():
    feature_shap = dict.fromkeys(FEATURE_ORDER, 0.0)
    feature_shap["deployment_days"] = 0.6
    feature_shap["leave_denied_count_90d"] = -0.4  # sign is discarded

    categories = aggregate_shap(feature_shap).model_dump()

    assert sum(categories.values()) == pytest.approx(1.0)
    assert categories["deployment_load"] == pytest.approx(0.6)
    assert categories["leave_pattern"] == pytest.approx(0.4)
