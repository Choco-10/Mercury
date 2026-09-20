#!/usr/bin/env python3
"""
prepare_m5.py — M5 preprocessing per ai.md §3/§4/§6/§7/§8/§9.

Produces the 3-year / ~500-product training dataset with leakage-safe
features and a chronological 70/15/15 train/validation/test split.

Run from the repo root:
    python preprocessing/prepare_m5.py

Inputs  (data/m5/):    calendar.csv, sales_train_validation.csv, sell_prices.csv
Outputs (data/processed/): train.csv, validation.csv, test.csv
Outputs (data/model/): product_mapping.json, category_mapping.json,
                       model_metadata.json
"""

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

REPO = Path(__file__).resolve().parents[1]
RAW = REPO / "data" / "m5"
PROCESSED = REPO / "data" / "processed"
MODEL = REPO / "data" / "model"

TARGET_DAYS = 1095          # ~3 years (ai.md §4)
N_PRODUCTS = 500            # ~10 categories x 10 types x 5 products
WARMUP_DAYS = 30            # rolling-feature warm-up before the window
M5_LAST_DAY = 1913

FEATURES = [
    "product_id", "category", "price", "day_of_week", "month",
    "sales_7d_avg", "sales_30d_avg", "price_change_percent", "event",
]
TARGET = "units_sold"

_DAY_TO_DATE: dict[str, pd.Timestamp] = {}


def load_calendar() -> pd.DataFrame:
    cal = pd.read_csv(RAW / "calendar.csv")
    day_nums = cal["d"].str[2:].astype(int)
    anchor = pd.Timestamp("2011-01-29")  # fixed M5 anchor for d_1
    cal["date"] = anchor + pd.to_timedelta(day_nums - 1, unit="D")
    return cal


def select_products(sales: pd.DataFrame, window_days: list[str]) -> pd.DataFrame:
    """Deterministic ~500-product selection (ai.md §4).

    Ranks ITEM-level totals (units summed across all stores) over the 3-year
    window, keeps the top N_PRODUCTS distinct items (ties broken by item_id).
    Project category/type labels are assigned sequentially (10 categories x
    10 types, 5 products per group) — a purely project-level mapping as
    permitted by ai.md §4; the M5 hierarchy need not be 10x10x5 naturally.
    """
    item_totals = sales.groupby("item_id")[window_days].sum().sum(axis=1)
    chosen = sorted(item_totals.items(), key=lambda kv: (-kv[1], kv[0]))[:N_PRODUCTS]
    order = {item_id: rank for rank, (item_id, _) in enumerate(chosen)}
    sel = sales[sales["item_id"].isin(order)].copy()
    sel["_rank"] = sel["item_id"].map(order)
    sel = sel.sort_values("_rank")
    sel["project_category"] = sel["_rank"] // 50        # 10 categories
    sel["project_type"] = (sel["_rank"] % 50) // 5      # 10 types
    return sel.drop(columns="_rank")


def pick_best_store_row(sel: pd.DataFrame, window_days: list[str]) -> pd.DataFrame:
    """One row per item: its best-selling store (ties broken by store_id).

    Units and price must come from the same store so the series stays
    coherent; the other store rows are dropped.
    """
    keep = []
    for _, grp in sel.groupby("item_id", sort=False):
        sums = grp.set_index("store_id")[window_days].sum(axis=1)
        best = sorted(sums.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]
        keep.append(grp[grp["store_id"] == best].iloc[0])
    return pd.DataFrame(keep)


def build_prices(sales_sel: pd.DataFrame, cal: pd.DataFrame,
                 build_days: list[str]) -> dict[str, pd.Series]:
    """Per-item daily price series indexed by date over warmup+window."""
    pairs = {f"{row.item_id}|{row.store_id}" for row in sales_sel.itertuples()}
    prices = pd.read_csv(RAW / "sell_prices.csv",
                         dtype={"store_id": str, "item_id": str})
    wanted_items = {p.split("|")[0] for p in pairs}
    prices = prices[prices["item_id"].isin(wanted_items)]
    prices = prices[prices["item_id"].str.cat(prices["store_id"], sep="|")
                    .isin(pairs)]

    wk_dates = cal.drop_duplicates("wm_yr_wk").set_index("wm_yr_wk")["date"]
    prices["date"] = prices["wm_yr_wk"].map(wk_dates)
    prices = prices.sort_values("date").drop_duplicates(
        subset=["item_id", "store_id", "date"], keep="last")

    all_days = pd.DataFrame({"date": [_DAY_TO_DATE[d] for d in build_days]})
    wanted_dates = set(all_days["date"])
    series_by_item: dict[str, pd.Series] = {}
    for row in sales_sel.itertuples():
        p = prices[(prices["item_id"] == row.item_id)
                   & (prices["store_id"] == row.store_id)][["date", "sell_price"]]
        merged = all_days.merge(p, on="date", how="left")
        s = merged.set_index("date")["sell_price"].ffill()
        s.index = pd.DatetimeIndex(s.index)
        series_by_item[row.item_id] = s[s.index.isin(wanted_dates)]
    return series_by_item


