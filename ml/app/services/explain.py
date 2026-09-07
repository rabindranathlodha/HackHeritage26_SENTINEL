"""SHAP -> category aggregation (spec 7.1 / 5.1)."""

from __future__ import annotations

from app.schemas.structured import ShapCategories

# Every one of the 12 features maps to exactly one category. Asserted below.
FEATURE_CATEGORIES: dict[str, tuple[str, ...]] = {
    "deployment_load": (
        "deployment_days",
        "days_since_home_posting",
        "remote_hazardous",
    ),
    "leave_pattern": (
        "leave_deviation_30d",
        "leave_deviation_90d",
        "leave_denied_count_90d",
    ),
    "duty_irregularity": (
        "shift_irregularity_90d",
        "night_shift_ratio_90d",
        "consecutive_duty_days_max_90d",
    ),
    "transfer_frequency": ("transfers_12mo",),
    "training_load": ("training_load_trend_90d",),
    "incident_proximity": ("days_since_incident",),
}

_FEATURE_TO_CATEGORY = {
    feature: category
    for category, features in FEATURE_CATEGORIES.items()
    for feature in features
}


def aggregate_shap(feature_shap: dict[str, float]) -> ShapCategories:
    """Sum absolute feature contributions into categories, then normalise.

    Absolute values: the question the officer is answering is "what is driving
    this", not "which direction did each feature push". Normalising to a share
    of total attribution keeps the six numbers comparable across people.
    """
    totals = dict.fromkeys(FEATURE_CATEGORIES, 0.0)
    for feature, value in feature_shap.items():
        category = _FEATURE_TO_CATEGORY.get(feature)
        if category is None:
            raise KeyError(f"feature {feature!r} has no category mapping")
        totals[category] += abs(float(value))

    grand_total = sum(totals.values())
    if grand_total > 0:
        totals = {k: round(v / grand_total, 6) for k, v in totals.items()}

    return ShapCategories(**totals)
