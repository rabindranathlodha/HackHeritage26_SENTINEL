"""Evaluation suite — bias audit and precision-recall curve (spec 3.10, 12)."""

from __future__ import annotations

import argparse
import json
import os
from datetime import UTC, datetime

import matplotlib

matplotlib.use("Agg")  # no display in the container

import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import xgboost as xgb  # noqa: E402
from sklearn.calibration import CalibratedClassifierCV  # noqa: E402
from sklearn.metrics import (  # noqa: E402
    average_precision_score,
    classification_report,
    f1_score,
    precision_recall_curve,
    roc_auc_score,
)
from sklearn.model_selection import StratifiedKFold, train_test_split  # noqa: E402
from sklearn.utils.class_weight import compute_sample_weight  # noqa: E402

from app.config import (  # noqa: E402
    BAND_MIDPOINTS,
    BANDS_ORDERED,
    TOP_BAND_TRIGGER_TAU,
    apply_top_band_trigger,
    band_for_score,
)
from app.services.feature_pipeline import (  # noqa: E402
    FEATURE_ORDER,
    compute_features_batch,
)

CLASS_INDEX = {band: i for i, band in enumerate(BANDS_ORDERED)}
ELEVATED_PLUS = [CLASS_INDEX["ELEVATED"], CLASS_INDEX["PRIORITY_REVIEW"]]
MIDPOINTS = np.array([BAND_MIDPOINTS[b] for b in BANDS_ORDERED]) / 100.0


def load_data(artifacts: str) -> tuple[pd.DataFrame, np.ndarray, pd.DataFrame]:
    snapshot_path = os.path.join(artifacts, "synthetic_snapshot.parquet")
    persons_path = os.path.join(artifacts, "synthetic_persons.parquet")
    for path in (snapshot_path, persons_path):
        if not os.path.exists(path):
            raise SystemExit(f"missing {path}; run data_gen.generate_synthetic first")

    snapshot = pd.read_parquet(snapshot_path)
    persons = pd.read_parquet(persons_path).set_index("user_id")

    print(f"engineering features for {snapshot['user_id'].nunique()} people "
          "through the shared pipeline...")
    X = compute_features_batch(snapshot)[list(FEATURE_ORDER)]

    ids = np.asarray(X.index, dtype=object)
    y = np.asarray(persons.loc[ids, "risk_band"].map(CLASS_INDEX), dtype=int)

    cohorts = persons.loc[ids, ["unit_id", "scenario", "tenure_years",
                                "remote_hazardous", "biometric_consent"]].copy()
    cohorts = cohorts.reset_index(drop=True)
    cohorts["posting_type"] = np.where(
        cohorts["remote_hazardous"], "remote_hazardous", "standard"
    )
    cohorts["tenure_band"] = pd.cut(
        cohorts["tenure_years"].astype(float),
        bins=[0, 5, 12, 100],
        labels=["under_5y", "5_to_12y", "over_12y"],
    ).astype(str)
    cohorts["user_id"] = ids

    return X.astype("float64").reset_index(drop=True), y, cohorts


def out_of_fold_predictions(X: pd.DataFrame, y: np.ndarray, folds: int, seed: int):
    """Every person scored by a model that never saw them."""
    severity = np.zeros(len(y))
    proba = np.zeros((len(y), len(BANDS_ORDERED)))

    splitter = StratifiedKFold(n_splits=folds, shuffle=True, random_state=seed)
    for fold, (train_idx, test_idx) in enumerate(splitter.split(X, y), 1):
        # Hold a calibration slice out of the TRAINING part, never the fold's
        # test part — calibrating on data the fold is scored against would leak.
        fit_idx, cal_idx = train_test_split(
            train_idx, test_size=0.2, random_state=seed, stratify=y[train_idx]
        )
        model = xgb.XGBClassifier(
            objective="multi:softprob", num_class=len(BANDS_ORDERED),
            n_estimators=300, max_depth=5, learning_rate=0.06,
            subsample=0.85, colsample_bytree=0.85, min_child_weight=3,
            reg_lambda=1.5, random_state=seed, eval_metric="mlogloss",
        )
        model.fit(
            X.iloc[fit_idx], y[fit_idx],
            sample_weight=compute_sample_weight("balanced", y[fit_idx]),
            verbose=False,
        )
        calibrator = _fit_calibrator(model, X.iloc[cal_idx], y[cal_idx])
        fold_proba = calibrator.predict_proba(X.iloc[test_idx])
        proba[test_idx] = fold_proba
        severity[test_idx] = fold_proba @ MIDPOINTS
        print(f"  fold {fold}/{folds} done", end="\r")
    print()

    # The shipped decision rule, in full: apply the top-band trigger, then cut
    # the severity at the spec 7.4 thresholds. Auditing anything else would mean
    # these numbers describe a system nobody runs.
    priority_column = BANDS_ORDERED.index("PRIORITY_REVIEW")
    triggered = np.array([
        apply_top_band_trigger(s, float(proba[i, priority_column]))[0]
        for i, s in enumerate(severity)
    ])
    predicted = np.array(
        [CLASS_INDEX[band_for_score(s * 100.0).value] for s in triggered]
    )
    # `severity` is the pre-trigger value; the evidence table needs it to show
    # what the trigger is actually buying.
    return predicted, triggered, proba, severity


