"""Train Model A — structured behavioural risk (spec 7.1)."""

from __future__ import annotations

import argparse
import json
import os
from datetime import UTC, datetime

import joblib
import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.calibration import CalibratedClassifierCV
from sklearn.metrics import (
    classification_report,
    confusion_matrix,
    f1_score,
    roc_auc_score,
)
from sklearn.model_selection import train_test_split
from sklearn.utils.class_weight import compute_sample_weight

from app.config import (
    BAND_MIDPOINTS,
    BANDS_ORDERED,
    TOP_BAND_TRIGGER_TAU,
    apply_top_band_trigger,
    band_for_score,
)
from app.services.feature_pipeline import FEATURE_ORDER, compute_features_batch

MODEL_FILE = "model_a.json"
CALIBRATOR_FILE = "model_a_calibrator.joblib"
META_FILE = "model_a_meta.json"


def load_training_frame(artifacts: str) -> tuple[pd.DataFrame, pd.Series, pd.DataFrame]:
    """Build the feature matrix through the SHARED pipeline, plus labels."""
    snapshot_path = os.path.join(artifacts, "synthetic_snapshot.parquet")
    persons_path = os.path.join(artifacts, "synthetic_persons.parquet")
    for path in (snapshot_path, persons_path):
        if not os.path.exists(path):
            raise SystemExit(
                f"missing {path}; run `python -m data_gen.generate_synthetic` first"
            )

    snapshot = pd.read_parquet(snapshot_path)
    persons = pd.read_parquet(persons_path).set_index("user_id")

    print(f"engineering features for {snapshot['user_id'].nunique()} people "
          "through the shared pipeline...")
    X = compute_features_batch(snapshot)

    y = persons.loc[X.index, "risk_band"]
    # Cohort attributes are carried through for the bias audit at step 3.10.
    cohorts = persons.loc[X.index, ["unit_id", "scenario", "tenure_years",
                                    "remote_hazardous", "biometric_consent"]]
    return X, y, cohorts


def main() -> None:
    parser = argparse.ArgumentParser(description="Train Model A.")
    parser.add_argument("--artifacts", default=os.environ.get("ARTIFACTS_DIR", "artifacts"))
    parser.add_argument("--seed", type=int, default=20260907)
    args = parser.parse_args()

    X, y_labels, cohorts = load_training_frame(args.artifacts)
    X = X[list(FEATURE_ORDER)]  # fix column order; asserted again at load time

    # Parquet hands back Arrow-backed columns and index; convert to numpy-backed
    # so sklearn's positional indexing and XGBoost both behave.
    ids = np.asarray(X.index, dtype=object)
    X = X.astype("float64").reset_index(drop=True)

    class_index = {band: i for i, band in enumerate(BANDS_ORDERED)}
    y = np.asarray(y_labels.map(class_index), dtype=int)

    # 70/15/15, stratified by band so the rare classes survive the split.
    X_train, X_hold, y_train, y_hold, idx_train, idx_hold = train_test_split(
        X, y, ids, test_size=0.30, random_state=args.seed, stratify=y
    )
    X_val, X_test, y_val, y_test, idx_val, idx_test = train_test_split(
        X_hold, y_hold, idx_hold, test_size=0.50, random_state=args.seed, stratify=y_hold
    )
    print(f"split: train={len(X_train)}  val={len(X_val)}  test={len(X_test)}")

    # Class weights rather than resampling: resampling would distort the
    # calibration we are about to fit.
    sample_weight = compute_sample_weight(class_weight="balanced", y=y_train)

    booster = xgb.XGBClassifier(
        objective="multi:softprob",
        num_class=len(BANDS_ORDERED),
        n_estimators=400,
        max_depth=5,
        learning_rate=0.06,
        subsample=0.85,
        colsample_bytree=0.85,
        min_child_weight=3,
        reg_lambda=1.5,
        random_state=args.seed,
        eval_metric="mlogloss",
        early_stopping_rounds=40,
    )
    booster.fit(
        X_train, y_train,
        sample_weight=sample_weight,
        eval_set=[(X_val, y_val)],
        verbose=False,
    )
    print(f"trees used: {booster.best_iteration + 1}")

    # Calibrate on the validation split, with the booster frozen. Fitting the
    # calibrator on training data would calibrate against the model's own
    # overfit and make the band thresholds meaningless.
    calibrator = _fit_calibrator(booster, X_val, y_val)

    # Report the threshold rule, not argmax: serving never takes the argmax
    # class, so evaluating argmax would describe a rule nobody runs.
    proba_test = calibrator.predict_proba(X_test)
    severity_test = _severity_score(proba_test)
    # The shipped rule includes the top-band trigger (config.TOP_BAND_TRIGGER_TAU),
    # which corrects the expected value's regression toward the middle. Reporting
    # without it would describe a rule the service does not use.
    priority_column = BANDS_ORDERED.index("PRIORITY_REVIEW")
    severity_test = np.array([
        apply_top_band_trigger(s, float(proba_test[i, priority_column]))[0]
        for i, s in enumerate(severity_test)
    ])
    pred_threshold = np.array(
        [class_index[band_for_score(s * 100.0).value] for s in severity_test]
    )
    pred_argmax = proba_test.argmax(axis=1)

    print()
    print("=" * 70)
    print("TEST-SET PERFORMANCE — severity-threshold rule (the one that ships)")
    print("Per class, because accuracy alone is meaningless at this prevalence:")
    print("a model predicting LOW for everyone would score ~70%.")
    print("=" * 70)
    print(classification_report(
        y_test, pred_threshold, target_names=list(BANDS_ORDERED),
        digits=3, zero_division=0,
    ))

    macro_f1 = f1_score(y_test, pred_threshold, average="macro")
    macro_f1_argmax = f1_score(y_test, pred_argmax, average="macro")
    print(f"macro-F1 (threshold rule, shipped): {macro_f1:.4f}")
    print(f"macro-F1 (argmax, not shipped):     {macro_f1_argmax:.4f}")

    # The operational question is "who needs a human to look?", so measure that
    # separation directly rather than reading it off the 4-class numbers.
    elevated_plus = np.isin(
        y_test, [class_index["ELEVATED"], class_index["PRIORITY_REVIEW"]]
    )
    auc_elevated = roc_auc_score(elevated_plus, severity_test)
    print(f"ROC-AUC (ELEVATED+ vs rest, on the severity score): {auc_elevated:.4f}")

    print()
    print("confusion matrix (rows = true, cols = predicted)")
    cm = confusion_matrix(y_test, pred_threshold)
    header = "".join(f"{b[:8]:>10}" for b in BANDS_ORDERED)
    print(f"{'':>18}{header}")
    for i, band in enumerate(BANDS_ORDERED):
        print(f"{band:>18}" + "".join(f"{v:>10}" for v in cm[i]))

    print()
    print("reliability of P(ELEVATED+): predicted vs observed")
    p_elevated = (
        proba_test[:, class_index["ELEVATED"]]
        + proba_test[:, class_index["PRIORITY_REVIEW"]]
    )
    _print_reliability(p_elevated, elevated_plus)

    # --- Persist ---------------------------------------------------------
    os.makedirs(args.artifacts, exist_ok=True)
    booster.get_booster().save_model(os.path.join(args.artifacts, MODEL_FILE))
    joblib.dump(calibrator, os.path.join(args.artifacts, CALIBRATOR_FILE))

    meta = {
        "trained_at": datetime.now(UTC).isoformat(),
        "seed": args.seed,
        # The serving path asserts this matches its own FEATURE_ORDER, so a
        # pipeline change that is not retrained fails loudly instead of scoring
        # the wrong columns.
        "feature_order": list(FEATURE_ORDER),
        "classes": list(BANDS_ORDERED),
        "band_midpoints": {b: BAND_MIDPOINTS[b] for b in BANDS_ORDERED},
        "best_iteration": int(booster.best_iteration),
        "n_train": len(X_train),
        "n_val": len(X_val),
        "n_test": len(X_test),
        "decision_rule": ("severity score cut at the spec 7.4 band thresholds, "
                          f"with the top-band trigger at tau={TOP_BAND_TRIGGER_TAU}"),
        "metrics": {
            "macro_f1": float(macro_f1),
            "macro_f1_argmax_not_shipped": float(macro_f1_argmax),
            "roc_auc_elevated_plus": float(auc_elevated),
            "per_class": classification_report(
                y_test, pred_threshold, target_names=list(BANDS_ORDERED),
                output_dict=True, zero_division=0,
            ),
            "confusion_matrix": cm.tolist(),
        },
    }
    with open(os.path.join(args.artifacts, META_FILE), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, indent=2)

    # The test split's ids are saved so step 3.10's bias audit evaluates on data
    # the model never saw.
    predictions = pd.DataFrame(
        {"user_id": idx_test, "y_true": y_test, "y_pred": pred_threshold,
         "severity": severity_test, "p_elevated_plus": p_elevated}
    ).join(cohorts.loc[idx_test].reset_index(drop=True))
    predictions.to_parquet(
        os.path.join(args.artifacts, "model_a_test_predictions.parquet"), index=False
    )

    print(f"\nsaved -> {args.artifacts}/{MODEL_FILE}, {CALIBRATOR_FILE}, {META_FILE}")


