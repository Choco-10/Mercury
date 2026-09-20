#!/usr/bin/env python3
"""
feature_engineering.py — inference features for one seller product (ai.md §7/§16/§18).

The seven features, in the training order (ai.md §6, product-agnostic model):

    price, day_of_week, month,
    sales_7d_avg, sales_30d_avg, price_change_percent, event

Leakage rules (ai.md §8):
  * ``sales_7d_avg``/``sales_30d_avg`` use the PRIOR days only — the same
    ``shift(1).rolling(n).mean()`` definition the training data was built with
  * ``price_change_percent`` uses the current and previous price only
  * future ``units_sold`` never becomes an input feature

The model is PRODUCT-AGNOSTIC: no per-product mappings exist or are needed —
every product with enough history is supported (the rolling 7d/30d averages
carry the product's own demand scale).

Seller history (ai.md §14): ``date,product_id,price,units_sold,discount``
Competitor data (ai.md §15): ``date,competitor_id,product_id,competitor_product_id,
competitor_price,competitor_discount`` — contextual only, never a model input.

CLI (offline fixture or downloaded S3 objects):
  python inference/feature_engineering.py --sales data/demo/seller_sales.csv \
      --product-id FOODS_1_004
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
CONTRACT_PATH = REPO / "shared" / "pricing-contract.json"
MODEL_DIR = REPO / "data" / "model"
DATE_FORMAT = "%Y-%m-%d"


class FeatureEngineeringError(Exception):
    """Invalid inference input; ``code`` is the public, controlled reason."""

    def __init__(self, message: str, code: str = "invalid_input"):
        super().__init__(message)
        self.code = code


def load_contract(path: Path = CONTRACT_PATH) -> dict:
    """The pricing contract shared with the Node/Lambda implementation."""
    return json.loads(Path(path).read_text())


def _read_json(path: Path) -> dict:
    if not Path(path).exists():
        raise FeatureEngineeringError(f"missing model mapping: {path}", "missing_mapping")
    return json.loads(Path(path).read_text())


def load_mappings(product_mapping_path: Path = MODEL_DIR / "product_mapping.json",
                  product_category_path: Path = MODEL_DIR / "product_category.json") -> tuple:
    """Return ``(product_mapping, category_mapping, product_category)``."""
    return (
        _read_json(product_mapping_path),
        _read_json(MODEL_DIR / "category_mapping.json"),
        _read_json(product_category_path),
    )


def _parse_date(value: str) -> str:
    from datetime import datetime

    try:
        parsed = datetime.strptime(str(value).strip(), DATE_FORMAT)
    except (ValueError, AttributeError):
        raise FeatureEngineeringError(f"date must be YYYY-MM-DD, got {value!r}")
    return parsed.strftime(DATE_FORMAT)


def parse_sales_csv(text: str) -> list:
    """Parse and validate the seller sales schema (ai.md §14)."""
    rows = []
    reader = csv.DictReader(text.splitlines())
    if not reader.fieldnames:
        raise FeatureEngineeringError("sales CSV has no header")
    for column in ("date", "product_id", "price", "units_sold"):
        if column not in reader.fieldnames:
            raise FeatureEngineeringError(f"sales CSV is missing the '{column}' column")
    for line, record in enumerate(reader, start=2):
        try:
            price = float(record["price"])
            units = float(record["units_sold"])
        except (TypeError, ValueError):
            raise FeatureEngineeringError(f"line {line}: price/units_sold must be numeric")
        if not price > 0 or units < 0 or units != int(units):
            raise FeatureEngineeringError(
                f"line {line}: price must be positive and units_sold a nonnegative integer")
        try:
            discount = float(record.get("discount") or 0)
        except ValueError:
            raise FeatureEngineeringError(f"line {line}: discount must be numeric")
        rows.append({
            "date": _parse_date(record["date"]),
            "product_id": (record["product_id"] or "").strip(),
            "price": price,
            "units_sold": int(units),
            "discount": discount,
        })
    return rows


def parse_competitors_csv(text: str) -> list:
    """Parse and validate the competitor schema (ai.md §15)."""
    rows = []
    reader = csv.DictReader(text.splitlines())
    if not reader.fieldnames:
        raise FeatureEngineeringError("competitor CSV has no header")
    for column in ("date", "competitor_id", "product_id", "competitor_product_id",
                   "competitor_price"):
        if column not in reader.fieldnames:
            raise FeatureEngineeringError(f"competitor CSV is missing the '{column}' column")
    for line, record in enumerate(reader, start=2):
        try:
            price = float(record["competitor_price"])
        except (TypeError, ValueError):
            raise FeatureEngineeringError(f"line {line}: competitor_price must be numeric")
        if not price > 0:
            raise FeatureEngineeringError(f"line {line}: competitor_price must be positive")
        rows.append({
            "date": _parse_date(record["date"]),
            "competitor_id": (record["competitor_id"] or "").strip(),
            "product_id": (record["product_id"] or "").strip(),
            "competitor_product_id": (record.get("competitor_product_id") or "").strip(),
            "competitor_price": price,
            "competitor_discount": float(record.get("competitor_discount") or 0),
        })
    return rows


def latest_competitors(competitor_rows: list, product_id: str) -> list:
    """Latest observation per ``competitor_id`` for ``product_id`` (ai.md §15)."""
    latest = {}
    for row in competitor_rows:
        if str(row["product_id"]) != str(product_id):
            continue
        current = latest.get(row["competitor_id"])
        if current is None or row["date"] > current["date"]:
            latest[row["competitor_id"]] = row
    return [latest[key] for key in sorted(latest)]


def _sorted_history(sales_rows: list, product_id: str) -> list:
    """Strictly ordered, duplicate-free history for one product."""
    rows = [row for row in sales_rows if str(row["product_id"]) == str(product_id)]
    if not rows:
        raise FeatureEngineeringError(
            f"no seller history for product {product_id!r}", "no_seller_history")
    seen = {}
    for row in rows:
        if row["date"] in seen:
            raise FeatureEngineeringError(
                f"duplicate seller history for {product_id} on {row['date']}",
                "invalid_history")
        seen[row["date"]] = row
    return [seen[key] for key in sorted(seen)]


def latest_inference_features(sales_rows: list, product_id: str, *,
                              min_history_days: int = 30) -> dict:
    """The latest inference feature row for ``product_id`` (ai.md §7/§16).

    The inference date is the seller's latest recorded day, so ``day_of_week`` and
    ``month`` describe that day and every other value is derived from history up to
    and including it. ``sales_7d_avg``/``sales_30d_avg`` deliberately exclude the
    latest day (prior days only, ai.md §8), exactly like the training features.

    The model is PRODUCT-AGNOSTIC: no per-product mappings exist or are needed —
    every product with enough history is supported (the rolling 7d/30d averages
    carry the product's own demand scale).

    Raises ``FeatureEngineeringError`` for insufficient history.
    """
    history = _sorted_history(sales_rows, product_id)
    latest = history[-1]
    prior = history[:-1]
    if len(prior) < min_history_days:
        raise FeatureEngineeringError(
            f"at least {min_history_days + 1} daily seller records are required "
            f"(30 prior days + the latest day); got {len(history)}",
            "insufficient_history")

    from datetime import date

    day = date.fromisoformat(latest["date"])
    previous_price = float(prior[-1]["price"])
    current_price = float(latest["price"])
    features = {
        "price": current_price,
        "day_of_week": day.weekday(),                      # Monday = 0 (ai.md §7)
        "month": day.month,                                # 1-12
        "sales_7d_avg": sum(r["units_sold"] for r in prior[-7:]) / 7.0,
        "sales_30d_avg": sum(r["units_sold"] for r in prior[-30:]) / 30.0,
        # Current + previous price only (ai.md §7); replaced per candidate in §18.
        "price_change_percent": ((current_price - previous_price) / previous_price * 100.0)
        if previous_price else 0.0,
        # M5 calendar/event flags exist only for 2011-2016; seller uploads are outside
        # that calendar, so no event applies. Never invented (ai.md §7).
        "event": 0,
    }
    return {
        "product_id": product_id,
        "features": features,
        "inference_date": latest["date"],
        "current_price": current_price,
        "previous_price": previous_price,
        "history_days": len(history),
        "last_units": int(latest["units_sold"]),
    }


def candidate_features(base: dict, candidate_price: float, current_price: float) -> dict:
    """One candidate row (ai.md §18): replace ``price``, recompute the price change.

    Only the candidate price and its ``price_change_percent`` differ between rows —
    every other value is the seller's latest historical context, unchanged.
    """
    features = dict(base)
    features["price"] = float(candidate_price)
    features["price_change_percent"] = (
        (float(candidate_price) - float(current_price)) / float(current_price) * 100.0
        if current_price else 0.0
    )
    return features


def endpoint_payload(features: dict, contract: dict = None) -> str:
    """One text/csv row: nine numeric values in contract order (ai.md §13)."""
    contract = contract or load_contract()
    return contract["endpoint"]["delimiter"].join(
        contract["endpoint"]["value_format"] % float(features[name])
        for name in contract["features"])


def latest_inference_features_for_files(sales_path: Path, product_id: str,
                                        contract: dict = None) -> dict:
    """Convenience wrapper: read a seller CSV and return the latest feature row."""
    contract = contract or load_contract()
    return latest_inference_features(
        parse_sales_csv(Path(sales_path).read_text()), product_id,
        min_history_days=int(contract["min_history_days"]))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        description="Compute the latest XGBoost inference features for one seller product.")
    ap.add_argument("--sales", required=True, help="seller sales CSV (ai.md §14 schema)")
    ap.add_argument("--competitors", default=None,
                    help="optional competitor CSV (ai.md §15) — context only, never a model input")
    ap.add_argument("--product-id", required=True)
    ap.add_argument("--json", action="store_true", help="print raw JSON instead of a summary")
    args = ap.parse_args(argv)

    contract = load_contract()
    result = latest_inference_features_for_files(
        Path(args.sales), args.product_id, contract)
    payload = endpoint_payload(result["features"], contract)

    competitors = []
    if args.competitors:
        competitors = latest_competitors(
            parse_competitors_csv(Path(args.competitors).read_text()), args.product_id)

    if args.json:
        print(json.dumps({"inference": result, "endpoint_payload": payload,
                          "competitors": competitors}, indent=2))
        return 0

    print(f"product_id          {result['product_id']} (product-agnostic model)")
    print(f"inference date      {result['inference_date']} "
          f"(day_of_week {result['features']['day_of_week']}, month {result['features']['month']})")
    print(f"history             {result['history_days']} days, "
          f"current price {result['current_price']}, previous price {result['previous_price']}")
    print(f"sales_7d_avg        {result['features']['sales_7d_avg']:.4f} "
          f"(prior days only — ai.md §8)")
    print(f"sales_30d_avg       {result['features']['sales_30d_avg']:.4f}")
    print(f"price_change_pct    {result['features']['price_change_percent']:.4f} "
          f"(current vs previous price only)")
    print(f"event               {result['features']['event']}")
    print(f"endpoint payload    {payload}")
    print(f"competitors         {len(competitors)} "
          f"(context for Bedrock only — never sent to XGBoost)")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except FeatureEngineeringError as error:
        print(f"error [{error.code}]: {error}", file=sys.stderr)
        sys.exit(2)
