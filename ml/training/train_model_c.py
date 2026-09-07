"""Train Model C — physiological wellness signal (spec 7.3)."""

from __future__ import annotations

import argparse
import json
import os
from datetime import UTC, datetime

import joblib
import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import GradientBoostingClassifier, IsolationForest
from sklearn.metrics import classification_report, f1_score, roc_auc_score
from sklearn.model_selection import train_test_split

from app.config import BAND_MIDPOINTS, BANDS_ORDERED, band_for_score
from app.services.physio_features import (
    FEATURE_ORDER_C,
    SIGNALS,
    baseline_from_history,
    deviation_features,
)

MODEL_FILE = "model_c.joblib"
META_FILE = "model_c_meta.json"

BASELINE_DAYS = 120  # days 0-119 form the baseline
SCORING_DAYS = 60  # days 120-179 become training observations


def build_training_rows(
    physio: pd.DataFrame, persons: pd.DataFrame, rng: np.random.Generator
) -> tuple[pd.DataFrame, np.ndarray, np.ndarray, dict]:
    """One row per person-day, half personal-baseline and half population."""
    consenting = persons[persons["biometric_consent"]].set_index("user_id")
    physio = physio[physio["user_id"].isin(consenting.index)]

    baseline_part = physio[physio["day_index"] < BASELINE_DAYS]
    scoring_part = physio[physio["day_index"] >= BASELINE_DAYS]

    print(f"consenting people: {consenting.shape[0]}")
    print(f"baseline days 0-{BASELINE_DAYS - 1}, scoring days {BASELINE_DAYS}-179")

    baselines = {
        user_id: baseline_from_history(group)
        for user_id, group in baseline_part.groupby("user_id", sort=False)
    }

    # Population baseline, used both as the fallback at inference time and to
    # generate the fallback-mode training rows.
    population = baseline_from_history(baseline_part)

    del rng  # rows are no longer sampled between two modes

    rows, pop_rows, labels, groups = [], [], [], []
    for row in scoring_part.itertuples(index=False):
        signals = {s: getattr(row, s) for s in SIGNALS}
        rows.append(deviation_features(signals, baselines[row.user_id]))
        # The same day scored against population statistics, kept purely to
        # measure how much worse that path is.
        pop_rows.append(deviation_features(signals, population))
        labels.append(consenting.loc[row.user_id, "risk_band"])
        groups.append(row.user_id)

    X = pd.DataFrame(rows)[list(FEATURE_ORDER_C)]
    X_pop = pd.DataFrame(pop_rows)[list(FEATURE_ORDER_C)]
    return X, np.asarray(labels), np.asarray(groups), {
        "population_baseline": population.__dict__,
        "X_population": X_pop,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Train Model C.")
    parser.add_argument("--artifacts", default=os.environ.get("ARTIFACTS_DIR", "artifacts"))
    parser.add_argument("--seed", type=int, default=20260907)
    args = parser.parse_args()

    physio_path = os.path.join(args.artifacts, "synthetic_physio.parquet")
    persons_path = os.path.join(args.artifacts, "synthetic_persons.parquet")
    for path in (physio_path, persons_path):
        if not os.path.exists(path):
            raise SystemExit(f"missing {path}; run data_gen.generate_synthetic first")

    rng = np.random.default_rng(args.seed)
    physio = pd.read_parquet(physio_path)
    persons = pd.read_parquet(persons_path)

    X, y_labels, groups, extras = build_training_rows(physio, persons, rng)
    X_population = extras["X_population"]
    print(f"training rows: {len(X):,} (one per person-day, personal baseline)")

    class_index = {band: i for i, band in enumerate(BANDS_ORDERED)}
    y = np.asarray([class_index[b] for b in y_labels])

    # Split by PERSON, never by row. Splitting rows would put the same person's
    # days on both sides and leak their baseline into the test set.
    unique_people = np.unique(groups)
    train_people, test_people = train_test_split(
        unique_people, test_size=0.30, random_state=args.seed
    )
    val_people, test_people = train_test_split(
        test_people, test_size=0.50, random_state=args.seed
    )
    is_train = np.isin(groups, train_people)
    is_val = np.isin(groups, val_people)
    is_test = np.isin(groups, test_people)
    print(f"people: train={len(train_people)} val={len(val_people)} test={len(test_people)}")

    X_np = X.to_numpy(dtype=float)

    # Anomaly component (spec 7.3 allows combining). Fitted on the deviation
    # features of the TRAINING people only, so "unusual" means unusual relative
    # to the training population rather than to the test set.
    isolation = IsolationForest(
        n_estimators=200, contamination=0.1, random_state=args.seed
    )
    isolation.fit(X_np[is_train][:, :4])

    def with_anomaly(matrix: np.ndarray) -> np.ndarray:
        score = -isolation.score_samples(matrix[:, :4])  # higher = more anomalous
        return np.column_stack([matrix, score])

    Xa = with_anomaly(X_np)

    classifier = GradientBoostingClassifier(
        n_estimators=250, max_depth=3, learning_rate=0.06,
        subsample=0.85, random_state=args.seed,
    )
    classifier.fit(Xa[is_train], y[is_train])

    calibrator = _fit_calibrator(classifier, Xa[is_val], y[is_val])

    # --- Evaluation ------------------------------------------------------
    proba = calibrator.predict_proba(Xa[is_test])
    midpoints = np.array([BAND_MIDPOINTS[b] for b in BANDS_ORDERED]) / 100.0
    severity = proba @ midpoints
    pred = np.array([class_index[band_for_score(s * 100.0).value] for s in severity])

    print()
    print("=" * 70)
    print("TEST-SET PERFORMANCE — Model C alone, per person-day")
    print("=" * 70)
    print(classification_report(
        y[is_test], pred, target_names=list(BANDS_ORDERED), digits=3, zero_division=0,
        labels=list(range(len(BANDS_ORDERED))),
    ))

    macro_f1 = f1_score(y[is_test], pred, average="macro")
    elevated_plus = np.isin(
        y[is_test], [class_index["ELEVATED"], class_index["PRIORITY_REVIEW"]]
    )
    auc = roc_auc_score(elevated_plus, severity)
    print(f"macro-F1: {macro_f1:.4f}")
    print(f"ROC-AUC (ELEVATED+ vs rest): {auc:.4f}")

    # Spec 6.3 wants a CONTRIBUTING signal, not a giveaway. A physiological
    # AUC near 1.0 here would mean the synthetic data leaks the label through
    # the wearable channel, which would not survive contact with reality.
    if auc > 0.90:
        print("WARNING: physiological signal alone is suspiciously separable "
              "(spec 6.3 wants a contributing signal, not a giveaway)")

    # Score the SAME held-out days against population statistics instead, to
    # quantify what the fallback path would have been worth. This is why the
    # endpoint declines to score without a personal baseline.
    proba_pop = calibrator.predict_proba(with_anomaly(X_population.to_numpy(float))[is_test])
    severity_pop = proba_pop @ midpoints
    auc_pop = roc_auc_score(elevated_plus, severity_pop)

    print()
    print("scoring mode comparison on the same held-out days")
    print(f"  personal baseline    ROC-AUC={auc:.4f}   (spec 7.3 preferred path)")
    print(f"  population fallback  ROC-AUC={auc_pop:.4f}   (not offered at inference)")
    mode_metrics = {
        "personal": {"roc_auc": float(auc), "macro_f1": float(macro_f1)},
        "population_not_offered": {"roc_auc": float(auc_pop)},
    }

    # --- Persist ---------------------------------------------------------
    os.makedirs(args.artifacts, exist_ok=True)
    joblib.dump(
        {"classifier": classifier, "calibrator": calibrator, "isolation": isolation},
        os.path.join(args.artifacts, MODEL_FILE),
    )
    meta = {
        "trained_at": datetime.now(UTC).isoformat(),
        "seed": args.seed,
        "feature_order": list(FEATURE_ORDER_C),
        "classes": list(BANDS_ORDERED),
        "baseline_days": BASELINE_DAYS,
        "scoring_days": SCORING_DAYS,
        "population_baseline": extras["population_baseline"],
        "decision_rule": "severity score cut at the spec 7.4 band thresholds",
        "n_train_rows": int(is_train.sum()),
        "n_test_rows": int(is_test.sum()),
        "n_consenting_people": int(len(unique_people)),
        "metrics": {
            "macro_f1": float(macro_f1),
            "roc_auc_elevated_plus": float(auc),
            "by_mode": mode_metrics,
            "per_class": classification_report(
                y[is_test], pred, target_names=list(BANDS_ORDERED),
                output_dict=True, zero_division=0,
                labels=list(range(len(BANDS_ORDERED))),
            ),
        },
    }
    with open(os.path.join(args.artifacts, META_FILE), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, indent=2)

    print(f"\nsaved -> {args.artifacts}/{MODEL_FILE}, {META_FILE}")


def _fit_calibrator(estimator, X_val, y_val):
    try:
        from sklearn.frozen import FrozenEstimator

        calibrator = CalibratedClassifierCV(FrozenEstimator(estimator), method="isotonic")
    except ImportError:  # sklearn < 1.6
        calibrator = CalibratedClassifierCV(estimator, method="isotonic", cv="prefit")
    calibrator.fit(X_val, y_val)
    return calibrator


if __name__ == "__main__":
    main()
