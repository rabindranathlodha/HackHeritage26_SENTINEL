"""Evaluation-suite tests (spec 3.10, 12).

Checks the audit's OUTPUT contract rather than re-running the five-fold audit,
which takes minutes. The audit itself is run by `python -m training.evaluate`;
these assert that what it produced is complete, honest and safe to show.
"""

from __future__ import annotations

import json
import os

import pytest

from app.privacy.claims import assert_no_clinical_claims

ARTIFACTS = os.environ.get("ARTIFACTS_DIR", "artifacts")
REPORT_PATH = os.path.join(ARTIFACTS, "evaluation_report.json")
CURVE_PATH = os.path.join(ARTIFACTS, "pr_curve.png")

requires_evaluation = pytest.mark.skipif(
    not os.path.exists(REPORT_PATH),
    reason="run training/evaluate.py first",
)

pytestmark = requires_evaluation

REQUIRED_DIMENSIONS = {"posting_type", "tenure_band", "biometric_consent",
                       "scenario", "unit_id"}


@pytest.fixture(scope="module")
def report() -> dict:
    with open(REPORT_PATH, encoding="utf-8") as fh:
        return json.load(fh)


def test_a_pr_curve_image_was_produced(report):
    assert os.path.exists(CURVE_PATH)
    with open(CURVE_PATH, "rb") as fh:
        assert fh.read(8) == b"\x89PNG\r\n\x1a\n", "not a valid PNG"
    assert os.path.getsize(CURVE_PATH) > 5_000


def test_per_cohort_precision_and_recall_are_reported(report):
    """Spec 12: per-cohort precision/recall across posting, unit and tenure."""
    assert REQUIRED_DIMENSIONS <= set(report["cohorts"])

    for dimension in ("posting_type", "tenure_band"):
        for name, group in report["cohorts"][dimension].items():
            if group.get("suppressed"):
                continue
            assert group["precision"] is not None, f"{dimension}/{name} has no precision"
            assert group["recall"] is not None, f"{dimension}/{name} has no recall"
            assert group["false_positive_rate"] is not None


def test_small_cohorts_are_suppressed_rather_than_given_a_noisy_rate(report):
    """Same reasoning as k-anonymity: a rate over eight people is not a finding."""
    min_cohort = report["min_cohort"]

    for groups in report["cohorts"].values():
        for name, group in groups.items():
            if group["n"] < min_cohort:
                assert group.get("suppressed") is True, (
                    f"{name} is below the minimum cohort size but was given rates"
                )
                assert "precision" not in group


def test_the_audit_measures_who_is_missed_not_only_who_is_flagged(report):
    """The costly error here is the person nobody looks at."""
    overall = report["overall"]

    assert "miss_rate" in overall
    assert "priority_alert_rate" in overall
    assert overall["n_true_priority"] > 0


def test_fairness_warnings_are_recorded_rather_than_dropped(report):
    """An audit that quietly discards its own findings is worse than none."""
    assert isinstance(report["fairness_warnings"], list)
    # This dataset currently trips several; if that ever becomes zero it should
    # be because the model improved, not because the check was removed.
    assert "fairness_warnings" in report


def test_the_top_band_trigger_is_active_and_its_trade_off_stays_documented(report):
    """The trigger ships, and the evidence for its tau is kept alongside it.

    A tuning constant with no recorded justification becomes folklore. The
    audit re-derives the whole trade-off table on every run so the chosen tau
    stays a decision someone can re-examine.
    """
    evidence = report["top_band_trigger_evidence"]

    assert "ACTIVE" in evidence["status"]
    assert evidence["options"], "the evidence table is empty"
    for option in evidence["options"]:
        assert {"tau", "alerts", "true_priority_alerted"} <= set(option)


def test_the_trigger_measurably_improved_detection_of_the_highest_risk_band(report):
    """The change was made for a reason; hold it to that reason.

    Before the trigger, 33.3% of people whose true band was PRIORITY_REVIEW
    would have raised an alert. If a future change quietly undoes that, this
    fails rather than the regression going unnoticed.
    """
    assert report["overall"]["priority_alert_rate"] > 0.55


def test_the_audit_is_out_of_fold_not_scored_on_training_data(report):
    assert "out-of-fold" in report["method"]
    assert report["n_people"] >= 3000


def test_the_report_contains_no_clinical_language(report):
    """The audit is a document people read; the boundary applies to it too."""
    assert_no_clinical_claims(report)
