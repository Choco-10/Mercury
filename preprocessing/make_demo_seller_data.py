#!/usr/bin/env python3
"""
make_demo_seller_data.py — build the demo seller uploads for the pricing workflow.

The seller upload schemas are fixed by ai.md §14/§15:

    seller_sales.csv   date,product_id,price,units_sold,discount
    competitors.csv    date,competitor_id,product_id,competitor_product_id,
                       competitor_price,competitor_discount

The sales rows are taken **verbatim from the M5-derived chronological test split**
(real held-out dates, prices and units for a mapped product), so the demo never
invents demand and the feature vector stays inside the training distribution.
Competitor rows are demo inputs the seller would supply: each competitor's price is
the seller's own observed price shifted by a fixed deterministic offset, with a fixed
discount. Competitor data never reaches XGBoost (ai.md §32) — it is Bedrock context.

The two output files are also valid ``POST /api/data/upload`` payloads, so the same
data can drive the DynamoDB-backed product flow.

Usage:
  python preprocessing/make_demo_seller_data.py --product-id FOODS_1_004
  python preprocessing/make_demo_seller_data.py --product-id FOODS_1_004 --upload
"""

import argparse
import csv
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
TEST_SPLIT = REPO / "data" / "processed" / "test.csv"
MODEL = REPO / "data" / "model"
OUT_DIR = REPO / "data" / "demo"

BUCKET = "pricing-ai-780891107631"
REGION = "ap-south-1"
UPLOAD_PREFIX = "pricing-ai/seller/uploads"

# (competitor_id, competitor_product_id, price offset vs the seller price, discount)
COMPETITORS = [
    ("C001", "CP101", 0.06, 5),
    ("C002", "CP205", -0.02, 10),
    ("C003", "CP309", 0.12, 0),
]


def demo_rows(product_id: str, days: int) -> list:
    """Held-out test-split rows for one product, with verified calendar dates.

    The processed splits store ``day_of_week``/``month`` but not the raw ``date``
    column, so dates are reconstructed backwards from the window end recorded in
    ``model_metadata.json`` (500 products x 165 consecutive days) and then *verified*
    against those two stored columns — if any row disagrees, the reconstruction is
    wrong and the script fails instead of writing misleading dates.
    """
    import json
    from datetime import date, timedelta

    import pandas as pd

    if not TEST_SPLIT.exists():
        raise SystemExit(f"missing {TEST_SPLIT}; run preprocessing/prepare_m5.py first")
    metadata = json.loads((MODEL / "model_metadata.json").read_text())
    window_end = date.fromisoformat(metadata["date_range"]["end"])

    frame = pd.read_csv(TEST_SPLIT, usecols=["product_id", "price", "units_sold",
                                             "day_of_week", "month"])
    frame = frame[frame["product_id"] == product_id]
    if frame.empty:
        raise SystemExit(f"no test-split rows for {product_id}; pick a mapped product")
    mapping = (MODEL / "product_mapping.json").read_text()
    if f'"{product_id}"' not in mapping:
        raise SystemExit(f"{product_id} is not in product_mapping.json (ai.md §31)")

    records = frame.to_dict("records")
    total = len(records)
    rows = []
    for index, record in enumerate(records):
        day = window_end - timedelta(days=total - 1 - index)
        if day.weekday() != int(record["day_of_week"]) or day.month != int(record["month"]):
            raise SystemExit(
                f"date reconstruction failed for {product_id} at row {index + 1}: "
                f"derived {day} does not match the stored day_of_week/month")
        rows.append({"date": day.isoformat(), "price": record["price"],
                     "units_sold": int(record["units_sold"])})
    return rows[-days:]


def write_outputs(rows: list, product_id: str) -> tuple:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    sales_path = OUT_DIR / "seller_sales.csv"
    competitors_path = OUT_DIR / "competitors.csv"

    with sales_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["date", "product_id", "price", "units_sold", "discount"])
        for row in rows:
            writer.writerow([row["date"], product_id, f"{float(row['price']):.2f}",
                             int(row["units_sold"]), 0])

    with competitors_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["date", "competitor_id", "product_id", "competitor_product_id",
                         "competitor_price", "competitor_discount"])
        for row in rows:
            price = float(row["price"])
            for competitor_id, competitor_product_id, offset, discount in COMPETITORS:
                writer.writerow([row["date"], competitor_id, product_id,
                                 competitor_product_id, f"{price * (1 + offset):.2f}",
                                 discount])
    return sales_path, competitors_path


def main() -> int:
    ap = argparse.ArgumentParser(description="Build the demo seller + competitor CSVs.")
    ap.add_argument("--product-id", required=True, help="a product present in the trained mapping")
    ap.add_argument("--days", type=int, default=120,
                    help="research days to include (>= 31 so the 30-day feature is available)")
    ap.add_argument("--upload", action="store_true",
                    help=f"also upload to s3://{BUCKET}/{UPLOAD_PREFIX}/")
    args = ap.parse_args()

    if args.days < 31:
        raise SystemExit("--days must be at least 31 (30 prior days + the latest day)")

    rows = demo_rows(args.product_id, args.days)
    sales_path, competitors_path = write_outputs(rows, args.product_id)
    print(f"{sales_path} — {len(rows)} rows "
          f"({rows[0]['date']} -> {rows[-1]['date']}, last price {float(rows[-1]['price']):.2f})")
    print(f"{competitors_path} — {len(rows) * len(COMPETITORS)} rows "
          f"({len(COMPETITORS)} competitors x {len(rows)} days)")

    if args.upload:
        import boto3

        s3 = boto3.client("s3", region_name=REGION)
        for path in (sales_path, competitors_path):
            key = f"{UPLOAD_PREFIX}/{path.name}"
            s3.upload_file(str(path), BUCKET, key, ExtraArgs={"ContentType": "text/csv"})
            print(f"uploaded s3://{BUCKET}/{key}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
