#!/usr/bin/env python3
"""
s3_layout.py — make the pricing bucket match ai.md §5 exactly, and keep it that way.

Target layout (one bucket, ``S3_BUCKET``):

    pricing-ai/
    ├── raw/m5/{calendar,sales_train_validation,sell_prices}.csv
    ├── processed/{train,validation,test}.csv          ← the ONLY processed location
    ├── model/xgboost/{model.tar.gz, product_mapping.json, category_mapping.json,
    │                  product_category.json, model_metadata.json, evaluation.json}
    ├── seller/uploads/
    └── predictions/

The script is idempotent and prints every write/delete it performs:

  1. writes ``data/model/product_category.json`` (product_id → training category) when
     missing/``--refresh-mappings``; inference must reuse the *stored* category
     encoding instead of inventing one (ai.md §7/§31)
  2. uploads the built-in-algorithm CSV splits to ``processed/``
  3. deletes the duplicate locations (``processed/sagemaker/`` and the stray
     ``model/*.json`` siblings)
  4. creates the empty prefixes (``raw/m5/``, ``seller/uploads/``, ``predictions/``) with
     a ``.keep`` marker, and uploads the M5 raw files when ``data/m5/`` is present
     (the Kaggle token is required to download them — see aws-plan.md Phase 0)
  5. republishes the model metadata + evaluation.json next to model.tar.gz

Usage:
  python training/s3_layout.py --dry-run     # show what would change (no writes)
  python training/s3_layout.py               # apply
"""

import argparse
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))

import train_xgboost as t  # noqa: E402  (same directory; reuses S3 keys + publish)

PROCESSED = REPO / "data" / "processed"
SM_PROCESSED = PROCESSED / "sagemaker"
RAW = REPO / "data" / "m5"
MODEL = REPO / "data" / "model"

PROCESSED_PREFIX = "pricing-ai/processed"
RAW_PREFIX = "pricing-ai/raw/m5"
SELLER_PREFIX = "pricing-ai/seller/uploads"
PREDICTIONS_PREFIX = "pricing-ai/predictions"
SPLITS = ("train", "validation", "test")
MODEL_SIBLINGS = ("product_mapping.json", "category_mapping.json",
                  "product_category.json", "model_metadata.json", "evaluation.json")


def log(dry_run: bool, message: str) -> None:
    print(f"{'[dry-run] ' if dry_run else ''}{message}")


def list_keys(s3, bucket: str, prefix: str) -> list:
    keys = []
    token = None
    while True:
        kwargs = {"Bucket": bucket, "Prefix": prefix}
        if token:
            kwargs["ContinuationToken"] = token
        page = s3.list_objects_v2(**kwargs)
        keys.extend(item["Key"] for item in page.get("Contents", []))
        if not page.get("IsTruncated"):
            return keys
        token = page["NextContinuationToken"]


def write_product_category(refresh: bool) -> Path:
    """product_id → training ``category``, read from the processed splits.

    The category feature in the training data is a project-level grouping assigned by
    ``preprocessing/prepare_m5.py`` (rank // 50), so it cannot be derived from the M5
    product id at inference time. Persisting it next to the other mappings is what lets
    inference reuse the stored encoding verbatim.
    """
    import pandas as pd

    path = MODEL / "product_category.json"
    if path.exists() and not refresh:
        return path

    categories = {}
    for name in SPLITS:
        source = PROCESSED / f"{name}.csv"
        if not source.exists():
            raise SystemExit(f"missing {source}; run preprocessing/prepare_m5.py first")
        rows = pd.read_csv(source, usecols=["product_id", "category"])
        for product_id, category in zip(rows["product_id"], rows["category"]):
            previous = categories.setdefault(str(product_id), int(category))
            if previous != int(category):
                raise SystemExit(
                    f"category for {product_id} differs between splits "
                    f"({previous} vs {int(category)}); the mappings are inconsistent")

    mapping = json.loads((MODEL / "product_mapping.json").read_text())
    missing = sorted(set(mapping) - set(categories))
    if missing:
        raise SystemExit(f"processed splits are missing mapped products: {missing[:5]}")
    path.write_text(json.dumps({pid: categories[pid] for pid in mapping}, indent=2))
    print(f"wrote {path} ({len(mapping)} products)")
    return path


def upload_processed(s3, bucket: str, dry_run: bool) -> None:
    for name in SPLITS:
        source = SM_PROCESSED / f"{name}.csv"
        if not source.exists():
            raise SystemExit(f"missing {source}; run `train_xgboost.py eval` or `build` first")
        key = f"{PROCESSED_PREFIX}/{name}.csv"
        log(dry_run, f"upload {source.name} -> s3://{bucket}/{key} ({source.stat().st_size:,} bytes)")
        if not dry_run:
            s3.upload_file(str(source), bucket, key, ExtraArgs={"ContentType": "text/csv"})


