"""The calibration sweep, and the harness that produces it.

The generator's distributional constants are unverified. This suite covers the
machinery that measures how much that matters, plus the recorded result when it
is present.
"""

from __future__ import annotations

import json
import os
from dataclasses import fields

import numpy as np
import pytest

from data_gen.generate_synthetic import DEFAULT_CALIBRATION, Calibration
from training.sensitivity import perturb

ARTIFACTS = os.environ.get("ARTIFACTS_DIR", "artifacts")
REPORT = os.path.join(ARTIFACTS, "sensitivity_report.json")


def test_the_calibration_holds_every_assumed_constant():
    """A constant left as a literal is one the sweep cannot vary.

    The point of the dataclass is that perturbing it perturbs everything the
    provenance note calls an assumption. A new literal added to the generator
    would silently sit outside the analysis.
    """
    names = {field.name for field in fields(Calibration)}
    assert len(names) >= 40
    for expected in ("noise_sd", "combo_hazard_denial", "leave_denial_penalty",
                     "incident_p_base", "hazard_share_baseline", "w_denied"):
        assert expected in names


def test_every_constant_moves_and_stays_inside_the_stated_spread():
    rng = np.random.default_rng(1)
    shifted = perturb(DEFAULT_CALIBRATION, rng, 0.25)
    for field in fields(Calibration):
        base = getattr(DEFAULT_CALIBRATION, field.name)
        new = getattr(shifted, field.name)
        assert new != base, f"{field.name} was not perturbed"
        assert 0.75 * base <= new <= 1.25 * base, f"{field.name} left the spread"


def test_constants_are_perturbed_independently():
    """A single shared factor would mostly rescale the latent risk.

    The band cuts are quantiles, so a uniform rescale is absorbed and the sweep
    would report far more stability than it has any right to.
    """
    shifted = perturb(DEFAULT_CALIBRATION, np.random.default_rng(2), 0.25)
    ratios = {
        round(getattr(shifted, f.name) / getattr(DEFAULT_CALIBRATION, f.name), 6)
        for f in fields(Calibration)
    }
    assert len(ratios) > 1


def test_the_sweep_is_reproducible_from_its_seed():
    a = perturb(DEFAULT_CALIBRATION, np.random.default_rng(7), 0.25)
    b = perturb(DEFAULT_CALIBRATION, np.random.default_rng(7), 0.25)
    assert a == b


def test_the_default_calibration_is_the_one_the_project_was_built_on():
    """Guards the refactor that moved these out of the function bodies.

    Regenerating at the default seed reproduced the committed parquet frames
    byte for byte. If a default changes, that equivalence is gone and every
    recorded metric belongs to a different dataset.
    """
    assert DEFAULT_CALIBRATION.noise_sd == 0.55
    assert DEFAULT_CALIBRATION.combo_hazard_denial == 2.6
    assert DEFAULT_CALIBRATION.combo_duty_separation == 2.4
    assert DEFAULT_CALIBRATION.combo_chronic_exposure == 1.8


needs_report = pytest.mark.skipif(
    not os.path.exists(REPORT),
    reason="run training/sensitivity.py first (offline analysis, not part of CI)",
)


@pytest.fixture
def report():
    with open(REPORT, encoding="utf-8") as fh:
        return json.load(fh)


@needs_report
def test_the_recorded_sweep_perturbed_everything_at_once(report):
    assert report["spread"] > 0
    assert len(report["draws"]) >= 10
    assert "every calibration constant scaled independently" in report["method"]


@needs_report
def test_the_three_conclusions_are_recorded_with_their_worst_draw(report):
    """A conclusion without its worst case is a headline, not a finding."""
    for name in ("model_ranks_usefully", "tree_beats_linear",
                 "no_single_feature_is_near_diagnostic"):
        row = report["conclusions"][name]
        assert isinstance(row["holds"], bool)
        assert "worst" in row and "test" in row


@needs_report
def test_the_report_does_not_pass_itself_off_as_the_shipped_model(report):
    """Its Model A has no calibrator and no trigger, so its numbers are not the
    ones the project quotes. Someone will read this file out of context."""
    assert "not_the_shipped_pipeline" in report
    # The name evaluate.py uses must not appear here for a different quantity.
    assert "priority_alert_rate" not in json.dumps(report)


@needs_report
def test_the_caveat_about_what_this_does_not_show_survives(report):
    assert "not evidence that they are right" in report["caveat"]
