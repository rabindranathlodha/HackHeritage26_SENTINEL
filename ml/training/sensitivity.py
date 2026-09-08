"""How much do the conclusions depend on the numbers nobody verified?

The synthetic generator's distributional constants are marked [ASSUMPTION]:
plausible working values for CAPF operational patterns, not figures checked
against a primary source. Verifying them needs documents this project does not
have. What can be done instead is to measure how much the conclusions move when
the assumptions are wrong, which turns "unverified" into "unverified, and
bounded by this much".

Each draw perturbs EVERY calibration constant at once, multiplicatively, and
re-runs the whole pipeline: generate a population, engineer features through the
shared module, train Model A out-of-fold, and re-measure. Perturbing one
constant at a time would understate the risk — the worry is not that a single
number is wrong, it is that the whole calibration is off in some direction.

The claims under test are the ones the project actually makes:

  1. The model ranks people usefully (ROC-AUC on elevated-or-above).
  2. A tree beats a linear model, which is what justifies XGBoost at all.
  3. No single feature is near-diagnostic, i.e. the task is genuinely
     multivariate rather than one column in disguise.

A claim that survives the sweep is one an unverified constant cannot take away.
"""

from __future__ import annotations

import argparse
import json
import os
from dataclasses import fields, replace
from datetime import UTC, datetime

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import f1_score, roc_auc_score
from sklearn.model_selection import StratifiedKFold
from sklearn.preprocessing import StandardScaler
from sklearn.utils.class_weight import compute_sample_weight

from app.config import BAND_MIDPOINTS, BANDS_ORDERED, band_for_score
from app.services.feature_pipeline import FEATURE_ORDER, compute_features_batch
from data_gen.generate_synthetic import (
    DEFAULT_CALIBRATION,
    Calibration,
    GenConfig,
    assign_latent_risk,
    generate_daily_signals,
    generate_population,
)

CLASS_INDEX = {band: i for i, band in enumerate(BANDS_ORDERED)}
PRIORITY = CLASS_INDEX["PRIORITY_REVIEW"]
ELEVATED = CLASS_INDEX["ELEVATED"]


def perturb(cal: Calibration, rng: np.random.Generator, spread: float) -> Calibration:
    """Multiply every constant by an independent draw from U(1-spread, 1+spread).

    Independent rather than a single shared factor: a common factor would mostly
    rescale the latent risk, which the quantile band cuts absorb, and the sweep
    would look far more reassuring than it should.
    """
    factors = {
        field.name: float(rng.uniform(1.0 - spread, 1.0 + spread))
        for field in fields(cal)
    }
    return replace(cal, **{name: getattr(cal, name) * f for name, f in factors.items()})


def build_dataset(cfg: GenConfig, cal: Calibration, seed: int):
    """Generate a population under this calibration and engineer its features."""
    rng = np.random.default_rng(seed)
    persons = generate_population(cfg, rng, cal)
    daily = generate_daily_signals(cfg, persons, rng)
    labelled = assign_latent_risk(persons, daily, rng, cal)

    X = compute_features_batch(daily)[list(FEATURE_ORDER)]
    ids = np.asarray(X.index, dtype=object)
    y = np.asarray(
        labelled.set_index("user_id").loc[ids, "risk_band"].map(CLASS_INDEX), dtype=int
    )
    return X, y


def severity(proba: np.ndarray) -> np.ndarray:
    """Expected severity, the same rule the serving path scores with."""
    midpoints = np.array([BAND_MIDPOINTS[band] for band in BANDS_ORDERED])
    return proba @ midpoints


