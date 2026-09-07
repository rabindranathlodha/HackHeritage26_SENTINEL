"""Shared feature engineering (spec 7.1)."""

from __future__ import annotations

import pandas as pd

from app.schemas.structured import StructuredFeatures

# Column names as produced by the synthetic generator's parquet snapshot. The
# database loader maps HrSignal's camelCase columns onto these.
REQUIRED_COLUMNS = (
    "date",
    "leave_requested",
    "leave_approved",
    "leave_denied",
    "deployment_days",
    "days_since_home_posting",
    "remote_hazardous",
    "transfers_trailing_12mo",
    "shift_start_std_dev",
    "night_shift_ratio",
    "consecutive_duty_days",
    "training_hours_vs_avg",
    "days_since_incident",
)

FEATURE_ORDER = (
    "leave_deviation_30d",
    "leave_deviation_90d",
    "leave_denied_count_90d",
    "deployment_days",
    "days_since_home_posting",
    "remote_hazardous",
    "transfers_12mo",
    "shift_irregularity_90d",
    "night_shift_ratio_90d",
    "consecutive_duty_days_max_90d",
    "training_load_trend_90d",
    "days_since_incident",
)


def _relative_deviation(window_sum: float, per_day_baseline: float, days: int) -> float:
    """How far a window departs from the person's OWN baseline rate.

    Deliberately a personal baseline rather than a population one: leave-taking
    norms differ enormously by role and posting, and a population threshold
    would systematically flag whole cohorts.
    """
    expected = per_day_baseline * days
    return float((window_sum - expected) / (expected + 1.0))


def compute_features(history: pd.DataFrame) -> StructuredFeatures:
    """Compute the 12 spec-5.1 features from one person's daily history.

    `history` must be sorted ascending by date and cover at least 90 days for
    the 90-day windows to be meaningful.
    """
    missing = set(REQUIRED_COLUMNS) - set(history.columns)
    if missing:
        raise ValueError(f"history is missing columns: {sorted(missing)}")
    if history.empty:
        raise ValueError("history is empty; cannot compute features")

    h = history.sort_values("date")
    last = h.iloc[-1]
    w30 = h.tail(30)
    w90 = h.tail(90)

    # Personal baseline leave rate over the whole observed history.
    leave_rate = float(h["leave_requested"].sum()) / max(len(h), 1)

    # A denial "count" is the number of denied requests, not denied days.
    denied_count_90d = int((w90["leave_denied"] > 0).sum())

    # Training-load trend: recent 30 days against the 90-day level. Positive
    # means load is rising relative to the person's recent norm.
    training_recent = float(w30["training_hours_vs_avg"].mean())
    training_base = float(w90["training_hours_vs_avg"].mean())

    return StructuredFeatures(
        leave_deviation_30d=round(
            _relative_deviation(float(w30["leave_requested"].sum()), leave_rate, len(w30)), 6
        ),
        leave_deviation_90d=round(
            _relative_deviation(float(w90["leave_requested"].sum()), leave_rate, len(w90)), 6
        ),
        leave_denied_count_90d=denied_count_90d,
        deployment_days=int(last["deployment_days"]),
        days_since_home_posting=int(last["days_since_home_posting"]),
        remote_hazardous=bool(last["remote_hazardous"]),
        transfers_12mo=int(last["transfers_trailing_12mo"]),
        shift_irregularity_90d=round(float(w90["shift_start_std_dev"].mean()), 6),
        night_shift_ratio_90d=round(float(w90["night_shift_ratio"].mean()), 6),
        consecutive_duty_days_max_90d=int(w90["consecutive_duty_days"].max()),
        training_load_trend_90d=round(training_recent - training_base, 6),
        days_since_incident=int(last["days_since_incident"]),
    )


def compute_features_batch(histories: pd.DataFrame) -> pd.DataFrame:
    """Vectorised-by-group version for training. Same code path per person.

    Training calls this rather than reimplementing the windows, which is what
    keeps the two sides identical.
    """
    rows = []
    for user_id, group in histories.groupby("user_id", sort=False):
        features = compute_features(group)
        rows.append({"user_id": user_id, **features.model_dump()})
    return pd.DataFrame(rows).set_index("user_id")[list(FEATURE_ORDER)]
