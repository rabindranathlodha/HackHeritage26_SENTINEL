"""The gate that decides whether a distilled student may ship on-device.

A smaller Model B is only useful if it makes the same calls as the server model.
The self-report override in spec 7.5 is an absolute threshold, so a student that
disagrees about it puts two surfaces on different bands for the same person —
which is worse than shipping no on-device model at all.

These tests cover the gate itself, including that it rejects the 6-layer student
actually measured, so the negative result stays recorded as something executable
rather than a line in a document.
"""

from __future__ import annotations

import pytest

pytest.importorskip("transformers", reason="Model B toolchain is not installed in CI")

from training.distil_model_b import on_device_verdict  # noqa: E402


def comparison(disagreements: int = 0, ci: list[float] | None = None, n: int = 715):
    return {
        "english": {
            "n": n,
            "override_disagreements": disagreements,
            "override_disagreement_rate": disagreements / n,
            "paired_bootstrap_95ci_of_difference": ci if ci is not None else [-0.02, 0.03],
        }
    }


def test_a_student_that_matches_the_teacher_is_allowed():
    verdict = on_device_verdict(comparison())
    assert verdict["replaces_teacher_on_device"]
    assert verdict["blocking"] == []


def test_a_single_override_disagreement_blocks_the_student():
    """Not a rate — one person whose band differs between surfaces is the harm."""
    verdict = on_device_verdict(comparison(disagreements=1))
    assert not verdict["replaces_teacher_on_device"]
    assert "override decisions differ" in verdict["blocking"][0]


def test_a_measurably_worse_student_is_blocked_even_with_no_disagreements():
    verdict = on_device_verdict(comparison(ci=[-0.09, -0.02]))
    assert not verdict["replaces_teacher_on_device"]
    assert "measurably below the teacher" in verdict["blocking"][0]


def test_a_difference_that_could_be_noise_does_not_block():
    """An interval straddling zero is 'not distinguishable', not 'worse'."""
    assert on_device_verdict(comparison(ci=[-0.04, 0.01]))["replaces_teacher_on_device"]


def test_the_six_layer_student_that_was_actually_trained_is_rejected():
    """The measured result, kept executable.

    Two recipes were tried. The first left every layer trainable and Hindi
    macro-F1 fell to 0.4232; the second froze the lower half and distilled on a
    translated training set, which recovered Hindi to 0.6419 but cost English.
    Both are far outside the gate. If someone later believes a 6-layer student
    is fine, this says what was measured.
    """
    measured = {
        "english": {
            "n": 715,
            "override_disagreements": 192,
            "override_disagreement_rate": 0.268531,
            "paired_bootstrap_95ci_of_difference": [-0.1687, -0.094],
        },
        "hindi_back_translated": {
            "n": 300,
            "override_disagreements": 70,
            "override_disagreement_rate": 0.233333,
            "paired_bootstrap_95ci_of_difference": [-0.1588, -0.0289],
        },
    }
    verdict = on_device_verdict(measured)
    assert not verdict["replaces_teacher_on_device"]
    # Both failure modes, on both languages.
    assert len(verdict["blocking"]) == 4
