#!/usr/bin/env python3
"""
eval_artifact.py — load a local XGBoost artifact and score it on the chronological
test split (ai.md §11) without retraining.

Runs under xgboost **1.7.4** (``data/model/build/venv``), the same version as the
``sagemaker-xgboost:1.7-1`` serving container:

  data/model/build/venv/Scripts/python.exe training/eval_artifact.py \
      --artifact data/model/build/model.tar.gz --publish

The artifact is the legacy ``binf`` binary the container loads. The repo interpreter
(xgboost 3.x) raises ``XGBoostError: Unknown construct ... binf`` on it, which is why
this script exists instead of reading the model in-process. S3 download/publish is done
by ``train_xgboost.py`` (the venv has no boto3 on purpose — the container needs only
xgboost 1.7.4 + pandas).
"""

import argparse
import io
import json
import sys
import tarfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
BUILD = REPO / "data" / "model" / "build"
MODEL = REPO / "data" / "model"
SM_PROCESSED = REPO / "data" / "processed" / "sagemaker"

FEATURES = ["price", "day_of_week", "month",
            "sales_7d_avg", "sales_30d_avg", "price_change_percent", "event"]
TARGET = "units_sold"


def load_booster(path: Path, member_name: str):
    import xgboost as xgb

    print(f"xgboost {xgb.__version__} (container version 1.7.4)")
    buffer = path.read_bytes()
    print(f"artifact: {path} ({len(buffer):,} bytes)")
    with tarfile.open(fileobj=io.BytesIO(buffer), mode="r:gz") as tar:
        members = [m.name for m in tar.getmembers() if m.isfile()]
        member = next((n for n in members if n.endswith(member_name)), None)
        if member is None:
            raise SystemExit(f"no '{member_name}' member in the artifact (found {members})")
        raw = tar.extractfile(member).read()
    print(f"members: {members}")
    booster = xgb.Booster()
    booster.load_model(bytearray(raw))
    return booster


def score(booster) -> dict:
    import numpy as np
    import pandas as pd
    import xgboost as xgb

    test_path = SM_PROCESSED / "test.csv"
    if not test_path.exists():
        raise SystemExit(f"missing {test_path} (run the preprocessing/build step first)")
    test = pd.read_csv(test_path, header=None, names=[TARGET] + FEATURES)
    pred = booster.predict(xgb.DMatrix(test[FEATURES].to_numpy()))
    error = pred - test[TARGET].to_numpy()
    return {
        "mae": round(float(np.mean(np.abs(error))), 4),
        "rmse": round(float(np.sqrt(np.mean(error ** 2))), 4),
        "rows": int(len(test)),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="Score a local XGBoost artifact (ai.md §11).")
    ap.add_argument("--artifact", default=str(BUILD / "model.tar.gz"),
                    help="local model.tar.gz downloaded from S3 or built by build_artifact.py")
    ap.add_argument("--model-member", default="xgboost-model")
    ap.add_argument("--publish", action="store_true",
                    help="write evaluation.json to data/model/ (uploaded to S3 by train_xgboost.py)")
    args = ap.parse_args()

    booster = load_booster(Path(args.artifact), args.model_member)
    evaluation = score(booster)
    print(f"test-set metrics: MAE={evaluation['mae']} RMSE={evaluation['rmse']} "
          f"({evaluation['rows']:,} rows)")

    if args.publish:
        payload = json.dumps({"mae": evaluation["mae"], "rmse": evaluation["rmse"]},
                             indent=2)
        BUILD.mkdir(parents=True, exist_ok=True)
        (BUILD / "evaluation.json").write_text(payload)
        (MODEL / "evaluation.json").write_text(payload)
        print(f"wrote {BUILD / 'evaluation.json'} and {MODEL / 'evaluation.json'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
