"""Train Model B — self-assessment NLP (spec 7.2)."""

from __future__ import annotations

import argparse
import json
import os
import urllib.request
import zipfile
from datetime import UTC, datetime

import numpy as np
import pandas as pd
import torch
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    f1_score,
    roc_auc_score,
)
from torch.utils.data import Dataset
from transformers import (
    AutoModelForSequenceClassification,
    AutoTokenizer,
    Trainer,
    TrainingArguments,
)

# AI4Bharat's IndicBERT v2 (github.com/AI4Bharat/IndicBERT, ACL 2023) is the
# spec's first-choice family and IS reachable — it is `ai4bharat/indic-bert`,
# the v1 ALBERT checkpoint, that is gated. MuRIL stays selectable so the two can
# be compared on the same data rather than chosen by assertion.
BASE_MODEL = "ai4bharat/IndicBERTv2-MLM-only"
ALTERNATE_BASE_MODEL = "google/muril-base-cased"
TRANSLATION_MODEL = "Helsinki-NLP/opus-mt-en-hi"
DREADDIT_URL = "http://www.cs.columbia.edu/~eturcan/data/dreaddit.zip"

OUTPUT_DIR = "model_b"
META_FILE = "model_b_meta.json"


class TextDataset(Dataset):
    def __init__(self, encodings, labels):
        self.encodings = encodings
        self.labels = labels

    def __len__(self) -> int:
        return len(self.labels)

    def __getitem__(self, idx):
        item = {k: v[idx] for k, v in self.encodings.items()}
        item["labels"] = torch.tensor(int(self.labels[idx]))
        return item


def fetch_dreaddit(data_dir: str) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Download the authors' release once, then read from disk."""
    target = os.path.join(data_dir, "dreaddit")
    train_path = os.path.join(target, "dreaddit-train.csv")
    test_path = os.path.join(target, "dreaddit-test.csv")

    if not (os.path.exists(train_path) and os.path.exists(test_path)):
        os.makedirs(target, exist_ok=True)
        print(f"downloading Dreaddit from {DREADDIT_URL}")
        archive = os.path.join(target, "dreaddit.zip")
        urllib.request.urlretrieve(DREADDIT_URL, archive)
        with zipfile.ZipFile(archive) as z:
            z.extractall(target)
        os.remove(archive)

    train = pd.read_csv(train_path)[["text", "label"]].dropna()
    test = pd.read_csv(test_path)[["text", "label"]].dropna()
    return train, test


def back_translate(texts: list[str], batch_size: int = 16) -> list[str]:
    """English -> Hindi, for the multilingual evaluation set."""
    from transformers import MarianMTModel, MarianTokenizer

    print(f"translating {len(texts)} held-out samples to Hindi with {TRANSLATION_MODEL}")
    tokenizer = MarianTokenizer.from_pretrained(TRANSLATION_MODEL)
    model = MarianMTModel.from_pretrained(TRANSLATION_MODEL)
    model.eval()

    out: list[str] = []
    with torch.no_grad():
        for i in range(0, len(texts), batch_size):
            batch = [t[:900] for t in texts[i : i + batch_size]]
            enc = tokenizer(batch, return_tensors="pt", padding=True, truncation=True,
                            max_length=256)
            generated = model.generate(**enc, max_new_tokens=256)
            out.extend(tokenizer.batch_decode(generated, skip_special_tokens=True))
            print(f"  {min(i + batch_size, len(texts))}/{len(texts)}", end="\r")
    print()
    return out


def encoder_layers(base):
    """The list of transformer blocks, across the naming conventions in use.

    BERT-family models put them at `encoder.layer`; the decoder-derived encoders
    (Gemma-3, which IndicBERT v3 is built on) use `layers`.
    """
    for path in (("encoder", "layer"), ("layers",), ("encoder", "layers"),
                 ("model", "layers"), ("transformer", "layer")):
        node = base
        for attribute in path:
            node = getattr(node, attribute, None)
            if node is None:
                break
        else:
            return node
    raise RuntimeError(
        f"cannot locate the encoder layers of {type(base).__name__}. Refusing to "
        "continue: freezing would silently do nothing and the run would look fine."
    )