def prune_duplicates(s3, bucket: str, dry_run: bool) -> None:
    """Delete the duplicate processed location and the stray model/*.json copies."""
    for key in list_keys(s3, bucket, f"{PROCESSED_PREFIX}/sagemaker/"):
        log(dry_run, f"delete duplicate s3://{bucket}/{key}")
        if not dry_run:
            s3.delete_object(Bucket=bucket, Key=key)
    for name in MODEL_SIBLINGS:
        key = f"pricing-ai/model/{name}"
        if any(item["Key"] == key for item in
               s3.list_objects_v2(Bucket=bucket, Prefix=key).get("Contents", [])):
            log(dry_run, f"delete stray duplicate s3://{bucket}/{key} "
                         f"(canonical copy lives under model/xgboost/)")
            if not dry_run:
                s3.delete_object(Bucket=bucket, Key=key)
    for key in list_keys(s3, bucket, f"{PROCESSED_PREFIX}/"):
        if key.endswith(".keep"):
            log(dry_run, f"delete stale marker s3://{bucket}/{key}")
            if not dry_run:
                s3.delete_object(Bucket=bucket, Key=key)


def ensure_prefixes(s3, bucket: str, dry_run: bool) -> None:
    """Create the empty prefixes, and upload the M5 raw files when they exist locally."""
    raw_files = ("calendar.csv", "sales_train_validation.csv", "sell_prices.csv")
    present = [name for name in raw_files if (RAW / name).exists()]
    for name in present:
        source = RAW / name
        key = f"{RAW_PREFIX}/{name}"
        log(dry_run, f"upload raw {source.name} -> s3://{bucket}/{key} ({source.stat().st_size:,} bytes)")
        if not dry_run:
            s3.upload_file(str(source), bucket, key, ExtraArgs={"ContentType": "text/csv"})
    if len(present) != len(raw_files):
        missing = [name for name in raw_files if name not in present]
        print(f"WARNING: raw M5 files missing locally: {', '.join(missing)}")
        print("         download them once a Kaggle token exists at "
              "%USERPROFILE%\\.kaggle\\kaggle.json:")
        print(f"         kaggle competitions download -c m5-forecasting-accuracy -p {RAW}")
        print(f"         then re-run this script to populate s3://{bucket}/{RAW_PREFIX}/")

    for prefix in (f"{RAW_PREFIX}/", f"{SELLER_PREFIX}/", f"{PREDICTIONS_PREFIX}/"):
        if list_keys(s3, bucket, prefix):
            continue
        key = f"{prefix}.keep"
        log(dry_run, f"create prefix marker s3://{bucket}/{key}")
        if not dry_run:
            s3.put_object(Bucket=bucket, Key=key, Body=b"",
                          ContentType="application/octet-stream")


def show_inventory(s3, bucket: str) -> None:
    print(f"\nInventory of s3://{bucket}/pricing-ai/:")
    for key in list_keys(s3, bucket, "pricing-ai/"):
        size = s3.head_object(Bucket=bucket, Key=key)["ContentLength"]
        print(f"  {key}  ({size:,} bytes)")


def main() -> int:
    ap = argparse.ArgumentParser(description="Enforce the ai.md §5 S3 layout.")
    ap.add_argument("--bucket", default=t.BUCKET)
    ap.add_argument("--dry-run", action="store_true",
                    help="print the changes without applying them")
    ap.add_argument("--refresh-mappings", action="store_true",
                    help="rewrite data/model/product_category.json from the processed splits")
    args = ap.parse_args()

    import boto3

    s3 = boto3.client("s3", region_name=t.REGION)
    write_product_category(refresh=args.refresh_mappings)
    upload_processed(s3, args.bucket, args.dry_run)
    prune_duplicates(s3, args.bucket, args.dry_run)
    ensure_prefixes(s3, args.bucket, args.dry_run)

    evaluation_path = MODEL / "evaluation.json"
    evaluation = json.loads(evaluation_path.read_text()) if evaluation_path.exists() else {}
    log(args.dry_run, f"republish model metadata + evaluation.json -> "
                      f"s3://{args.bucket}/{t.MODEL_PREFIX}/")
    if not args.dry_run:
        t.publish_metadata(args.bucket, evaluation)

    show_inventory(s3, args.bucket)
    return 0


if __name__ == "__main__":
    sys.exit(main())
