"""Export Model B to quantised ONNX for on-device inference (spec 7.2)."""

from __future__ import annotations

import argparse
import json
import os
import shutil
from datetime import UTC, datetime

import numpy as np

PARITY_SAMPLES = [
    ("I cannot sleep at all any more and there is nobody here I can talk to.", "en"),
    ("The duty roster came out this morning and the drill went smoothly.", "en"),
    ("मुझे बिल्कुल नींद नहीं आ रही है और यहाँ मेरा कोई नहीं है।", "hi"),
    ("आज ड्यूटी रोस्टर आया। इस हफ्ते मेरी सुबह की पाली है।", "hi"),
    ("Sir duty bahut heavy hai aajkal, sleep nahi ho rahi properly.", "hi"),
]

# What a progressive web app can realistically ask a user to download once and
# cache. Generous rather than strict — the point is to have a stated bar.
PWA_BUDGET_MB = 150.0


def main() -> None:
    parser = argparse.ArgumentParser(description="Export Model B to quantised ONNX.")
    parser.add_argument("--artifacts", default=os.environ.get("ARTIFACTS_DIR", "artifacts"))
    parser.add_argument("--model-dir", default=None)
    parser.add_argument("--out", default=None)
    parser.add_argument("--meta", default="model_b_meta.json")
    parser.add_argument("--report", default="model_b_onnx_report.json")
    parser.add_argument("--max-parity-delta", type=float, default=0.05)
    parser.add_argument("--precision", choices=("int8", "fp16"), default="int8",
                        help="int8 is smaller; fp16 is near-lossless but larger")
    args = parser.parse_args()

    source = args.model_dir or os.path.join(args.artifacts, "model_b")
    target = args.out or os.path.join(args.artifacts, "model_b_onnx")
    if not os.path.isdir(source):
        raise SystemExit(f"missing {source}; run training/train_model_b.py first")

    import torch
    from onnxruntime.quantization import QuantType, quantize_dynamic
    from transformers import AutoModelForSequenceClassification, AutoTokenizer

    tokenizer = AutoTokenizer.from_pretrained(source)
    model = AutoModelForSequenceClassification.from_pretrained(source)
    model.eval()

    with open(os.path.join(args.artifacts, args.meta), encoding="utf-8") as fh:
        max_length = int(json.load(fh)["hyperparameters"]["max_length"])

    if os.path.isdir(target):
        shutil.rmtree(target)
    os.makedirs(target, exist_ok=True)

    float_path = os.path.join(target, "model.onnx")
    quant_path = os.path.join(target, "model_quantized.onnx")

    sample = tokenizer("export tracing sample", truncation=True,
                       padding="max_length", max_length=max_length,
                       return_tensors="pt")

    # Not every encoder's tokenizer emits token_type_ids — IndicBERTv2's does
    # not, MuRIL's does. Deriving the signature from the tokenizer keeps this
    # working across both rather than hard-coding one model's input set.
    input_names = [
        name for name in ("input_ids", "attention_mask", "token_type_ids")
        if name in sample
    ]
    print(f"exporting to ONNX (inputs: {', '.join(input_names)})...")
    torch.onnx.export(
        model,
        tuple(sample[name] for name in input_names),
        float_path,
        input_names=input_names,
        output_names=["logits"],
        dynamic_axes={
            **{name: {0: "batch", 1: "sequence"} for name in input_names},
            "logits": {0: "batch"},
        },
        opset_version=17,
        do_constant_folding=True,
        # Legacy TorchScript exporter. torch 2.14 defaults to the dynamo path,
        # which emits a graph whose shape inference the ONNX Runtime quantiser
        # rejects ("Inferred shape and existing shape differ in dimension 0").
        # The TorchScript exporter is the well-trodden route for BERT graphs.
        dynamo=False,
    )
    tokenizer.save_pretrained(target)

    if args.precision == "fp16":
        # Half precision rather than int8. Roughly halves the file and is
        # near-lossless, because it keeps a floating-point representation
        # instead of discretising each weight into 256 buckets.
        print("converting to float16...")
        import onnx
        from onnxconverter_common import float16

        onnx.save(
            float16.convert_float_to_float16(onnx.load(float_path),
                                             keep_io_types=True),
            quant_path,
        )
    else:
        print("quantising to int8 (dynamic, MatMul only, per channel)...")
        # MatMul only: quantising Gather (the embedding lookup) collapses
        # every score toward 0.5. Tried and reverted: reduce_range
        # (0.0995 -> 0.1066), excluding the last layer (0.1850 -> 0.1857).
        quantize_dynamic(
            model_input=float_path,
            model_output=quant_path,
            weight_type=QuantType.QInt8,
            op_types_to_quantize=["MatMul"],
            per_channel=True,
            extra_options={"MatMulConstBOnly": True},
        )

    # --- Parity ------------------------------------------------------------
    import onnxruntime as ort

    session = ort.InferenceSession(quant_path, providers=["CPUExecutionProvider"])
    print("\nparity check: PyTorch vs quantised ONNX")

    deltas = []
    for text, language in PARITY_SAMPLES:
        encoded = tokenizer(text, truncation=True, padding="max_length",
                            max_length=max_length, return_tensors="pt")
        with torch.no_grad():
            torch_score = float(
                torch.softmax(model(**encoded).logits, dim=-1)[0][1]
            )
        logits = session.run(
            ["logits"],
            {name: encoded[name].numpy() for name in input_names},
        )[0]
        exp = np.exp(logits[0] - logits[0].max())
        onnx_score = float((exp / exp.sum())[1])

        delta = abs(torch_score - onnx_score)
        deltas.append(delta)
        print(f"  [{language}] torch={torch_score:.4f}  onnx-int8={onnx_score:.4f}  "
              f"delta={delta:.4f}  {text[:42]}...")

    worst = max(deltas)
    print(f"\nworst parity delta on probes: {worst:.4f}")

    # Gate on the decision, not the raw delta. The override is an absolute
    # threshold (score_b > 0.75), so a 0.10 shift at 0.42 changes nothing while
    # a 0.02 shift at 0.75 flips a band.
    import pandas as pd

    test = pd.read_csv(os.path.join("data", "dreaddit", "dreaddit-test.csv"))
    probe_texts = list(test["text"].dropna())
    print(f"\ndecision agreement over {len(probe_texts)} held-out texts")

    torch_scores, onnx_scores = [], []
    for i in range(0, len(probe_texts), 32):
        batch = probe_texts[i : i + 32]
        enc = tokenizer(batch, truncation=True, padding="max_length",
                        max_length=max_length, return_tensors="pt")
        with torch.no_grad():
            torch_scores.extend(
                torch.softmax(model(**enc).logits, dim=-1)[:, 1].tolist()
            )
        logits = session.run(
            ["logits"], {name: enc[name].numpy() for name in input_names}
        )[0]
        exp = np.exp(logits - logits.max(axis=1, keepdims=True))
        onnx_scores.extend((exp / exp.sum(axis=1, keepdims=True))[:, 1].tolist())

    torch_scores = np.asarray(torch_scores)
    onnx_scores = np.asarray(onnx_scores)
    all_deltas = np.abs(torch_scores - onnx_scores)

    override = 0.75
    disagreements = int(
        ((torch_scores > override) != (onnx_scores > override)).sum()
    )
    disagreement_rate = disagreements / len(torch_scores)

    # The band where a quantisation shift can flip the override.
    near = (torch_scores >= override - 0.10) & (torch_scores <= override + 0.10)
    near_worst = float(all_deltas[near].max()) if near.any() else 0.0

    print(f"  override decisions that differ: {disagreements}/{len(torch_scores)} "
          f"({disagreement_rate:.2%})")
    print(f"  worst delta near the {override} threshold "
          f"(n={int(near.sum())}): {near_worst:.4f}")
    print(f"  worst delta overall: {all_deltas.max():.4f}   "
          f"median: {np.median(all_deltas):.4f}")

    decision_ok = disagreements == 0
    near_ok = near_worst <= args.max_parity_delta

    sizes = {
        name: round(os.path.getsize(os.path.join(target, name)) / 1e6, 1)
        for name in os.listdir(target) if name.endswith(".onnx")
    }
    for name, size in sizes.items():
        print(f"  {name}: {size} MB")

    quantised_mb = sizes.get("model_quantized.onnx", float("inf"))
    embedding_params = sum(
        p.numel() for n, p in model.named_parameters() if n.startswith("bert.embeddings")
    )

    parity_ok = decision_ok and near_ok
    size_ok = quantised_mb <= PWA_BUDGET_MB
    deployable = parity_ok and size_ok

    print(f"\nPWA budget {PWA_BUDGET_MB:.0f} MB: "
          f"{'within' if size_ok else 'OVER'} at {quantised_mb} MB")
    print(f"parity gate: {'PASS' if parity_ok else 'FAIL'} "
          f"(decisions_agree={decision_ok}, near_threshold_ok={near_ok})")
    print(f"on-device deployable: {deployable}")

    report = {
        "exported_at": datetime.now(UTC).isoformat(),
        "source": source,
        "target": target,
        "vocab_size": int(model.config.vocab_size),
        "onnx_inputs": input_names,
        "embedding_params": int(embedding_params),
        "quantisation": ("dynamic int8, per-channel, MatMul only; the embedding "
                         "lookup is left in float because quantising it collapses "
                         "the model"),
        "parity": {
            "gate": ("zero override-decision disagreements over the held-out set, "
                     "and worst delta within the threshold in the band around the "
                     "0.75 override where a shift could flip it"),
            "n_evaluated": int(len(torch_scores)),
            "override_disagreements": disagreements,
            "override_disagreement_rate": round(float(disagreement_rate), 6),
            "worst_delta_near_threshold": round(near_worst, 6),
            "worst_delta_overall": round(float(all_deltas.max()), 6),
            "median_delta": round(float(np.median(all_deltas)), 6),
            "worst_delta_on_probes": round(float(worst), 6),
            "threshold": args.max_parity_delta,
            "passed": parity_ok,
        },
        "onnx_file_sizes_mb": sizes,
        "pwa_budget_mb": PWA_BUDGET_MB,
        "on_device_verdict": {
            "deployable_as_pwa_asset": deployable,
            "size_within_budget": size_ok,
            "parity_within_threshold": parity_ok,
        },
    }
    with open(os.path.join(args.artifacts, args.report), "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2)

    if not deployable:
        raise SystemExit(
            f"\nEXPORT GATE FAILED (parity_ok={parity_ok}, size_ok={size_ok}). "
            "The artifact and report were written, but this build must not ship "
            "as the on-device model. See on_device_verdict in the report."
        )
    print(f"\nsaved -> {target}/ and {args.report}")


if __name__ == "__main__":
    main()