def _fit_calibrator(estimator, X_cal, y_cal):
    try:
        from sklearn.frozen import FrozenEstimator

        calibrator = CalibratedClassifierCV(FrozenEstimator(estimator), method="isotonic")
    except ImportError:
        calibrator = CalibratedClassifierCV(estimator, method="isotonic", cv="prefit")
    calibrator.fit(X_cal, y_cal)
    return calibrator


def _bootstrap_ci(
    numerator: np.ndarray, denominator: np.ndarray,
    rng: np.random.Generator, iterations: int = 2000,
) -> tuple[float, float] | None:
    """Percentile CI for mean(numerator) restricted to denominator == True.

    Resamples PEOPLE rather than events, which is the unit that actually varies.
    """
    n = len(denominator)
    if n == 0 or denominator.sum() == 0:
        return None
    draws = []
    for _ in range(iterations):
        idx = rng.integers(0, n, n)
        keep = denominator[idx]
        if keep.sum() == 0:
            continue
        draws.append(numerator[idx][keep].mean())
    if not draws:
        return None
    return (
        round(float(np.percentile(draws, 2.5)), 4),
        round(float(np.percentile(draws, 97.5)), 4),
    )


def cohort_rates(
    mask: np.ndarray, y: np.ndarray, predicted: np.ndarray,
    rng: np.random.Generator | None = None,
) -> dict:
    """Rates for one cohort, framed around who gets missed.

    Every rate carries a bootstrap 95% interval. Without one, a cohort holding
    58 positive cases yields a recall point estimate with roughly +/-0.13 of
    slack, and reading a "disparity" off two such numbers is how an audit
    invents findings the data cannot support. That is not hypothetical: the
    first run of this audit reported a tenure gap that sat inside the interval.
    """
    y_c, p_c = y[mask], predicted[mask]
    actual = np.isin(y_c, ELEVATED_PLUS)
    flagged = np.isin(p_c, ELEVATED_PLUS)

    tp = int((actual & flagged).sum())
    fp = int((~actual & flagged).sum())
    fn = int((actual & ~flagged).sum())
    tn = int((~actual & ~flagged).sum())

    # Escalation fires on a predicted PRIORITY_REVIEW band (spec 8), so this is
    # the number that decides whether a person in real trouble is seen.
    true_priority = y_c == CLASS_INDEX["PRIORITY_REVIEW"]
    alerted = p_c == CLASS_INDEX["PRIORITY_REVIEW"]

    rng = rng or np.random.default_rng(0)
    missed = actual & ~flagged
    false_alarm = ~actual & flagged

    return {
        "n": int(mask.sum()),
        "n_positives": int(actual.sum()),
        "recall_ci95": _bootstrap_ci(actual & flagged, actual, rng),
        "miss_rate_ci95": _bootstrap_ci(missed, actual, rng),
        "false_positive_rate_ci95": _bootstrap_ci(false_alarm, ~actual, rng),
        "prevalence_elevated_plus": round(float(actual.mean()), 4),
        "precision": round(tp / (tp + fp), 4) if (tp + fp) else None,
        "recall": round(tp / (tp + fn), 4) if (tp + fn) else None,
        # The runaway-false-positive check spec 12 asks for.
        "false_positive_rate": round(fp / (fp + tn), 4) if (fp + tn) else None,
        "miss_rate": round(fn / (tp + fn), 4) if (tp + fn) else None,
        "n_true_priority": int(true_priority.sum()),
        "priority_alert_rate": (
            round(float(alerted[true_priority].mean()), 4)
            if true_priority.sum() else None
        ),
        "flag_rate": round(float(flagged.mean()), 4),
    }


