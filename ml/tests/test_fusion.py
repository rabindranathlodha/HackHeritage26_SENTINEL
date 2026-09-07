"""Fusion layer tests (spec 7.5, step 3.8).

The three unit tests spec 7.5 names explicitly, plus regression tests for the
two failures measured against the real models at steps 3.6 and 3.7. Those two
are the ones that matter most: both were cases where the literal spec arithmetic
scored a person LOWER than the evidence warranted.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.config import DISCLAIMER, RiskBand, band_for_score
from app.main import app
from app.models.fusion import SELF_REPORT_OVERRIDE_THRESHOLD, fuse

client = TestClient(app)

BAND_RANK = {b.value: i for i, b in enumerate(RiskBand)}


def api_fuse(score_a: float, score_b=None, score_c=None) -> dict:
    response = client.post(
        "/predict/fusion",
        json={"user_id": "u1", "score_a": score_a, "score_b": score_b,
              "score_c": score_c, "shap_categories": {}},
    )
    assert response.status_code == 200, response.text
    return response.json()


def width(result: dict) -> float:
    return result["confidence"]["high"] - result["confidence"]["low"]


# The three unit tests named in spec 7.5


def test_override_fires_when_self_report_is_high_and_band_is_below_elevated():
    """Spec 7.5: score_a=0.2, score_b=0.85, score_c=null -> band raised."""
    without = api_fuse(0.2)
    with_report = api_fuse(0.2, score_b=0.85)

    assert with_report["override_fired"] is True
    assert BAND_RANK[with_report["band"]] > BAND_RANK[without["band"]]


def test_missing_signals_still_produce_a_score_from_signal_a_alone():
    """Spec 7.5: score_b=null, score_c=null -> works on score_a alone."""
    result = api_fuse(0.6)

    assert result["sentinel_score"] == pytest.approx(60.0, abs=0.01)
    assert result["band"] == "ELEVATED"
    assert result["override_fired"] is False


def test_agreeing_signals_narrow_the_interval_and_disagreement_widens_it():
    """Spec 7.5: confidence reflects how much the signals corroborate."""
    agree = api_fuse(0.5, score_b=0.5, score_c=0.5)
    disagree = api_fuse(0.5, score_b=0.95, score_c=0.05)

    assert width(agree) < width(disagree)


# Regression: the dilution failure measured at step 3.6


def test_a_weak_corroborating_signal_cannot_demote_a_high_risk_person():
    """Measured at 3.6: score_a=0.90 with score_c=0.20 fell to ELEVATED.

    Model C clusters near 0.15-0.25 because it is a weak signal by design. A
    plain weighted mean let it drag every high-risk person toward its own mean.
    """
    alone = api_fuse(0.90)
    with_physio = api_fuse(0.90, score_c=0.20)

    assert alone["band"] == "PRIORITY_REVIEW"
    assert with_physio["band"] == "PRIORITY_REVIEW"
    assert with_physio["sentinel_score"] >= alone["sentinel_score"]


def test_consenting_to_biometrics_never_lowers_your_score():
    """The fairness property behind the consent gate.

    If consenting could reduce a person's score, the gate would be rewarding
    people for withholding data — the exact opposite of informed consent.
    """
    for score_a in (0.1, 0.3, 0.5, 0.7, 0.9):
        for score_c in (0.05, 0.2, 0.4, 0.6, 0.8):
            withheld = api_fuse(score_a)
            consented = api_fuse(score_a, score_c=score_c)

            assert consented["sentinel_score"] >= withheld["sentinel_score"], (
                f"consenting lowered the score at a={score_a}, c={score_c}"
            )


def test_a_low_self_report_cannot_cancel_behavioural_concern():
    """Under-reporting is the expected failure mode in this population.

    Someone saying "I am fine" must not erase what their duty record shows.
    """
    alone = api_fuse(0.85)
    denying = api_fuse(0.85, score_b=0.05)

    assert denying["sentinel_score"] >= alone["sentinel_score"]


def test_a_strong_secondary_signal_still_raises_the_score():
    """The floor prevents dilution; it must not block genuine escalation."""
    alone = api_fuse(0.20)
    with_physio = api_fuse(0.20, score_c=0.80)

    assert with_physio["sentinel_score"] > alone["sentinel_score"]


# Regression: the self-report miss measured at step 3.7


def test_the_measured_37_case_now_reaches_human_review():
    """Measured at 3.7 with the real models.

    A person whose duty record was unremarkable (score_a 0.125) wrote in Hindi
    that they could not sleep, that every day felt heavier and that they had
    nobody to talk to. Model B scored 0.847. The stub fusion returned MODERATE.
    """
    result = api_fuse(0.125, score_b=0.846737)

    assert result["override_fired"] is True
    assert BAND_RANK[result["band"]] >= BAND_RANK["ELEVATED"], (
        "a person explicitly asking for help must reach human review"
    )


@pytest.mark.parametrize("score_b", [0.76, 0.85, 0.95, 1.0])
def test_override_fires_across_the_range_above_the_threshold(score_b):
    assert api_fuse(0.1, score_b=score_b)["override_fired"] is True


@pytest.mark.parametrize("score_b", [0.0, 0.5, 0.74, SELF_REPORT_OVERRIDE_THRESHOLD])
def test_override_does_not_fire_at_or_below_the_threshold(score_b):
    assert api_fuse(0.1, score_b=score_b)["override_fired"] is False


def test_override_does_not_double_promote_an_already_elevated_person():
    """Spec 7.5 gates the override on the band being below ELEVATED."""
    result = api_fuse(0.7, score_b=0.9)

    assert result["override_fired"] is False
    assert BAND_RANK[result["band"]] >= BAND_RANK["ELEVATED"]


def test_override_raises_by_one_tier_not_straight_to_the_top():
    """Escalation should be proportionate; PRIORITY_REVIEW is not the default."""
    result = api_fuse(0.05, score_b=0.99)

    assert result["band"] != "PRIORITY_REVIEW"


# Internal consistency


@pytest.mark.parametrize(
    ("a", "b", "c"),
    [(0.1, None, None), (0.5, 0.5, 0.5), (0.2, 0.85, None), (0.9, None, 0.2),
     (0.05, 0.99, 0.01), (1.0, 1.0, 1.0), (0.0, 0.0, 0.0)],
)
def test_band_always_matches_the_score_it_is_reported_with(a, b, c):
    """The dashboard shows both; they must never disagree."""
    result = api_fuse(a, score_b=b, score_c=c)

    assert result["band"] == band_for_score(result["sentinel_score"]).value


@pytest.mark.parametrize(
    ("a", "b", "c"),
    [(0.1, None, None), (0.5, 0.5, 0.5), (0.2, 0.85, None), (1.0, 1.0, 1.0)],
)
def test_score_and_interval_stay_within_bounds(a, b, c):
    result = api_fuse(a, score_b=b, score_c=c)

    assert 0.0 <= result["sentinel_score"] <= 100.0
    assert 0.0 <= result["confidence"]["low"] <= result["confidence"]["high"] <= 100.0


def test_fewer_signals_widen_the_interval_rather_than_narrowing_it():
    """One signal has nothing to disagree with.

    Treating that as perfect confidence would invert what the interval means:
    the least-informed prediction would look the most certain.
    """
    one = api_fuse(0.5)
    two = api_fuse(0.5, score_b=0.5)
    three = api_fuse(0.5, score_b=0.5, score_c=0.5)

    assert width(one) > width(two) > width(three)


def test_every_response_carries_the_disclaimer():
    assert api_fuse(0.4)["disclaimer"] == DISCLAIMER


def test_internal_explanation_is_not_exposed_in_the_api_response():
    """`_explain` is for the evaluation suite, not the contract."""
    result = api_fuse(0.9, score_c=0.2)

    assert "_explain" not in result
    assert set(result) == {"sentinel_score", "band", "confidence", "override_fired",
                           "shap_categories", "disclaimer"}


def test_explanation_records_when_the_non_dilution_floor_bound():
    """Traceability: an officer can be told why a score is what it is."""
    diluted = fuse(0.9, None, 0.2, {})
    undiluted = fuse(0.2, None, 0.8, {})

    assert diluted["_explain"]["non_dilution_floor_applied"] is True
    assert undiluted["_explain"]["non_dilution_floor_applied"] is False


def test_shap_categories_pass_through_unchanged():
    categories = {"deployment_load": 0.4, "leave_pattern": 0.6}

    result = client.post(
        "/predict/fusion",
        json={"user_id": "u1", "score_a": 0.5, "shap_categories": categories},
    ).json()

    assert result["shap_categories"] == categories