def out_of_fold(X: pd.DataFrame, y: np.ndarray, folds: int, seed: int):
    """Out-of-fold probabilities from the tree, and from a linear baseline."""
    tree = np.zeros((len(y), len(BANDS_ORDERED)))
    linear = np.zeros(len(y))
    splitter = StratifiedKFold(n_splits=folds, shuffle=True, random_state=seed)
    for train_idx, test_idx in splitter.split(X, y):
        X_train, X_test = X.iloc[train_idx], X.iloc[test_idx]
        y_train = y[train_idx]

        booster = xgb.XGBClassifier(
            n_estimators=300, max_depth=4, learning_rate=0.08,
            subsample=0.9, colsample_bytree=0.9, objective="multi:softprob",
            num_class=len(BANDS_ORDERED), tree_method="hist",
            random_state=seed, n_jobs=4,
        )
        booster.fit(X_train, y_train,
                    sample_weight=compute_sample_weight("balanced", y_train))
        tree[test_idx] = booster.predict_proba(X_test)

        # The comparison that justifies a tree at all. Scaled, because an
        # unscaled logistic regression would lose on conditioning rather than
        # on its inability to represent conjunctions.
        scaler = StandardScaler().fit(X_train)
        logistic = LogisticRegression(max_iter=2000, class_weight="balanced")
        logistic.fit(scaler.transform(X_train), (y_train >= ELEVATED).astype(int))
        linear[test_idx] = logistic.predict_proba(scaler.transform(X_test))[:, 1]
    return tree, linear


