"""Distil Model B into a 6-layer student small enough to ship on-device.

After vocabulary pruning the embedding table is 12.3M of the model's ~98M
parameters, so depth — not vocabulary — is what keeps the fp16 export above the
150 MB PWA budget. Halving the encoder is the remaining lever.

The student is initialised from the fine-tuned teacher's alternate layers rather
than from scratch, and trained against the teacher's own logits as well as the
labels, so it inherits the decision boundary instead of relearning it from 2k
examples.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
from datetime import UTC, datetime

import numpy as np
import torch
import torch.nn.functional as F
from sklearn.metrics import f1_score
from transformers import (
    AutoConfig,
    AutoModelForSequenceClassification,
    AutoTokenizer,
    Trainer,
    TrainingArguments,
)

from training.train_model_b import (
    TextDataset,
    back_translate,
    evaluate_split,
    fetch_dreaddit,
    freeze_lower_layers,
)

TEACHER_DIR = "model_b_pruned"
OUTPUT_DIR = "model_b_distilled"
META_FILE = "model_b_distilled_meta.json"

# Spec 7.5's self-report override is an absolute threshold. Agreement here is
# the metric that decides whether a student may ship, not macro-F1.
OVERRIDE_THRESHOLD = 0.75


class DistillationDataset(TextDataset):
    """TextDataset plus the teacher's logits for each row."""

    def __init__(self, encodings, labels, teacher_logits):
        super().__init__(encodings, labels)
        self.teacher_logits = teacher_logits

    def __getitem__(self, idx):
        item = super().__getitem__(idx)
        item["teacher_logits"] = self.teacher_logits[idx]
        return item


class DistillationTrainer(Trainer):
    """Trainer with a soft-target term added to the usual cross-entropy.

    Subclassing rather than hand-rolling the loop keeps spec 7.2's requirement
    to use the Trainer API; only the loss changes.
    """

    def __init__(self, *args, alpha: float = 0.5, temperature: float = 2.0, **kwargs):
        super().__init__(*args, **kwargs)
        self.alpha = alpha
        self.temperature = temperature

    def compute_loss(self, model, inputs, return_outputs=False, **kwargs):
        # predict() and evaluate() come through here as well, and their batches
        # carry no teacher logits. Fall back to the plain supervised loss rather
        # than making the caller pick a different Trainer for evaluation.
        teacher_logits = inputs.pop("teacher_logits", None)
        labels = inputs.get("labels")
        outputs = model(**inputs)
        student_logits = outputs.logits

        hard = F.cross_entropy(student_logits, labels)
        if teacher_logits is None:
            return (hard, outputs) if return_outputs else hard

        t = self.temperature
        soft = F.kl_div(
            F.log_softmax(student_logits / t, dim=-1),
            F.log_softmax(teacher_logits / t, dim=-1),
            reduction="batchmean",
            log_target=True,
        ) * (t * t)

        loss = self.alpha * soft + (1.0 - self.alpha) * hard
        return (loss, outputs) if return_outputs else loss


def build_student(teacher, keep_layers: list[int]):
    """A shallower copy of the teacher, initialised from the layers it keeps.

    BERT-family only. Copying blocks between architectures is not a matter of
    renaming attributes, so this says so rather than failing on an attribute
    lookup halfway through building a model.
    """
    if teacher.base_model_prefix != "bert":
        raise RuntimeError(
            f"build_student supports BertModel-based encoders; got "
            f"{type(teacher.base_model).__name__}. A Gemma-3-derived encoder "
            "(IndicBERT v3) needs its own layer-copying path."
        )
    config = AutoConfig.from_pretrained(teacher.config._name_or_path)
    config.num_hidden_layers = len(keep_layers)
    config.num_labels = teacher.config.num_labels
    config.id2label = teacher.config.id2label
    config.label2id = teacher.config.label2id

    student = AutoModelForSequenceClassification.from_config(config)
    student.bert.embeddings.load_state_dict(teacher.bert.embeddings.state_dict())
    for position, source in enumerate(keep_layers):
        student.bert.encoder.layer[position].load_state_dict(
            teacher.bert.encoder.layer[source].state_dict()
        )
    if teacher.bert.pooler is not None and student.bert.pooler is not None:
        student.bert.pooler.load_state_dict(teacher.bert.pooler.state_dict())
    student.classifier.load_state_dict(teacher.classifier.state_dict())
    return student


def probabilities(trainer, tokenizer, texts, labels, max_length) -> np.ndarray:
    encodings = tokenizer(list(texts), truncation=True, padding="max_length",
                          max_length=max_length, return_tensors="pt")
    logits = trainer.predict(TextDataset(encodings, list(labels))).predictions
    return torch.softmax(torch.tensor(logits), dim=-1)[:, 1].numpy()