def build_item_frame(row, price_by_item, event_flags, build_days,
                     window_days) -> pd.DataFrame:
    """Features for one item over warmup+window; only the window is kept."""
    item_id = row.item_id
    price_series = price_by_item[item_id].reindex(
        pd.DatetimeIndex(_DAY_TO_DATE[d] for d in build_days))
    df = pd.DataFrame({
        "d": build_days,
        "price": price_series.to_numpy(),
        "units_sold": [float(getattr(row, d)) for d in build_days],
    })
    df["date"] = df["d"].map(_DAY_TO_DATE)
    # Leakage-safe rolling means: previous days only (ai.md §7/§8).
    df["sales_7d_avg"] = df["units_sold"].shift(1).rolling(7).mean()
    df["sales_30d_avg"] = df["units_sold"].shift(1).rolling(30).mean()
    prev_price = df["price"].shift(1)
    with np.errstate(invalid="ignore", divide="ignore"):
        change = np.where(
            prev_price.notna() & (prev_price != 0),
            (df["price"] - prev_price) / prev_price * 100.0,
            0.0,
        )
    df["price_change_percent"] = change
    df["day_of_week"] = df["date"].dt.weekday      # Monday = 0 (ai.md §7)
    df["month"] = df["date"].dt.month              # 1-12
    df["event"] = df["d"].map(event_flags).fillna(False).astype(int)
    df["product_id"] = item_id
    df["category"] = row.project_category
    df = df[df["d"].isin(window_days)]
    df = df.dropna(subset=["price", "sales_7d_avg", "sales_30d_avg"])
    return df


def main() -> int:
    PROCESSED.mkdir(parents=True, exist_ok=True)
    MODEL.mkdir(parents=True, exist_ok=True)

    print("Loading M5 inputs...")
    cal = load_calendar()
    _DAY_TO_DATE.update(dict(zip(cal["d"], cal["date"])))

    all_days = [f"d_{n}" for n in range(1, M5_LAST_DAY + 1)]
    window_days = all_days[-TARGET_DAYS:]
    # Build over warm-up (30 days) + window so rolling means cover the window.
    build_days = all_days[-(TARGET_DAYS + WARMUP_DAYS):]

    sales = pd.read_csv(
        RAW / "sales_train_validation.csv",
        usecols=lambda c: c in ("id", "item_id", "dept_id", "cat_id", "store_id")
        or c in set(all_days),
    )
    sales_sel = select_products(sales, window_days)
    sales_sel = pick_best_store_row(sales_sel, window_days)
    print(f"Selected {len(sales_sel)} products; categories: "
          f"{sorted(sales_sel['cat_id'].unique())}")

    print("Building price series...")
    price_by_item = build_prices(sales_sel, cal, build_days)
    event_flags = cal.set_index("d")["event_name_1"].notna() | \
        cal.set_index("d")["event_name_2"].notna()

    frames = []
    for i, row in enumerate(sales_sel.itertuples(), 1):
        frames.append(build_item_frame(row, price_by_item, event_flags,
                                       build_days, window_days))
        if i % 100 == 0:
            print(f"  built features for {i} products")

    data = pd.concat(frames, ignore_index=True)
    data = data.sort_values(["date", "product_id"]).reset_index(drop=True)
    print(f"Dataset: {len(data):,} rows, {data['product_id'].nunique()} products, "
          f"{data['date'].min().date()} -> {data['date'].max().date()}")

    # Chronological 70/15/15 split (ai.md §9): never shuffled.
    dates = np.sort(data["date"].unique())
    t70 = int(len(dates) * 0.70)
    t85 = int(len(dates) * 0.85)
    splits = {
        "train.csv": set(dates[:t70]),
        "validation.csv": set(dates[t70:t85]),
        "test.csv": set(dates[t85:]),
    }
    counts = {}
    for name, ds in splits.items():
        part = data[data["date"].isin(ds)]
        counts[name] = len(part)
        part[FEATURES + [TARGET]].to_csv(PROCESSED / name, index=False)

    # Encoded-id mappings reused at inference (ai.md §7/§31).
    product_mapping = {
        pid: i for i, pid in enumerate(sorted(data["product_id"].unique()))
    }
    category_mapping = {str(c): int(c) for c in sorted(data["category"].unique())}
    # product_id -> training category. Inference must reuse the *stored* category
    # encoding instead of inventing one (ai.md §7/§31); the project grouping above is
    # not derivable from the M5 product id, so it has to be persisted.
    product_category = {
        pid: int(cat) for pid, cat in
        zip(data["product_id"], data["category"])
    }
    (MODEL / "product_mapping.json").write_text(json.dumps(product_mapping, indent=2))
    (MODEL / "category_mapping.json").write_text(json.dumps(category_mapping, indent=2))
    (MODEL / "product_category.json").write_text(json.dumps(product_category, indent=2))

    metadata = {
        "features": FEATURES,
        "target": TARGET,
        "training_period": "3 years",
        "product_count": int(data["product_id"].nunique()),
        "date_range": {
            "start": str(data["date"].min().date()),
            "end": str(data["date"].max().date()),
        },
        "rows": counts,
        "objective": "reg:squarederror",
        "hyperparameters": {
            "max_depth": 6, "eta": 0.1, "subsample": 0.8,
            "colsample_bytree": 0.8, "num_round": 300,
        },
    }
    (MODEL / "model_metadata.json").write_text(json.dumps(metadata, indent=2))

    print(f"Wrote train={counts['train.csv']:,} "
          f"validation={counts['validation.csv']:,} test={counts['test.csv']:,}")
    print(f"Wrote mappings + metadata to {MODEL}")
    return 0


if __name__ == "__main__":
    sys.exit(main())