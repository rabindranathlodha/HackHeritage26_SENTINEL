"""Compare two Model B checkpoints on identical held-out data.

Two macro-F1 numbers from separate training runs are not a comparison — they
are two noisy estimates, and picking the larger one is how a project convinces
itself of an improvement it cannot demonstrate. This scores both models on the
same rows and bootstraps the DIFFERENCE, resampling the same indices for both,
so the paired variance cancels.

It also reports how many inputs each model assigns to the positive class and how
wide its probability range is. That pair catches the failure a macro-F1 alone
can hide: a model that has collapsed to predicting one class still produces a
number, and on a two-class problem with balanced-ish data that number lands
around 0.32 rather than at something obviously broken.

    docker compose exec ml python -m training.compare_model_b \\
      --candidate artifacts/model_b_indicbert_v3 --incumbent artifacts/model_b
"""

from __future__ import annotations

import argparse
import json
import os

import numpy as np
import torch
from sklearn.metrics import f1_score, roc_auc_score
from transformers import AutoModelForSequenceClassification, AutoTokenizer

from training.train_model_b import fetch_dreaddit


def probabilities(model_dir: str, texts: list[str], max_length: int) -> np.ndarray:
    tokenizer = AutoTokenizer.from_pretrained(model_dir)
    model = AutoModelForSequenceClassification.from_pretrained(model_dir)
    model.eval()

    out = []
    with torch.no_grad():
        for start in range(0, len(texts), 16):
            batch = tokenizer(texts[start:start + 16], truncation=True,
                              padding="max_length", max_length=max_length,
                              return_tensors="pt")
            out.append(torch.softmax(model(**batch).logits, dim=-1)[:, 1])
    # .float() because Gemma-3 checkpoints load in bfloat16, which numpy has no
    # dtype for — torch raises rather than converting.
    return torch.cat(out).float().numpy()


def macro_f1(labels, probability) -> float:
    return round(
        float(f1_score(labels, (probability >= 0.5).astype(int), average="macro")), 4
    )


def paired_ci(labels, a, b, rng, iterations=2000):
    """Percentile CI for macro-F1(a) - macro-F1(b) over the same resampled rows."""
    labels = np.asarray(labels)
    preds_a = (a >= 0.5).astype(int)
    preds_b = (b >= 0.5).astype(int)
    draws = []
    for _ in range(iterations):
        idx = rng.integers(0, len(labels), len(labels))
        if len(np.unique(labels[idx])) < 2:
            continue
        draws.append(
            f1_score(labels[idx], preds_a[idx], average="macro")
            - f1_score(labels[idx], preds_b[idx], average="macro")
        )
    return [round(float(np.percentile(draws, 2.5)), 4),
            round(float(np.percentile(draws, 97.5)), 4)]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifacts", default=os.environ.get("ARTIFACTS_DIR", "artifacts"))
    parser.add_argument("--data", default="data")
    parser.add_argument("--candidate", required=True)
    parser.add_argument("--incumbent", default="artifacts/model_b")
    parser.add_argument("--max-length", type=int, default=160)
    parser.add_argument("--seed", type=int, default=20260908)
    parser.add_argument("--report", default="model_b_comparison.json")
    args = parser.parse_args()

    _, test_df = fetch_dreaddit(args.data)
    hindi_path = os.path.join(args.artifacts, "model_b_hindi_eval.json")
    with open(hindi_path, encoding="utf-8") as fh:
        hindi = json.load(fh)

    sets = {
        "english": (list(test_df["text"]), list(test_df["label"])),
        "hindi_back_translated": (hindi, list(test_df["label"].head(len(hindi)))),
    }

    rng = np.random.default_rng(args.seed)
    report = {"candidate": args.candidate, "incumbent": args.incumbent, "sets": {}}

    for name, (texts, labels) in sets.items():
        candidate = probabilities(args.candidate, texts, args.max_length)
        incumbent = probabilities(args.incumbent, texts, args.max_length)

        row = {
            "n": len(labels),
            "candidate_macro_f1": macro_f1(labels, candidate),
            "incumbent_macro_f1": macro_f1(labels, incumbent),
            "candidate_roc_auc": round(float(roc_auc_score(labels, candidate)), 4),
            "incumbent_roc_auc": round(float(roc_auc_score(labels, incumbent)), 4),
            "paired_bootstrap_95ci_of_difference": paired_ci(labels, candidate, incumbent, rng),
            # The collapse detectors. A model predicting one class for every
            # input, or emitting a near-constant probability, has no usable
            # signal on this set however its macro-F1 reads.
            "candidate_positive_predictions": int((candidate >= 0.5).sum()),
            "candidate_probability_spread": round(float(np.ptp(candidate)), 4),
            "incumbent_positive_predictions": int((incumbent >= 0.5).sum()),
            "incumbent_probability_spread": round(float(np.ptp(incumbent)), 4),
        }
        row["candidate_is_degenerate"] = (
            row["candidate_probability_spread"] < 0.05
            or row["candidate_positive_predictions"] in (0, row["n"])
        )
        report["sets"][name] = row

        verdict = (
            "DEGENERATE" if row["candidate_is_degenerate"]
            else "worse" if row["paired_bootstrap_95ci_of_difference"][1] < 0
            else "better" if row["paired_bootstrap_95ci_of_difference"][0] > 0
            else "not distinguishable"
        )
        print(f"{name}: candidate {row['candidate_macro_f1']:.4f} vs incumbent "
              f"{row['incumbent_macro_f1']:.4f}  "
              f"95% CI {row['paired_bootstrap_95ci_of_difference']}  -> {verdict}")
        print(f"   candidate predicts class-1 for "
              f"{row['candidate_positive_predictions']}/{row['n']}, "
              f"probability spread {row['candidate_probability_spread']}")

    path = os.path.join(args.artifacts, args.report)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2)
    print(f"\nsaved -> {path}")


if __name__ == "__main__":
    main()