def paired_bootstrap_f1(labels, probs_a, probs_b, rng, iterations: int = 2000):
    """Percentile CI for macro-F1(a) - macro-F1(b), resampling the same rows.

    Paired because both models are scored on identical texts; the difference is
    far less variable than either figure on its own.
    """
    labels = np.asarray(labels)
    preds_a = (probs_a >= 0.5).astype(int)
    preds_b = (probs_b >= 0.5).astype(int)
    n = len(labels)
    draws = []
    for _ in range(iterations):
        idx = rng.integers(0, n, n)
        if len(np.unique(labels[idx])) < 2:
            continue
        draws.append(
            f1_score(labels[idx], preds_a[idx], average="macro")
            - f1_score(labels[idx], preds_b[idx], average="macro")
        )
    if not draws:
        return None
    return [round(float(np.percentile(draws, 2.5)), 4),
            round(float(np.percentile(draws, 97.5)), 4)]


def on_device_verdict(comparison: dict) -> dict:
    """Would this student be allowed to replace the teacher on-device?

    Two conditions, both read off the measured comparison. It must make the same
    override calls as the server model — spec 7.5's threshold is absolute, so a
    disagreement means the two surfaces report different bands for one person —
    and it must not be measurably worse at the task, which is what a paired
    confidence interval lying entirely below zero says.
    """
    blocking = []
    for name, row in comparison.items():
        if row["override_disagreements"]:
            blocking.append(
                f"{name}: {row['override_disagreements']}/{row['n']} override "
                f"decisions differ from the teacher "
                f"({row['override_disagreement_rate']:.2%})"
            )
        ci = row["paired_bootstrap_95ci_of_difference"]
        if ci and ci[1] < 0:
            blocking.append(
                f"{name}: macro-F1 is measurably below the teacher, "
                f"95% CI of the difference {ci}"
            )
    return {"replaces_teacher_on_device": not blocking, "blocking": blocking}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifacts", default=os.environ.get("ARTIFACTS_DIR", "artifacts"))
    parser.add_argument("--data", default="data")
    parser.add_argument("--teacher", default=TEACHER_DIR)
    parser.add_argument("--out", default=OUTPUT_DIR)
    parser.add_argument("--meta", default=META_FILE)
    parser.add_argument("--layers", type=int, default=6)
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--max-length", type=int, default=160)
    parser.add_argument("--lr", type=float, default=3e-5)
    parser.add_argument("--freeze-bottom", type=int, default=3,
                        help="freeze this many of the student's lower layers")
    parser.add_argument("--cross-lingual", dest="cross_lingual",
                        action=argparse.BooleanOptionalAction, default=True,
                        help="also distil on a Hindi translation of the training set")
    parser.add_argument("--alpha", type=float, default=0.5,
                        help="weight on the teacher's soft targets")
    parser.add_argument("--temperature", type=float, default=2.0)
    parser.add_argument("--seed", type=int, default=20260907)
    args = parser.parse_args()

    torch.manual_seed(args.seed)
    teacher_dir = os.path.join(args.artifacts, args.teacher)
    output_dir = os.path.join(args.artifacts, args.out)

    # The same splits and seed as the teacher's run, so every comparison below
    # is on identical rows.
    train_df, test_df = fetch_dreaddit(args.data)
    train_df = train_df.sample(frac=1.0, random_state=args.seed).reset_index(drop=True)
    n_val = int(len(train_df) * 0.15)
    val_df, train_df = train_df.iloc[:n_val], train_df.iloc[n_val:]
    print(f"train={len(train_df)}  val={len(val_df)}  test={len(test_df)} (official split)")

    tokenizer = AutoTokenizer.from_pretrained(teacher_dir)
    teacher = AutoModelForSequenceClassification.from_pretrained(teacher_dir)
    teacher.eval()

    n_teacher = sum(p.numel() for p in teacher.parameters())
    print(f"teacher: {teacher.config.num_hidden_layers} layers, {n_teacher:,} parameters")

    # Every other layer, ending on the last one — the classifier head was
    # trained against that layer's output, so keeping it preserves the head.
    step = teacher.config.num_hidden_layers // args.layers
    keep = list(range(teacher.config.num_hidden_layers - 1, -1, -step))[:args.layers][::-1]
    print(f"student keeps teacher layers {keep}")

    student = build_student(teacher, keep)
    n_student = sum(p.numel() for p in student.parameters())
    print(f"student: {args.layers} layers, {n_student:,} parameters "
          f"({n_student / n_teacher:.0%} of the teacher)")

    # The embeddings are already pruned and adapted; retraining them would only
    # spend compute and risk drifting away from the teacher's input space.
    #
    # The lower layers are frozen for a stronger reason. Dreaddit is English
    # only, so the model's Hindi behaviour comes entirely from the pretrained
    # multilingual encoder — the teacher kept it by freezing its bottom six
    # layers. A first attempt here left every student layer trainable and Hindi
    # macro-F1 fell from 0.7367 to 0.4232 while English fell only 0.08: the
    # student had been asked to fit English and did exactly that. The layers
    # frozen here are the ones the teacher also never updated.
    freeze_lower_layers(student, args.freeze_bottom)
    trainable = sum(p.numel() for p in student.parameters() if p.requires_grad)
    print(f"trainable: {trainable:,} "
          f"(frozen: embeddings + bottom {args.freeze_bottom} of {args.layers} layers)")

    def encode(df):
        return tokenizer(list(df["text"]), truncation=True, padding="max_length",
                         max_length=args.max_length, return_tensors="pt")

    # Distillation targets are the teacher's logits, so the training text needs
    # no labels — which means it need not be English. Translating the training
    # split and distilling on both copies asks the student to match the teacher
    # in Hindi too, instead of hoping the frozen layers carry it alone. The
    # TRAINING split only: the Hindi evaluation set is built from the held-out
    # test split and must stay unseen.
    train_texts = list(train_df["text"])
    train_labels = list(train_df["label"])
    if args.cross_lingual:
        cache = os.path.join(args.artifacts, "model_b_distil_train_hi.json")
        if os.path.exists(cache):
            with open(cache, encoding="utf-8") as fh:
                hindi_train = json.load(fh)
            print(f"reusing {len(hindi_train)} cached Hindi training translations")
        else:
            hindi_train = back_translate(train_texts)
            with open(cache, "w", encoding="utf-8") as fh:
                json.dump(hindi_train, fh, ensure_ascii=False)
        train_texts = train_texts + hindi_train
        train_labels = train_labels + train_labels
        print(f"training rows: {len(train_texts)} (English + Hindi)")

    train_enc = tokenizer(train_texts, truncation=True, padding="max_length",
                          max_length=args.max_length, return_tensors="pt")
    val_enc = encode(val_df)

    # Precomputed once. The teacher is frozen, so running it every step would
    # roughly double training time for an identical result.
    print("\nprecomputing teacher logits...")
    teacher_logits = []
    with torch.no_grad():
        for start in range(0, len(train_texts), 32):
            batch = {k: v[start:start + 32] for k, v in train_enc.items()}
            teacher_logits.append(teacher(**batch).logits)
    teacher_logits = torch.cat(teacher_logits)
    print(f"teacher logits: {tuple(teacher_logits.shape)}")

    train_ds = DistillationDataset(train_enc, train_labels, teacher_logits)
    val_ds = TextDataset(val_enc, list(val_df["label"]))

    steps_per_epoch = -(-len(train_ds) // args.batch_size)
    training_args = TrainingArguments(
        output_dir=os.path.join(output_dir, "_checkpoints"),
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch_size,
        per_device_eval_batch_size=32,
        learning_rate=args.lr,
        warmup_steps=max(1, int(0.1 * steps_per_epoch * args.epochs)),
        weight_decay=0.01,
        logging_steps=50,
        save_strategy="no",
        report_to=[],
        seed=args.seed,
        remove_unused_columns=False,
    )
    trainer = DistillationTrainer(
        model=student, args=training_args, train_dataset=train_ds, eval_dataset=val_ds,
        alpha=args.alpha, temperature=args.temperature,
    )
    print("\ndistilling...")
    trainer.train()

    # Persist before evaluating. Evaluation is the longer and more fragile half,
    # and a failure there should not throw away a finished training run.
    os.makedirs(output_dir, exist_ok=True)
    student.save_pretrained(output_dir)
    tokenizer.save_pretrained(output_dir)
    print(f"student saved -> {output_dir}/")

    # --- Evaluation on exactly the teacher's test sets --------------------
    en_metrics = evaluate_split(trainer, tokenizer, test_df["text"], test_df["label"],
                                args.max_length, "ENGLISH (official Dreaddit test split)")

    hindi_path = os.path.join(args.artifacts, "model_b_hindi_eval.json")
    with open(hindi_path, encoding="utf-8") as fh:
        hindi_texts = json.load(fh)
    hindi_labels = list(test_df["label"].head(len(hindi_texts)))
    hi_metrics = evaluate_split(trainer, tokenizer, hindi_texts, hindi_labels,
                                args.max_length, "HINDI (back-translated)")

    # --- Student against teacher, on the same rows ------------------------
    teacher_trainer = Trainer(model=teacher, args=TrainingArguments(
        output_dir=os.path.join(output_dir, "_teacher_eval"),
        per_device_eval_batch_size=32, report_to=[], remove_unused_columns=False,
    ))
    rng = np.random.default_rng(args.seed)
    comparison = {}
    for name, texts, labels in (
        ("english", list(test_df["text"]), list(test_df["label"])),
        ("hindi_back_translated", hindi_texts, hindi_labels),
    ):
        student_probs = probabilities(trainer, tokenizer, texts, labels, args.max_length)
        teacher_probs = probabilities(teacher_trainer, tokenizer, texts, labels,
                                      args.max_length)
        # What actually decides shipping: whether the two models would make the
        # same override call on the same text.
        disagreements = int(
            ((student_probs > OVERRIDE_THRESHOLD)
             != (teacher_probs > OVERRIDE_THRESHOLD)).sum()
        )
        comparison[name] = {
            "n": len(labels),
            "student_macro_f1": round(float(f1_score(labels,
                                                     (student_probs >= 0.5).astype(int),
                                                     average="macro")), 4),
            "teacher_macro_f1": round(float(f1_score(labels,
                                                     (teacher_probs >= 0.5).astype(int),
                                                     average="macro")), 4),
            "paired_bootstrap_95ci_of_difference": paired_bootstrap_f1(
                labels, student_probs, teacher_probs, rng),
            "override_disagreements": disagreements,
            "override_disagreement_rate": round(disagreements / len(labels), 6),
            "worst_abs_delta": round(float(np.abs(student_probs - teacher_probs).max()), 6),
            "median_abs_delta": round(
                float(np.median(np.abs(student_probs - teacher_probs))), 6),
        }

    for stale in ("_checkpoints", "_teacher_eval"):
        shutil.rmtree(os.path.join(output_dir, stale), ignore_errors=True)

    meta = {
        "trained_at": datetime.now(UTC).isoformat(),
        "purpose": (
            "on-device student. The server keeps the 12-layer model; this exists "
            "only because the fp16 export of the teacher is 196 MB against a "
            "150 MB budget."
        ),
        "teacher": teacher_dir,
        "teacher_layers": teacher.config.num_hidden_layers,
        "student_layers": args.layers,
        "layers_kept_from_teacher": keep,
        "parameters": {"teacher": n_teacher, "student": n_student, "trainable": trainable},
        "hyperparameters": {
            "epochs": args.epochs,
            "batch_size": args.batch_size,
            "max_length": args.max_length,
            "learning_rate": args.lr,
            "alpha": args.alpha,
            "temperature": args.temperature,
            "frozen": f"embeddings + bottom {args.freeze_bottom} layers",
            "cross_lingual_distillation": args.cross_lingual,
            "training_rows": len(train_texts),
        },
        "labels": {"0": "no_distress_signal", "1": "distress_signal"},
        "metrics": {"english": en_metrics, "hindi_back_translated": hi_metrics},
        "against_teacher": comparison,
        "on_device_verdict": on_device_verdict(comparison),
        "limitations": [
            "Inherits every limitation of the teacher: English training register, "
            "Hindi measured on machine translations.",
            "A shallower encoder has less capacity for the long-range context that "
            "distinguishes sustained distress from a single bad day.",
        ],
    }
    meta_path = os.path.join(args.artifacts, args.meta)
    with open(meta_path, "w", encoding="utf-8") as fh:
        json.dump(meta, fh, indent=2, ensure_ascii=False)

    print("\n" + "=" * 66)
    print("STUDENT vs TEACHER")
    print("=" * 66)
    for name, row in comparison.items():
        print(f"{name}: macro-F1 {row['student_macro_f1']:.4f} vs "
              f"{row['teacher_macro_f1']:.4f}, "
              f"95% CI of difference {row['paired_bootstrap_95ci_of_difference']}")
        print(f"  override decisions differing: {row['override_disagreements']}"
              f"/{row['n']} ({row['override_disagreement_rate']:.2%}), "
              f"worst delta {row['worst_abs_delta']:.4f}")
    print(f"\nsaved -> {output_dir}/ and {meta_path}")

    verdict = meta["on_device_verdict"]
    if not verdict["replaces_teacher_on_device"]:
        raise SystemExit(
            "\nDISTILLATION GATE FAILED. The student and its metrics were "
            "written, but it must not ship as the on-device model:\n  "
            + "\n  ".join(verdict["blocking"])
        )


if __name__ == "__main__":
    main()