def freeze_lower_layers(model, n_layers: int) -> int:
    """Freeze the embeddings and the bottom n encoder blocks. Returns the count.

    Resolves the modules rather than matching a name prefix. The prefix version
    only worked for BertModel, and on any other family it froze nothing without
    saying so — a failure that shows up much later as a model that has forgotten
    the languages it was chosen for.
    """
    base = model.base_model
    embeddings = getattr(base, "embeddings", None)
    if embeddings is None:
        embeddings = base.get_input_embeddings()

    frozen = 0
    for param in embeddings.parameters():
        param.requires_grad = False
        frozen += param.numel()
    for layer in encoder_layers(base)[:n_layers]:
        for param in layer.parameters():
            param.requires_grad = False
            frozen += param.numel()

    if frozen == 0:
        raise RuntimeError("freezing selected no parameters; refusing to train")
    return frozen


def evaluate_split(trainer, tokenizer, texts, labels, max_length, label: str) -> dict:
    encodings = tokenizer(list(texts), truncation=True, padding="max_length",
                          max_length=max_length, return_tensors="pt")
    dataset = TextDataset(encodings, list(labels))
    logits = trainer.predict(dataset).predictions
    probs = torch.softmax(torch.tensor(logits), dim=-1)[:, 1].numpy()
    preds = (probs >= 0.5).astype(int)

    metrics = {
        "n": int(len(labels)),
        "accuracy": float(accuracy_score(labels, preds)),
        "macro_f1": float(f1_score(labels, preds, average="macro")),
        "roc_auc": float(roc_auc_score(labels, probs)),
    }
    print(f"\n--- {label} (n={metrics['n']}) ---")
    print(classification_report(labels, preds, target_names=["no_distress_signal",
                                                             "distress_signal"],
                                digits=3, zero_division=0))
    print(f"macro-F1 {metrics['macro_f1']:.4f}   ROC-AUC {metrics['roc_auc']:.4f}")
    return metrics


