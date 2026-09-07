"""Shared physiological feature engineering for Model C (spec 7.3)."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

SIGNALS = ("resting_hr", "hrv_ms", "sleep_hours", "sleep_efficiency")

# Deviation features first, then the absolute readings. Order is fixed and
# asserted against the artifact metadata at load time.
FEATURE_ORDER_C = (
    "resting_hr_z",
    "hrv_ms_z",
    "sleep_hours_z",
    "sleep_efficiency_z",
    "resting_hr",
    "hrv_ms",
    "sleep_hours",
    "sleep_efficiency",
)

# A person whose own readings barely move would otherwise divide by ~0 and turn
# ordinary noise into an extreme deviation.
_MIN_SD = {
    "resting_hr": 1.5,
    "hrv_ms": 3.0,
    "sleep_hours": 0.30,
    "sleep_efficiency": 0.015,
}

# Deviations are clipped: the question is "is this person off their own
# baseline", and beyond a few standard deviations the answer is already yes.
# Leaving the tail unbounded lets one bad night's sensor reading dominate.
_Z_CLIP = 6.0


@dataclass(frozen=True)
class PhysiologicalBaseline:
    """A person's own rolling baseline — summary statistics only, never readings."""

    resting_hr_mean: float
    resting_hr_sd: float
    hrv_ms_mean: float
    hrv_ms_sd: float
    sleep_hours_mean: float
    sleep_hours_sd: float
    sleep_efficiency_mean: float
    sleep_efficiency_sd: float

    def mean(self, signal: str) -> float:
        return float(getattr(self, f"{signal}_mean"))

    def sd(self, signal: str) -> float:
        return max(float(getattr(self, f"{signal}_sd")), _MIN_SD[signal])


def baseline_from_history(history: pd.DataFrame) -> PhysiologicalBaseline:
    """Summarise a person's own history into a baseline.

    Used by training to build each person's baseline, and by the on-device
    layer to build the one it sends with a request.
    """
    missing = set(SIGNALS) - set(history.columns)
    if missing:
        raise ValueError(f"history is missing signals: {sorted(missing)}")
    if len(history) < 2:
        raise ValueError("need at least two observations to form a baseline")

    values: dict[str, float] = {}
    for signal in SIGNALS:
        column = history[signal].astype(float)
        values[f"{signal}_mean"] = float(column.mean())
        values[f"{signal}_sd"] = float(column.std(ddof=1))
    return PhysiologicalBaseline(**values)


def deviation_features(
    signals: dict[str, float], baseline: PhysiologicalBaseline
) -> dict[str, float]:
    """One day's readings expressed as deviation from a baseline, plus the readings.

    Both are kept: the deviation carries most of the signal, and the absolute
    level still matters at the extremes (a resting heart rate of 105 is worth
    noticing even in someone whose baseline is high).
    """
    features: dict[str, float] = {}
    for signal in SIGNALS:
        value = float(signals[signal])
        z = (value - baseline.mean(signal)) / baseline.sd(signal)
        features[f"{signal}_z"] = float(np.clip(z, -_Z_CLIP, _Z_CLIP))
        features[signal] = value
    return {name: features[name] for name in FEATURE_ORDER_C}


def deviation_features_batch(
    observations: pd.DataFrame, baselines: dict[str, PhysiologicalBaseline]
) -> pd.DataFrame:
    """Vectorised over people for training, through the same per-row logic."""
    rows = []
    for row in observations.itertuples(index=False):
        baseline = baselines[row.user_id]
        signals = {s: getattr(row, s) for s in SIGNALS}
        rows.append({"user_id": row.user_id, **deviation_features(signals, baseline)})
    return pd.DataFrame(rows)