def audit(cohorts: pd.DataFrame, y, predicted, dimension: str, min_n: int) -> dict:
    rng = np.random.default_rng(20260907)
    groups = {}
    for value in sorted(cohorts[dimension].dropna().unique()):
        mask = (cohorts[dimension] == value).to_numpy()
        if mask.sum() < min_n:
            groups[str(value)] = {
                "n": int(mask.sum()),
                "suppressed": True,
                "reason": f"cohort below min_cohort={min_n}; a rate here would be noise",
            }
            continue
        groups[str(value)] = cohort_rates(mask, y, predicted, rng)
    return groups


# A rate computed over a handful of positive cases is noise, not a finding.
# Unit cohorts average ~75 people at ~10% prevalence, so roughly 8 positives —
# nowhere near enough to call a miss rate a fairness problem.
MIN_POSITIVES_FOR_RATE = 20

# The overall false-positive rate is ~0.011, so a bare "twice the overall" rule
# fires on a difference of one or two people. A cohort needs to clear an
# ABSOLUTE bar as well before it is worth anyone's attention.
MIN_ABSOLUTE_FPR = 0.05


def print_audit(title: str, groups: dict, overall_fpr: float,
                overall_miss: float) -> list[str]:
    print(f"\n--- {title} ---")
    header = (f"{'cohort':<22}{'n':>6}{'prev':>7}{'prec':>7}{'recall':>7}"
              f"{'recall 95% CI':>16}{'FPR':>7}{'miss':>7}{'alert@PRI':>10}")
    print(header)
    warnings = []
    for name, g in groups.items():
        if g.get("suppressed"):
            print(f"{name:<22}{g['n']:>6}   suppressed (below min cohort size)")
            continue
        fmt = lambda v: f"{v:>7.3f}" if v is not None else f"{'-':>7}"  # noqa: E731
        alert = (f"{g['priority_alert_rate']:>10.3f}"
                 if g["priority_alert_rate"] is not None else f"{'-':>10}")
        ci = g["recall_ci95"]
        ci_text = f"{ci[0]:.3f}-{ci[1]:.3f}" if ci else "-"
        print(f"{name:<22}{g['n']:>6}{g['prevalence_elevated_plus']:>7.3f}"
              f"{fmt(g['precision'])}{fmt(g['recall'])}{ci_text:>16}"
              f"{fmt(g['false_positive_rate'])}{fmt(g['miss_rate'])}{alert}")

        underpowered = g["n_positives"] < MIN_POSITIVES_FOR_RATE

        # A cohort is flagged only when its 95% interval EXCLUDES the overall
        # rate. Comparing point estimates alone manufactures disparities out of
        # sampling noise, which is precisely what the first version of this
        # audit did.
        fpr, fpr_ci = g["false_positive_rate"], g["false_positive_rate_ci95"]
        if (
            fpr is not None
            and fpr_ci is not None
            and overall_fpr > 0
            and fpr_ci[0] > 2.0 * overall_fpr
            and fpr_ci[0] >= MIN_ABSOLUTE_FPR
        ):
            warnings.append(
                f"{title}/{name}: false-positive rate {fpr:.3f} "
                f"(95% CI {fpr_ci[0]:.3f}-{fpr_ci[1]:.3f}) is separated from the overall "
                f"{overall_fpr:.3f} and clears the {MIN_ABSOLUTE_FPR} absolute bar"
            )

        miss, miss_ci = g["miss_rate"], g["miss_rate_ci95"]
        if (
            miss is not None
            and miss_ci is not None
            and not underpowered
            and miss_ci[0] > overall_miss
        ):
            warnings.append(
                f"{title}/{name}: miss rate {miss:.3f} "
                f"(95% CI {miss_ci[0]:.3f}-{miss_ci[1]:.3f}) is worse than the overall "
                f"{overall_miss:.3f} by more than sampling noise, over "
                f"{g['n_positives']} elevated cases"
            )
    return warnings


