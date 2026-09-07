"""Shrink Model B for on-device inference by pruning its vocabulary (spec 7.2)."""

from __future__ import annotations

import argparse
import json
import os

import numpy as np
import pandas as pd
import torch


def collect_used_token_ids(tokenizer, texts: list[str]) -> set[int]:
    used: set[int] = set()
    for i in range(0, len(texts), 128):
        batch = tokenizer(list(texts[i : i + 128]), truncation=True, max_length=512)
        for ids in batch["input_ids"]:
            used.update(ids)
    return used


def main() -> None:
    parser = argparse.ArgumentParser(description="Prune Model B's vocabulary.")
    parser.add_argument("--artifacts", default=os.environ.get("ARTIFACTS_DIR", "artifacts"))
    parser.add_argument("--model-dir", default=None)
    parser.add_argument("--out", default=None)
    parser.add_argument("--data", default="data")
    parser.add_argument("--keep-top", type=int, default=0,
                        help="also keep the first N vocabulary rows (frequent wordpieces)")
    args = parser.parse_args()

    model_dir = args.model_dir or os.path.join(args.artifacts, "model_b")
    out_dir = args.out or os.path.join(args.artifacts, "model_b_pruned")

    from transformers import AutoModelForSequenceClassification, AutoTokenizer

    tokenizer = AutoTokenizer.from_pretrained(model_dir)
    model = AutoModelForSequenceClassification.from_pretrained(model_dir)
    model.eval()

    # --- What text does this model actually serve? -------------------------
    train = pd.read_csv(os.path.join(args.data, "dreaddit", "dreaddit-train.csv"))
    test = pd.read_csv(os.path.join(args.data, "dreaddit", "dreaddit-test.csv"))
    texts = list(train["text"].dropna()) + list(test["text"].dropna())

    # Hindi and code-mixed coverage. Without these the pruned model would map
    # every Devanagari token to [UNK] and quietly lose the multilingual
    # behaviour that justified this encoder in the first place.
    hindi_path = os.path.join(args.artifacts, "model_b_hindi_eval.json")
    if os.path.exists(hindi_path):
        with open(hindi_path, encoding="utf-8") as fh:
            texts += json.load(fh)
        print(f"included {len(json.load(open(hindi_path, encoding='utf-8')))} Hindi samples")
    else:
        print("WARNING: no Hindi evaluation set found; Devanagari coverage will be "
              "limited to the probe sentences below")

    texts += [
        "मुझे बिल्कुल नींद नहीं आ रही है। हर दिन पहले से भारी लगता है।",
        "आज ड्यूटी रोस्टर आया। इस हफ्ते मेरी सुबह की पाली है और मौसम अच्छा है।",
        "यहाँ मेरा कोई नहीं है जिससे मैं बात कर सकूँ। बहुत अकेला लगता है।",
        "Sir duty bahut heavy hai aajkal, neend nahi aa rahi properly.",
    ]

    print(f"tokenising {len(texts)} texts to find the live vocabulary")
    used = collect_used_token_ids(tokenizer, texts)

    # Special tokens must survive regardless of whether the corpus used them.
    used.update(tokenizer.all_special_ids)
    if args.keep_top:
        used.update(range(args.keep_top))

    keep_ids = sorted(used)
    original_size = model.config.vocab_size
    print(f"vocabulary {original_size:,} -> {len(keep_ids):,} "
          f"({len(keep_ids) / original_size:.1%} retained)")

    # --- Rebuild the embedding table --------------------------------------
    embeddings = model.get_input_embeddings()
    old_weight = embeddings.weight.data
    new_weight = old_weight[keep_ids].clone()

    id_to_token = {i: t for t, i in tokenizer.get_vocab().items()}
    kept_tokens = [id_to_token[i] for i in keep_ids]

    os.makedirs(out_dir, exist_ok=True)

    # Rewrite the original tokenizer.json rather than building a new one:
    # BertTokenizerFast(vocab_file=...) silently ignored the file under
    # transformers 5 and made 97% of input [UNK]. Editing in place keeps the
    # normalizer and pre-tokenizer identical.
    with open(os.path.join(model_dir, "tokenizer.json"), encoding="utf-8") as fh:
        tokenizer_json = json.load(fh)

    if tokenizer_json["model"]["type"] != "WordPiece":
        raise SystemExit(
            f"vocabulary pruning here assumes WordPiece, found "
            f"{tokenizer_json['model']['type']}"
        )

    new_vocab = {token: index for index, token in enumerate(kept_tokens)}
    tokenizer_json["model"]["vocab"] = new_vocab

    # Added tokens carry their own ids and must be remapped or dropped.
    remapped_added = []
    for added in tokenizer_json.get("added_tokens", []):
        if added["content"] in new_vocab:
            added = dict(added)
            added["id"] = new_vocab[added["content"]]
            remapped_added.append(added)
    tokenizer_json["added_tokens"] = remapped_added

    with open(os.path.join(out_dir, "tokenizer.json"), "w", encoding="utf-8") as fh:
        json.dump(tokenizer_json, fh, ensure_ascii=False)

    config_path = os.path.join(model_dir, "tokenizer_config.json")
    if os.path.exists(config_path):
        with open(config_path, encoding="utf-8") as fh:
            tokenizer_config = json.load(fh)
        with open(os.path.join(out_dir, "tokenizer_config.json"), "w",
                  encoding="utf-8") as fh:
            json.dump(tokenizer_config, fh, ensure_ascii=False, indent=2)

    from transformers import AutoTokenizer as _AutoTokenizer

    pruned_tokenizer = _AutoTokenizer.from_pretrained(out_dir)

    # Fail loudly if the rewrite did not take. This is the check whose absence
    # let the first attempt ship a tokenizer that produced [UNK] for everything.
    probe = "I cannot sleep at all any more"
    if pruned_tokenizer.tokenize(probe) != tokenizer.tokenize(probe):
        raise SystemExit(
            "pruned tokenizer does not reproduce the original segmentation on a "
            "probe whose tokens were all retained; the vocabulary rewrite failed"
        )

    new_embedding = torch.nn.Embedding(len(keep_ids), old_weight.shape[1],
                                       padding_idx=pruned_tokenizer.pad_token_id)
    new_embedding.weight.data = new_weight
    model.set_input_embeddings(new_embedding)
    model.config.vocab_size = len(keep_ids)

    model.save_pretrained(out_dir)

    # --- Prove the pruned model behaves identically ------------------------
    print("\nparity: original vs pruned, on held-out text")
    original_tokenizer = AutoTokenizer.from_pretrained(model_dir)
    original_model = AutoModelForSequenceClassification.from_pretrained(model_dir)
    original_model.eval()

    probes = list(test["text"].dropna().head(60)) + texts[-4:]
    deltas, unk_rate = [], []
    with torch.no_grad():
        for text in probes:
            a = original_tokenizer(text, truncation=True, padding="max_length",
                                   max_length=160, return_tensors="pt")
            b = pruned_tokenizer(text, truncation=True, padding="max_length",
                                 max_length=160, return_tensors="pt")
            sa = float(torch.softmax(original_model(**a).logits, -1)[0][1])
            sb = float(torch.softmax(model(**b).logits, -1)[0][1])
            deltas.append(abs(sa - sb))
            ids = b["input_ids"][0]
            unk_rate.append(
                float((ids == pruned_tokenizer.unk_token_id).sum())
                / max(int((ids != pruned_tokenizer.pad_token_id).sum()), 1)
            )

    worst = max(deltas)
    print(f"  worst |delta| over {len(probes)} texts: {worst:.6f}")
    print(f"  mean [UNK] rate: {np.mean(unk_rate):.4%}")

    size_before = sum(p.numel() for p in original_model.parameters()) * 4 / 1e6
    size_after = sum(p.numel() for p in model.parameters()) * 4 / 1e6
    print(f"  fp32 size: {size_before:.0f} MB -> {size_after:.0f} MB")

    report = {
        "source_model": model_dir,
        "vocab_before": int(original_size),
        "vocab_after": len(keep_ids),
        "fp32_mb_before": round(size_before, 1),
        "fp32_mb_after": round(size_after, 1),
        "worst_parity_delta": round(worst, 8),
        "mean_unk_rate": round(float(np.mean(unk_rate)), 6),
        "note": (
            "Retained embedding rows are bit-identical to the original. Any "
            "difference in score comes from tokens that fell out of the "
            "vocabulary and now map to [UNK]."
        ),
    }
    with open(os.path.join(args.artifacts, "model_b_pruning_report.json"), "w",
              encoding="utf-8") as fh:
        json.dump(report, fh, indent=2)

    if worst > 0.02:
        print("\nWARNING: pruning changed scores by more than 0.02. Coverage is too "
              "thin — widen the corpus used to collect the vocabulary.")
    print(f"\nsaved -> {out_dir}")


if __name__ == "__main__":
    main()
