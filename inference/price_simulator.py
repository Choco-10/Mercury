#!/usr/bin/env python3
"""
price_simulator.py — the seven candidate prices and their XGBoost predictions
(ai.md §17/§18/§19).

  * exactly SEVEN candidates: P - 10%, -7.5%, -5%, -2.5%, P, +2.5%, +5%, rounded to the
    nearest whole currency unit. When whole-unit rounding collapses candidates into
    duplicates (M5-scale prices are single digits, e.g. every candidate of 1.96 rounds
    to 2), the set is rounded to two decimals so seven DISTINCT candidates survive —
    ai.md §17 requires "always exactly seven candidate prices"
  * ONE SageMaker ``InvokeEndpoint`` call per candidate, sequential, ``text/csv``,
    one row of nine numeric values in contract order (ai.md §13)
  * ``predicted_revenue = candidate_price x predicted_units`` is computed here, in
    application code (ai.md §19) — never by XGBoost and never by Bedrock
  * only ``price`` and ``price_change_percent`` change between candidate rows
    (ai.md §18)

CLI (real endpoint by default; ``--dry-run`` builds the seven rows without invoking):
  python inference/price_simulator.py --sales data/demo/seller_sales.csv \
      --product-id FOODS_1_004
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from feature_engineering import (  # noqa: E402  (same directory)
    FeatureEngineeringError,
    candidate_features,
    endpoint_payload,
    latest_inference_features_for_files,
    load_contract,
    latest_competitors,
    parse_competitors_csv,
)

REPO = Path(__file__).resolve().parents[1]
DEFAULT_ENDPOINT = "pricing-xgboost-endpoint"
DEFAULT_REGION = "ap-south-1"


class EndpointError(RuntimeError):
    """The SageMaker endpoint could not be reached or returned an unusable value."""


def candidate_prices(current_price: float, contract: dict = None) -> list:
    """The exactly-seven candidate prices for ``current_price`` (ai.md §17).

    Rounds to the nearest whole currency unit; if that produces fewer than seven
    distinct prices, rounds to two decimals instead so no candidate is lost.
    """
    contract = contract or load_contract()
    deltas = contract["candidate_price_deltas_percent"]
    rounding = contract["candidate_price_rounding"]

    def build(decimals: int) -> list:
        prices = []
        for delta in deltas:
            price = round(float(current_price) * (1 + delta / 100.0), decimals)
            if price not in prices:
                prices.append(price)
        return prices

    prices = build(int(rounding["decimals"]))
    if len(prices) < len(deltas):
        prices = build(int(rounding["fallback_decimals"]))
    if len(prices) != len(deltas):
        raise ValueError(
            f"could not build {len(deltas)} distinct candidates for price {current_price}")
    return prices


def invoke_endpoint(endpoint_name: str, payload: str, region: str = DEFAULT_REGION,
                    client=None) -> float:
    """One ``InvokeEndpoint`` call with one text/csv row; returns predicted units."""
    if client is None:
        import boto3

        client = boto3.client("sagemaker-runtime", region_name=region)
    response = client.invoke_endpoint(
        EndpointName=endpoint_name, ContentType="text/csv", Body=payload)
    body = response["Body"].read().decode("utf-8").strip()
    try:
        return float(body)
    except ValueError:
        raise EndpointError(f"endpoint returned a non-numeric prediction: {body!r}")


def simulate(base_features: dict, current_price: float, *,
             endpoint_name: str = DEFAULT_ENDPOINT, region: str = DEFAULT_REGION,
             invoke=None, contract: dict = None) -> dict:
    """Send one row per candidate to the endpoint and price the results (ai.md §17-19)."""
    contract = contract or load_contract()
    prices = candidate_prices(current_price, contract)
    scenarios = []
    for price in prices:
        features = candidate_features(base_features, price, current_price)
        payload = endpoint_payload(features, contract)
        predicted_units = (invoke or (lambda body: invoke_endpoint(
            endpoint_name, body, region)))(payload)
        scenarios.append({
            "price": price,
            "predicted_units": float(predicted_units),
            "predicted_revenue": float(price) * float(predicted_units),
            "price_change_percent": features["price_change_percent"],
        })
    return {
        "endpoint": endpoint_name,
        "invocations": len(prices),
        "scenarios": scenarios,
    }


def objective_optimal(scenarios: list, objective: str) -> dict:
    """Deterministic objective pick (ai.md §21) — the validation/fallback reference.

    ``increase_sales`` ranks by predicted_units, ``maximize_revenue`` by
    predicted_revenue. Ties keep the candidate closest to the current price.
    """
    if objective == "increase_sales":
        key = lambda s: (s["predicted_units"], -abs(s["price_change_percent"]))  # noqa: E731
    elif objective == "maximize_revenue":
        key = lambda s: (s["predicted_revenue"], -abs(s["price_change_percent"]))  # noqa: E731
    else:
        raise ValueError(f"unknown objective {objective!r}")
    return max(scenarios, key=key)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        description="Generate the seven candidate prices and ask SageMaker XGBoost for "
                    "each prediction (ai.md §17-§19).")
    ap.add_argument("--sales", required=True, help="seller sales CSV (ai.md §14 schema)")
    ap.add_argument("--competitors", default=None, help="optional competitor CSV (ai.md §15)")
    ap.add_argument("--product-id", required=True)
    ap.add_argument("--endpoint", default=DEFAULT_ENDPOINT)
    ap.add_argument("--region", default=DEFAULT_REGION)
    ap.add_argument("--objective", default="maximize_revenue",
                    choices=["increase_sales", "maximize_revenue"])
    ap.add_argument("--dry-run", action="store_true",
                    help="show the seven payloads without invoking the endpoint")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)

    contract = load_contract()
    inference = latest_inference_features_for_files(
        Path(args.sales), args.product_id, contract=contract)
    current_price = inference["current_price"]
    prices = candidate_prices(current_price, contract)

    if args.dry_run:
        payloads = [
            {"price": price, "payload": endpoint_payload(
                candidate_features(inference["features"], price, current_price), contract)}
            for price in prices]
        print(json.dumps({"current_price": current_price, "candidates": payloads},
                         indent=2))
        return 0

    result = simulate(inference["features"], current_price, endpoint_name=args.endpoint,
                      region=args.region, contract=contract)
    best = objective_optimal(result["scenarios"], args.objective)

    competitors = []
    if args.competitors:
        competitors = latest_competitors(
            parse_competitors_csv(Path(args.competitors).read_text()), args.product_id)

    if args.json:
        print(json.dumps({**result, "inference": inference, "objective": args.objective,
                          "objective_optimal": best, "competitors": competitors},
                         indent=2))
        return 0

    print(f"endpoint {result['endpoint']}: {result['invocations']} invocations, "
          f"current price {current_price}")
    print(f"{'candidate':>10} {'change %':>9} {'units':>8} {'revenue':>12}")
    for scenario in result["scenarios"]:
        print(f"{scenario['price']:>10} {scenario['price_change_percent']:>9.2f} "
              f"{scenario['predicted_units']:>8.3f} {scenario['predicted_revenue']:>12.2f}")
    print(f"objective-optimal ({args.objective}): price {best['price']} -> "
          f"{best['predicted_units']:.3f} units / {best['predicted_revenue']:.2f} revenue")
    print("Predicted units come from SageMaker; revenue is price x units in application "
          "code; Bedrock only interprets these numbers (ai.md §18/§19/§22).")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except FeatureEngineeringError as error:
        print(f"error [{error.code}]: {error}", file=sys.stderr)
        sys.exit(2)
    except EndpointError as error:
        print(f"error [endpoint]: {error}", file=sys.stderr)
        sys.exit(3)