def measure(X: pd.DataFrame, y: np.ndarray, folds: int, seed: int) -> dict:
    tree_proba, linear_proba = out_of_fold(X, y, folds, seed)
    actual = y >= ELEVATED
    scores = severity(tree_proba)

    predicted = np.array([CLASS_INDEX[band_for_score(s).value] for s in scores])
    flagged = predicted >= ELEVATED
    true_priority = y == PRIORITY

    tree_auc = float(roc_auc_score(actual, scores))
    linear_auc = float(roc_auc_score(actual, linear_proba))

    # "No single feature is near-diagnostic": the best any one column can do.
    single = max(
        max(roc_auc_score(actual, X[c]), roc_auc_score(actual, -X[c]))
        for c in X.columns
    )

    return {
        "roc_auc_elevated_plus": round(tree_auc, 4),
        "linear_roc_auc": round(linear_auc, 4),
        "tree_minus_linear": round(tree_auc - linear_auc, 4),
        "best_single_feature_auc": round(float(single), 4),
        "macro_f1": round(float(f1_score(y, predicted, average="macro")), 4),
        "miss_rate": round(float(1.0 - (actual & flagged).sum() / actual.sum()), 4),
        # NOT evaluate.py's priority_alert_rate, which counts people predicted
        # into the PRIORITY band. This is the looser "flagged at all", so the
        # two must not share a name or someone will compare them.
        "true_priority_flagged_rate": round(float(flagged[true_priority].mean()), 4),
        "prevalence_elevated_plus": round(float(actual.mean()), 4),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifacts", default=os.environ.get("ARTIFACTS_DIR", "artifacts"))
    parser.add_argument("--draws", type=int, default=12)
    parser.add_argument("--spread", type=float, default=0.25,
                        help="each constant is scaled by U(1-spread, 1+spread)")
    parser.add_argument("--n", type=int, default=3000)
    parser.add_argument("--days", type=int, default=180)
    parser.add_argument("--folds", type=int, default=3)
    parser.add_argument("--seed", type=int, default=20260908)
    parser.add_argument("--report", default="sensitivity_report.json")
    args = parser.parse_args()

    cfg = GenConfig(n=args.n, days=args.days)
    rng = np.random.default_rng(args.seed)

    print(f"baseline: default calibration, n={args.n}, {args.folds}-fold out-of-fold")
    X, y = build_dataset(cfg, DEFAULT_CALIBRATION, cfg.seed)
    baseline = measure(X, y, args.folds, args.seed)
    for key, value in baseline.items():
        print(f"  {key:26} {value}")

    print(f"\n{args.draws} draws, every constant scaled by "
          f"U({1 - args.spread:.2f}, {1 + args.spread:.2f})")
    header = (f"{'draw':>5}{'auc':>8}{'linear':>8}{'tree-lin':>10}"
              f"{'best-1f':>9}{'macro-F1':>10}{'miss':>8}{'pri-flag':>11}")
    print(header)
    print(f"{baseline['roc_auc_elevated_plus']:>13.4f}"
          f"{baseline['linear_roc_auc']:>8.4f}{baseline['tree_minus_linear']:>10.4f}"
          f"{baseline['best_single_feature_auc']:>9.4f}{baseline['macro_f1']:>10.4f}"
          f"{baseline['miss_rate']:>8.4f}"
          f"{baseline['true_priority_flagged_rate']:>11.4f}"
          "   <- baseline")

    draws = []
    for i in range(args.draws):
        cal = perturb(DEFAULT_CALIBRATION, rng, args.spread)
        # A distinct seed per draw, so the spread reflects the calibration and
        # the sampling noise that comes with it, not one lucky population.
        X, y = build_dataset(cfg, cal, cfg.seed + 1 + i)
        row = measure(X, y, args.folds, args.seed)
        row["draw"] = i
        draws.append(row)
        print(f"{i:>5}{row['roc_auc_elevated_plus']:>8.4f}{row['linear_roc_auc']:>8.4f}"
              f"{row['tree_minus_linear']:>10.4f}{row['best_single_feature_auc']:>9.4f}"
              f"{row['macro_f1']:>10.4f}{row['miss_rate']:>8.4f}"
              f"{row['true_priority_flagged_rate']:>11.4f}")

    frame = pd.DataFrame(draws)
    metrics = [c for c in frame.columns if c != "draw"]
    spread_summary = {
        metric: {
            "min": round(float(frame[metric].min()), 4),
            "median": round(float(frame[metric].median()), 4),
            "max": round(float(frame[metric].max()), 4),
            "baseline": baseline[metric],
        }
        for metric in metrics
    }

    conclusions = {
        "model_ranks_usefully": {
            "test": "roc_auc_elevated_plus > 0.85 in every draw",
            "holds": bool((frame["roc_auc_elevated_plus"] > 0.85).all()),
            "worst": round(float(frame["roc_auc_elevated_plus"].min()), 4),
        },
        "tree_beats_linear": {
            "test": "tree_minus_linear > 0 in every draw",
            "holds": bool((frame["tree_minus_linear"] > 0).all()),
            "worst": round(float(frame["tree_minus_linear"].min()), 4),
        },
        "no_single_feature_is_near_diagnostic": {
            "test": "best_single_feature_auc < 0.85 in every draw",
            "holds": bool((frame["best_single_feature_auc"] < 0.85).all()),
            "worst": round(float(frame["best_single_feature_auc"].max()), 4),
        },
    }

    print("\n" + "=" * 78)
    print("DOES THE CONCLUSION SURVIVE THE ASSUMPTIONS BEING WRONG?")
    print("=" * 78)
    for name, row in conclusions.items():
        print(f"{'HOLDS' if row['holds'] else 'FAILS':>6}  {name}")
        print(f"        {row['test']}  (worst draw: {row['worst']})")

    report = {
        "generated_at": datetime.now(UTC).isoformat(),
        "method": (
            f"{args.draws} draws, every calibration constant scaled independently "
            f"by U({1 - args.spread:.2f}, {1 + args.spread:.2f}); full regeneration "
            f"and {args.folds}-fold out-of-fold training per draw"
        ),
        "n_people": args.n,
        "spread": args.spread,
        "baseline": baseline,
        "draws": draws,
        "range_across_draws": spread_summary,
        "conclusions": conclusions,
        "caveat": (
            "This bounds the effect of the assumed constants being wrong. It is "
            "not evidence that they are right, and it says nothing about whether "
            "the generator's STRUCTURE resembles real CAPF data."
        ),
        "not_the_shipped_pipeline": (
            "Model A here is a bare XGBoost fit: no isotonic calibrator and no "
            "top-band trigger, so it can be retrained 13 times in one run. The "
            "absolute figures therefore differ from training/evaluate.py's and "
            "should not be quoted as the model's performance. What transfers is "
            "the spread across draws, which is what this measures."
        ),
    }
    path = os.path.join(args.artifacts, args.report)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2)
    print(f"\nsaved -> {path}")


if __name__ == "__main__":
    main()