def _fit_calibrator(booster, X_val, y_val):
    """Calibrate a fitted estimator without refitting it.

    sklearn 1.6 replaced `cv="prefit"` with `FrozenEstimator`; support both so
    the script does not break on a version bump.
    """
    try:
        from sklearn.frozen import FrozenEstimator

        calibrator = CalibratedClassifierCV(FrozenEstimator(booster), method="isotonic")
    except ImportError:  # sklearn < 1.6
        calibrator = CalibratedClassifierCV(booster, method="isotonic", cv="prefit")
    calibrator.fit(X_val, y_val)
    return calibrator


def _severity_score(proba: np.ndarray) -> np.ndarray:
    """Expected severity on the 0-1 scale.

    The probability mass over four ordinal bands is collapsed onto one number by
    weighting each band by its midpoint on the spec 7.4 scale. This keeps the
    output ordinal and calibrated rather than reducing it to "probability of the
    top class", which would throw away the distinction between a confident
    MODERATE and a borderline ELEVATED.
    """
    midpoints = np.array([BAND_MIDPOINTS[b] for b in BANDS_ORDERED]) / 100.0
    return proba @ midpoints


def _print_reliability(predicted: np.ndarray, actual: np.ndarray, bins: int = 5) -> None:
    """Compare a predicted probability against the observed rate, like for like.

    Bucketing by quantile rather than fixed width, because the distribution is
    heavily skewed toward zero and fixed-width bins would be nearly empty at the
    top — which is the end that matters.
    """
    edges = np.quantile(predicted, np.linspace(0, 1, bins + 1))
    for i in range(bins):
        lo, hi = edges[i], edges[i + 1]
        mask = (predicted >= lo) & (predicted <= hi if i == bins - 1 else predicted < hi)
        if mask.sum() == 0:
            continue
        print(f"  P(elevated+) {lo:.3f}-{hi:.3f}  n={mask.sum():>4}  "
              f"predicted~{predicted[mask].mean():.3f}  "
              f"observed={actual[mask].mean():.3f}")


if __name__ == "__main__":
    main()