def main() -> None:
    parser = argparse.ArgumentParser(description="Fine-tune Model B.")
    parser.add_argument("--artifacts", default=os.environ.get("ARTIFACTS_DIR", "artifacts"))
    parser.add_argument("--data", default="data")
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--max-length", type=int, default=160)
    parser.add_argument("--lr", type=float, default=3e-5)
    parser.add_argument("--seed", type=int, default=20260907)
    parser.add_argument("--hindi-eval-size", type=int, default=300)
    parser.add_argument("--freeze-bottom", type=int, default=6,
                        help="freeze embeddings and this many lower encoder layers")
    parser.add_argument("--base-model", default=BASE_MODEL,
                        help=f"encoder to fine-tune (alternative: {ALTERNATE_BASE_MODEL})")
    parser.add_argument("--out", default=OUTPUT_DIR, help="artifact subdirectory")
    parser.add_argument("--meta", default=META_FILE)
    args = parser.parse_args()

    torch.manual_seed(args.seed)
    np.random.seed(args.seed)

    train_df, test_df = fetch_dreaddit(args.data)
    # Hold out a validation slice from train; the official test split stays untouched.
    train_df = train_df.sample(frac=1.0, random_state=args.seed).reset_index(drop=True)
    n_val = int(len(train_df) * 0.15)
    val_df, train_df = train_df.iloc[:n_val], train_df.iloc[n_val:]
    print(f"train={len(train_df)}  val={len(val_df)}  test={len(test_df)} (official split)")
    print(f"train label balance: {train_df['label'].value_counts().to_dict()}")

    tokenizer = AutoTokenizer.from_pretrained(args.base_model)
    model = AutoModelForSequenceClassification.from_pretrained(
        args.base_model,
        num_labels=2,
        id2label={0: "no_distress_signal", 1: "distress_signal"},
        label2id={"no_distress_signal": 0, "distress_signal": 1},
    )

    # Spec 7.2 allows freezing lower layers when compute-limited. MuRIL's
    # embedding table alone is ~151M parameters (197k vocab); leaving it frozen
    # cuts the backward pass dramatically and costs little, since the multilingual
    # representation is what we want to keep intact.
    frozen = freeze_lower_layers(model, args.freeze_bottom)
    total = sum(p.numel() for p in model.parameters())
    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    print(f"parameters: {total:,} total, {trainable:,} trainable "
          f"({frozen:,} frozen: embeddings + bottom {args.freeze_bottom} layers)")

    def encode(df):
        return tokenizer(list(df["text"]), truncation=True, padding="max_length",
                         max_length=args.max_length, return_tensors="pt")

    train_ds = TextDataset(encode(train_df), list(train_df["label"]))
    val_ds = TextDataset(encode(val_df), list(val_df["label"]))

    output_dir = os.path.join(args.artifacts, args.out)
    # transformers 5 dropped warmup_ratio in favour of an explicit step count.
    steps_per_epoch = -(-len(train_ds) // args.batch_size)
    warmup_steps = max(1, int(0.1 * steps_per_epoch * args.epochs))
    training_args = TrainingArguments(
        output_dir=os.path.join(output_dir, "_checkpoints"),
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch_size,
        per_device_eval_batch_size=32,
        learning_rate=args.lr,
        warmup_steps=warmup_steps,
        weight_decay=0.01,
        logging_steps=50,
        save_strategy="no",
        report_to=[],
        seed=args.seed,
    )

    # Spec 7.2: use the HF Trainer API, do not hand-roll the loop.
    trainer = Trainer(model=model, args=training_args, train_dataset=train_ds,
                      eval_dataset=val_ds)
    print("\nfine-tuning...")
    trainer.train()

    # --- Evaluation, EN and HI reported separately -----------------------
    en_metrics = evaluate_split(trainer, tokenizer, test_df["text"], test_df["label"],
                                args.max_length, "ENGLISH (official Dreaddit test split)")

    hindi_subset = test_df.head(args.hindi_eval_size)
    hindi_texts = back_translate(list(hindi_subset["text"]))
    # Persisted so vocabulary pruning can keep Devanagari coverage. Without it
    # the pruned on-device model would map every Devanagari token to [UNK] and
    # silently lose the multilingual behaviour this encoder was chosen for.
    with open(os.path.join(args.artifacts, "model_b_hindi_eval.json"), "w",
              encoding="utf-8") as fh:
        json.dump(hindi_texts, fh, ensure_ascii=False)
    hi_metrics = evaluate_split(trainer, tokenizer, hindi_texts, hindi_subset["label"],
                                args.max_length, "HINDI (machine-translated from the same posts)")

    print("\n" + "=" * 66)
    print("CROSS-LINGUAL TRANSFER")
    print(f"  EN macro-F1 {en_metrics['macro_f1']:.4f}  ROC-AUC {en_metrics['roc_auc']:.4f}")
    print(f"  HI macro-F1 {hi_metrics['macro_f1']:.4f}  ROC-AUC {hi_metrics['roc_auc']:.4f}")
    print(f"  transfer gap (macro-F1): {en_metrics['macro_f1'] - hi_metrics['macro_f1']:+.4f}")
    print("  HI is machine-translated English, so this is a lower bound on")
    print("  cross-lingual behaviour, not a claim about natural Hindi.")
    print("=" * 66)

    # --- Persist ---------------------------------------------------------
    os.makedirs(output_dir, exist_ok=True)
    model.save_pretrained(output_dir)
    tokenizer.save_pretrained(output_dir)

    meta = {
        "trained_at": datetime.now(UTC).isoformat(),
        "base_model": args.base_model,
        "base_model_rationale": (
            "ai4bharat/indic-bert is a gated repository requiring an authenticated "
            "token; google/muril-base-cased is the alternative named in spec 7.2 and "
            "tokenises Devanagari at word level."
        ),
        "corpus": {
            "name": "Dreaddit",
            "citation": "Turcan & McKeown (2019), EMNLP LOUHI workshop",
            "url": DREADDIT_URL,
            "licence": "released by the authors for research use",
            "n_train": int(len(train_df)),
            "n_val": int(len(val_df)),
            "n_test": int(len(test_df)),
        },
        "corpora_not_used": {
            "CLPsych": "requires a signed data-use agreement; not obtainable here",
            "DAIC-WOZ": "requires a signed end-user licence with USC ICT",
        },
        "limitations": [
            "Trained on English social-media register only; clinical-adjacent "
            "phrasing is under-represented without CLPsych/DAIC-WOZ.",
            "Hindi performance is measured on machine translations of English "
            "posts, which is a lower bound and does not capture code-mixing.",
        ],
        "hyperparameters": {
            "epochs": args.epochs, "batch_size": args.batch_size,
            "max_length": args.max_length, "learning_rate": args.lr,
            "frozen": f"embeddings + bottom {args.freeze_bottom} encoder layers",
            "trainable_parameters": int(trainable), "total_parameters": int(total),
        },
        "labels": {"0": "no_distress_signal", "1": "distress_signal"},
        "metrics": {"english": en_metrics, "hindi_back_translated": hi_metrics},
    }
    with open(os.path.join(args.artifacts, args.meta), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, indent=2)

    print(f"\nsaved -> {output_dir}/ and {args.artifacts}/{META_FILE}")


if __name__ == "__main__":
    main()