def main() -> None:
    parser = argparse.ArgumentParser(description="Bias audit and PR curve.")
    parser.add_argument("--artifacts", default=os.environ.get("ARTIFACTS_DIR", "artifacts"))
    parser.add_argument("--folds", type=int, default=5)
    parser.add_argument("--seed", type=int, default=20260907)
    parser.add_argument("--min-cohort", type=int, default=40,
                        help="cohorts smaller than this are suppressed, not reported")
    args = parser.parse_args()

    X, y, cohorts = load_data(args.artifacts)
    print(f"{args.folds}-fold out-of-fold predictions over {len(y)} people")
    predicted, severity, _proba, untriggered_severity = out_of_fold_predictions(
        X, y, args.folds, args.seed
    )

    # --- Overall -----------------------------------------------------------
    print("\n" + "=" * 78)
    print("OVERALL (out-of-fold, severity-threshold rule — the one that ships)")
    print("=" * 78)
    print(classification_report(y, predicted, target_names=list(BANDS_ORDERED),
                                digits=3, zero_division=0))
    macro_f1 = f1_score(y, predicted, average="macro")
    actual = np.isin(y, ELEVATED_PLUS)
    auc = roc_auc_score(actual, severity)
    ap = average_precision_score(actual, severity)
    print(f"macro-F1 {macro_f1:.4f}   ROC-AUC {auc:.4f}   average precision {ap:.4f}")

    overall = cohort_rates(np.ones(len(y), dtype=bool), y, predicted,
                           np.random.default_rng(args.seed))
    print(f"\noverall false-positive rate: {overall['false_positive_rate']:.4f}")
    print(f"overall miss rate:           {overall['miss_rate']:.4f}")

    # --- The question that matters most ------------------------------------
    print("\n" + "=" * 78)
    print("WHO DOES THE SYSTEM MISS?")
    print("=" * 78)
    n_priority = overall["n_true_priority"]
    alert_rate = overall["priority_alert_rate"]
    print(f"people whose true band is PRIORITY_REVIEW: {n_priority}")
    print(f"of those, the share that would raise an alert: {alert_rate:.3f}")
    print(f"  -> {round((1 - alert_rate) * n_priority)} people in the highest-risk band")
    print("     would NOT have an alert raised by the band rule alone.")
    print("     Spec 8's sustained-trend rule and spec 7.5's self-report override")
    print("     exist to catch these; neither is exercised by this offline audit,")
    print("     which scores behavioural signals only.")

    # --- Per-cohort audit --------------------------------------------------
    print("\n" + "=" * 78)
    print(f"PER-COHORT AUDIT (cohorts below n={args.min_cohort} suppressed)")
    print("=" * 78)
    dimensions = ["posting_type", "tenure_band", "biometric_consent", "scenario", "unit_id"]
    report_groups, warnings = {}, []
    for dimension in dimensions:
        groups = audit(cohorts, y, predicted, dimension, args.min_cohort)
        report_groups[dimension] = groups
        warnings += print_audit(dimension, groups, overall["false_positive_rate"],
                                overall["miss_rate"])

    print("\n" + "=" * 78)
    if warnings:
        print(f"FAIRNESS WARNINGS ({len(warnings)})")
        for w in warnings:
            print(f"  ! {w}")
    else:
        print("No cohort's interval separates it from the overall rate.")
    print()
    print("Every rate carries a bootstrap 95% interval, and a cohort is flagged only")
    print("when its interval excludes the overall rate. A point-estimate gap between")
    print("two noisy cohorts is not a finding.")
    print()
    print("Unit-level rows are shown for completeness but are UNDERPOWERED: at ~75")
    print("people and ~10% prevalence a unit holds roughly 8 elevated cases.")
    print("=" * 78)

    # Re-derive the tau trade-off every run so the chosen value stays
    # justifiable rather than becoming folklore.
    print()
    print("=" * 78)
    print(f"TOP-BAND TRIGGER — ACTIVE at tau={TOP_BAND_TRIGGER_TAU}")
    print("Numbers above already include it. The table below re-derives the")
    print("trade-off so the chosen tau stays a defensible decision, not a habit.")
    print("=" * 78)
    p_priority = _proba[:, CLASS_INDEX["PRIORITY_REVIEW"]]
    true_priority = y == CLASS_INDEX["PRIORITY_REVIEW"]

    # Re-derive from the UNTRIGGERED baseline. `predicted` already has the
    # trigger applied, so sweeping tau against it would show no change for any
    # tau at or above the active one — a table that silently stops informing
    # the decision it exists to justify.
    base_alert = np.array([
        CLASS_INDEX[band_for_score(sev * 100.0).value] == CLASS_INDEX["PRIORITY_REVIEW"]
        for sev in untriggered_severity
    ])
    active = base_alert | (p_priority >= TOP_BAND_TRIGGER_TAU)

    # Recorded in the report, not only printed. The trigger's justification is a
    # comparison against this baseline, and the comparison has to be made within
    # a single run: both numbers move with the fold count and the seed, but they
    # move together.
    baseline = {
        "alerts": int(base_alert.sum()),
        "true_priority_alerted": round(float(base_alert[true_priority].mean()), 4),
        "non_priority_alerted": int((base_alert & ~true_priority).sum()),
    }
    print(f"without any trigger: {baseline['alerts']} alerts, "
          f"{baseline['true_priority_alerted']:.1%} of true PRIORITY people alerted, "
          f"{baseline['non_priority_alerted']} on people who are not")
    print(f"in force (tau={TOP_BAND_TRIGGER_TAU}): {int(active.sum())} alerts, "
          f"{active[true_priority].mean():.1%} alerted, "
          f"{(active & ~true_priority).sum()} on people who are not")
    print()
    print(f"{'tau':>6}{'alerts':>9}{'true-PRI alerted':>19}{'non-PRI alerted':>18}")
    trigger_rows = []
    for tau in (0.20, 0.30, 0.40, 0.50, 0.60, 0.80):
        triggered = base_alert | (p_priority >= tau)
        row = {
            "tau": tau,
            "alerts": int(triggered.sum()),
            "true_priority_alerted": round(float(triggered[true_priority].mean()), 4),
            "non_priority_alerted": int((triggered & ~true_priority).sum()),
            "in_force": tau == TOP_BAND_TRIGGER_TAU,
        }
        trigger_rows.append(row)
        marker = "  <- in force" if row["in_force"] else ""
        print(f"{tau:>6.2f}{row['alerts']:>9}"
              f"{row['true_priority_alerted']:>18.1%}{row['non_priority_alerted']:>18}"
              f"{marker}")
    print()
    print("Read this as a workload trade: each extra alert is one welfare officer")
    print("conversation. Missing a person in the highest-risk band is the other side.")

    # --- PR curve ----------------------------------------------------------
    precision, recall, thresholds = precision_recall_curve(actual, severity)
    fig, ax = plt.subplots(figsize=(7, 5))
    ax.plot(recall, precision, linewidth=2)
    ax.axhline(actual.mean(), linestyle="--", linewidth=1,
               label=f"prevalence ({actual.mean():.3f})")
    ax.set_xlabel("Recall — share of elevated-risk people surfaced")
    ax.set_ylabel("Precision — share of surfaced people who are elevated-risk")
    ax.set_title(f"Welfare-risk indicator, ELEVATED+ (AP = {ap:.3f})")
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.grid(alpha=0.3)
    ax.legend(loc="upper right")
    fig.tight_layout()
    curve_path = os.path.join(args.artifacts, "pr_curve.png")
    fig.savefig(curve_path, dpi=150)
    plt.close(fig)

    # Operating points, so the threshold is a decision with numbers attached.
    print("\noperating points on the severity score")
    print(f"{'threshold':>10}{'precision':>12}{'recall':>10}{'flagged':>10}")
    for t in (0.26, 0.40, 0.56, 0.70, 0.81):
        flagged = severity >= t
        if flagged.sum() == 0:
            continue
        prec = float((actual & flagged).sum() / flagged.sum())
        rec = float((actual & flagged).sum() / actual.sum())
        print(f"{t:>10.2f}{prec:>12.3f}{rec:>10.3f}{int(flagged.sum()):>10}")

    report = {
        "generated_at": datetime.now(UTC).isoformat(),
        "method": f"{args.folds}-fold out-of-fold, severity-threshold decision rule",
        "n_people": int(len(y)),
        "min_cohort": args.min_cohort,
        "overall": {
            "macro_f1": float(macro_f1),
            "roc_auc_elevated_plus": float(auc),
            "average_precision": float(ap),
            **overall,
        },
        "cohorts": report_groups,
        "fairness_warnings": warnings,
        "top_band_trigger_evidence": {
            "status": f"ACTIVE at tau={TOP_BAND_TRIGGER_TAU}",
            "rationale": (
                "score_a is an expected value over four ordinal bands and so "
                "regresses toward the middle; only a third of true "
                "PRIORITY_REVIEW people cross the 81 threshold."
            ),
            "without_trigger": baseline,
            "options": trigger_rows,
        },
        "pr_curve": curve_path,
    }
    report_path = os.path.join(args.artifacts, "evaluation_report.json")
    with open(report_path, "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2)

    print(f"\nsaved -> {curve_path}")
    print(f"saved -> {report_path}")


if __name__ == "__main__":
    main()
