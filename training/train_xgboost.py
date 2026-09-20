#!/usr/bin/env python3
"""
train_xgboost.py — trains the single XGBoost model per ai.md §6/§10/§11.

The deployed artifact must be loadable by the ``sagemaker-xgboost:1.7-1``
inference container (xgboost **1.7.4**). A model saved by a newer xgboost is
written in UBJSON, which 1.7.4 cannot read, so the artifact is trained locally
with xgboost 1.7.4 in an isolated venv (``build`` mode). SageMaker training
jobs are not used: this account's ap-south-1 training-instance quota is 0.

Modes:
  local      — CPU dry-run with the repo's xgboost (free); artifact is NOT deployable
  build      — train with xgboost 1.7.4, publish model.tar.gz + metadata  ← use this
  sagemaker  — submits ONE SageMaker built-in XGBoost job (blocked: training quota is 0)
  eval       — re-scores the published S3 artifact with the venv's xgboost 1.7.4
  serve      — build + deploy serverless endpoint + smoke test
  deploy     — deploy the published S3 artifact + smoke test
  smoke      — re-test an existing endpoint

``build`` and ``eval`` run inside ``data/model/build/venv`` (xgboost 1.7.4): the
serving container cannot read a model written by a newer xgboost (UBJSON) and the
repo interpreter (xgboost 3.x) cannot read the container's ``binf`` artifact.

Usage:
  python training/train_xgboost.py local
  python training/train_xgboost.py build
  python training/train_xgboost.py serve
  python training/train_xgboost.py deploy
  python training/train_xgboost.py smoke
"""

import argparse
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
PROCESSED = REPO / "data" / "processed"
MODEL = REPO / "data" / "model"
# Headerless, label-first, numeric-only CSV consumed by the built-in algorithm (ai.md §10).
SM_PROCESSED = PROCESSED / "sagemaker"

# S3 layout from ai.md §5 (one bucket, fixed keys). There is exactly ONE processed
# location, ``pricing-ai/processed/``, and it holds the built-in algorithm's
# headerless, label-first, numeric-only CSV splits (what XGBoost consumes).
MODEL_PREFIX = "pricing-ai/model/xgboost"
MODEL_KEY = f"{MODEL_PREFIX}/model.tar.gz"
JOB_PREFIX = f"{MODEL_PREFIX}/jobs"
SM_INPUT_PREFIX = "pricing-ai/processed"

# The endpoint is SERVERLESS: it scales to zero and needs no `ml.*` instance
# quota (the account's provisioned-endpoint quota is 0 in ap-south-1).
ENDPOINT_NAME = "pricing-xgboost-endpoint"
SERVERLESS_MEMORY_MB = 3072
SERVERLESS_MAX_CONCURRENCY = 1

# Locally built, container-compatible artifact (xgboost 1.7.4 + xgboost-model only).
BUILD_DIR = MODEL / "build"
# The container's own xgboost (1.7.4) lives here; the repo interpreter (3.x) can
# neither write a container-readable artifact nor read the container's `binf` model.
BUILD_VENV_PYTHON = BUILD_DIR / "venv" / "Scripts" / "python.exe"
EVAL_SCRIPT = REPO / "training" / "eval_artifact.py"

# Execution role used by create_model / endpoint hosting (ai.md §5).
SAGEMAKER_ROLE_ARN = "arn:aws:iam::780891107631:role/mercury-sagemaker-exec"

FEATURES = ["price", "day_of_week", "month",
            "sales_7d_avg", "sales_30d_avg", "price_change_percent", "event"]
TARGET = "units_sold"

# ai.md §10 hyperparameters + objective.
HPARAMS = {
    "max_depth": 6,
    "eta": 0.1,
    "subsample": 0.8,
    "colsample_bytree": 0.8,
    "num_round": 300,
    "objective": "reg:squarederror",
}


def load_frames():
    import pandas as pd
    # Product-agnostic model: no per-product mapping — the CSV columns are used as-is
    # (product_id/category stay in the frame but are never selected as features).
    frames = {}
    for name in ("train", "validation", "test"):
        frames[name] = pd.read_csv(PROCESSED / f"{name}.csv")
    return frames


def evaluate_local() -> int:
    import numpy as np
    import pandas as pd
    import xgboost as xgb
    from sklearn.metrics import mean_absolute_error, mean_squared_error

    frames = load_frames()

    def xy(df):
        return df[FEATURES].to_numpy(), df[TARGET].to_numpy()

    X_tr, y_tr = xy(frames["train"])
    X_val, y_val = xy(frames["validation"])
    X_te, y_te = xy(frames["test"])

    dtrain = xgb.DMatrix(X_tr, label=y_tr, feature_names=FEATURES)
    dval = xgb.DMatrix(X_val, label=y_val, feature_names=FEATURES)
    dtest = xgb.DMatrix(X_te, feature_names=FEATURES)

    params = {k: v for k, v in HPARAMS.items() if k != "num_round"}
    params["verbosity"] = 1
    print(f"Training locally: {len(X_tr):,} rows, num_round={HPARAMS['num_round']}")
    booster = xgb.train(params, dtrain, num_boost_round=HPARAMS["num_round"],
                        evals=[(dval, "validation")], verbose_eval=100)

    pred = booster.predict(dtest)
    mae = float(mean_absolute_error(y_te, pred))
    rmse = float(np.sqrt(mean_squared_error(y_te, pred)))
    print(f"Local test MAE={mae:.4f} RMSE={rmse:.4f}")

    out = MODEL / "local"
    out.mkdir(exist_ok=True)
    booster.save_model(str(out / "model.json"))
    (out / "evaluation.json").write_text(json.dumps(
        {"mae": round(mae, 4), "rmse": round(rmse, 4)}, indent=2))
    print(f"Saved local model + evaluation to {out}")
    return 0


def write_sagemaker_csv() -> dict:
    """Rewrite the processed splits as built-in XGBoost training CSV.

    The algorithm reads CSV with **no header**, **numeric values only**, and the
    **label as the first column**. The product-agnostic model uses no product_id or
    category feature, so only the contract FEATURES are written (ai.md §7).
    """
    import pandas as pd

    SM_PROCESSED.mkdir(parents=True, exist_ok=True)

    paths = {}
    for name in ("train", "validation", "test"):
        df = pd.read_csv(PROCESSED / f"{name}.csv")

        out = SM_PROCESSED / f"{name}.csv"
        df[[TARGET] + FEATURES].astype("float64").to_csv(
            out, header=False, index=False, float_format="%.6f")
        paths[name] = out
        print(f"wrote {out.name}: {len(df):,} rows (label first, no header)")
    return paths


def s3_uri_to_bucket_key(uri: str) -> tuple:
    """Split ``s3://bucket/key`` into ``(bucket, key)``."""
    if not uri.startswith("s3://"):
        raise ValueError(f"Not an S3 URI: {uri}")
    bucket, _, key = uri[len("s3://"):].partition("/")
    return bucket, key


def validate_model_artifact(bucket: str, key: str = MODEL_KEY) -> list:
    """Fail fast unless ``model.tar.gz`` contains the model file *only*.

    The XGBoost inference container scans every file in ``/opt/ml/model`` and tries to
    load it as a model. Extra metadata JSONs inside the tarball make it pick the wrong
    file and the endpoint dies with "the model process exited", so metadata must live
    next to ``model.tar.gz`` in S3 instead (ai.md §5).
    """
    import io
    import tarfile

    import boto3

    body = boto3.client("s3", region_name=REGION).get_object(
        Bucket=bucket, Key=key)["Body"].read()
    with tarfile.open(fileobj=io.BytesIO(body), mode="r:gz") as tar:
        files = [m.name for m in tar.getmembers() if m.isfile()]

    models = [n for n in files if n.endswith("xgboost-model")]
    if not models:
        raise ValueError(
            f"s3://{bucket}/{key} has no 'xgboost-model' member (found {files}); "
            f"deploy the artifact produced by `train_xgboost.py build`.")
    extra = [n for n in files if n not in models]
    if extra:
        raise ValueError(
            f"s3://{bucket}/{key} contains {extra} alongside the model. Only the model "
            f"file may be inside model.tar.gz (ai.md §5) — repackage with "
            f"`train_xgboost.py build`.")
    return files


def build_venv_python() -> Path:
    """Return the xgboost-1.7.4 interpreter used to build/score the artifact."""
    if not BUILD_VENV_PYTHON.exists():
        raise SystemExit(
            f"build venv missing at {BUILD_VENV_PYTHON}\n"
            f"recreate it with:\n"
            f"  py -3.10 -m venv {BUILD_DIR / 'venv'}\n"
            f"  \"{BUILD_VENV_PYTHON}\" -m pip install xgboost==1.7.4 pandas scikit-learn numpy")
    return BUILD_VENV_PYTHON


def run_in_build_venv(script: Path, args: list = ()) -> int:
    """Run a script with the container-compatible (xgboost 1.7.4) interpreter."""
    import subprocess

    python = build_venv_python()
    print(f"running {script.name} with {python}")
    result = subprocess.run([str(python), str(script), *args])
    return result.returncode


def evaluate_artifact(bucket: str) -> dict:
    """Score the published artifact on the test split in the build venv (ai.md §11).

    xgboost >= 2 (the repo interpreter) cannot read the legacy ``binf`` artifact the
    serving container needs, so the artifact is downloaded here and scored by
    ``training/eval_artifact.py`` under xgboost 1.7.4. Returns the metrics it published.
    """
    import boto3

    BUILD_DIR.mkdir(parents=True, exist_ok=True)
    artifact = BUILD_DIR / "published-model.tar.gz"
    boto3.client("s3", region_name=REGION).download_file(bucket, MODEL_KEY, str(artifact))
    print(f"downloaded s3://{bucket}/{MODEL_KEY} -> {artifact}")
    rc = run_in_build_venv(EVAL_SCRIPT, ["--artifact", str(artifact), "--publish"])
    if rc:
        raise SystemExit(f"artifact scoring failed with exit code {rc}")
    return json.loads((BUILD_DIR / "evaluation.json").read_text())


def publish_metadata(bucket: str, evaluation: dict) -> None:
    """Upload metadata + evaluation as siblings of model.tar.gz (ai.md §5).

    The product-agnostic model has no per-product mappings, so only a freshly
    generated model_metadata.json (features list, target, dataset window) and the
    test metrics are published.
    """
    import boto3

    s3 = boto3.client("s3", region_name=REGION)
    metadata = {
        "algorithm": "xgboost",
        "objective": "reg:squarederror",
        "features": FEATURES,
        "target": TARGET,
        "hyperparameters": HPARAMS,
        "product_agnostic": True,
    }
    s3.put_object(Bucket=bucket, Key=f"{MODEL_PREFIX}/model_metadata.json",
                  Body=json.dumps(metadata, indent=2).encode(),
                  ContentType="application/json")
    (MODEL / "model_metadata.json").write_text(json.dumps(metadata, indent=2))

    payload = json.dumps(evaluation, indent=2)
    s3.put_object(Bucket=bucket, Key=f"{MODEL_PREFIX}/evaluation.json",
                  Body=payload.encode(), ContentType="application/json")
    (MODEL / "evaluation.json").write_text(payload)
    print(f"published metadata + evaluation.json -> s3://{bucket}/{MODEL_PREFIX}/")


def evaluate_published(bucket: str) -> int:
    """Re-score the published artifact on the test split without retraining."""
    write_sagemaker_csv()
    print(f"artifact members: {validate_model_artifact(bucket)}")
    evaluation = evaluate_artifact(bucket)
    print(f"test-set metrics: MAE={evaluation['mae']} RMSE={evaluation['rmse']}")
    publish_metadata(bucket, evaluation)
    return 0


def train_sagemaker(role_arn: str, instance_type: str, bucket: str) -> int:
    """Submit ONE built-in XGBoost training job and publish the artifact (ai.md §10).

    Training inside the container is what makes the artifact loadable by the
    identical ``xgboost:1.7-1`` inference container installed on the endpoint.
    """
    import boto3

    s3 = boto3.client("s3", region_name=REGION)
    sm = boto3.client("sagemaker", region_name=REGION)

    for name, path in write_sagemaker_csv().items():
        key = f"{SM_INPUT_PREFIX}/{name}.csv"
        s3.upload_file(str(path), bucket, key)
        print(f"uploaded s3://{bucket}/{key}")

    def channel(name: str) -> dict:
        return {
            "ChannelName": name,
            "DataSource": {"S3DataSource": {
                "S3DataType": "S3Prefix",
                "S3Uri": f"s3://{bucket}/{SM_INPUT_PREFIX}/{name}.csv",
                "S3DataDistributionType": "FullyReplicated"}},
            "ContentType": "text/csv",
            "CompressionType": "None",
            "RecordWrapperType": "None",
        }

    job = f"mercury-xgb-{pd_now_stamp()}"
    sm.create_training_job(
        TrainingJobName=job,
        # Built-in algorithm mode: image only, no entry point / no AlgorithmName.
        AlgorithmSpecification={
            "TrainingImage": sagemaker_image_uri(),
            "TrainingInputMode": "File",
        },
        RoleArn=role_arn,
        InputDataConfig=[channel("train"), channel("validation")],
        OutputDataConfig={"S3OutputPath": f"s3://{bucket}/{JOB_PREFIX}/"},
        ResourceConfig={"InstanceType": instance_type, "InstanceCount": 1,
                        "VolumeSizeInGB": 30},
        StoppingCondition={"MaxRuntimeInSeconds": 3600},
        HyperParameters={k: str(v) for k, v in HPARAMS.items()},
    )
    print(f"Training job submitted: {job} ({instance_type}, CPU, no GPU)")

    sm.get_waiter("training_job_completed_or_stopped").wait(
        TrainingJobName=job, WaiterConfig={"Delay": 30, "MaxAttempts": 120})
    info = sm.describe_training_job(TrainingJobName=job)
    if info["TrainingJobStatus"] != "Completed":
        print(f"Training job {job} ended as {info['TrainingJobStatus']}: "
              f"{info.get('FailureReason', '')}", file=sys.stderr)
        return 1

    artifact = info["ModelArtifacts"]["S3ModelArtifacts"]
    src_bucket, src_key = s3_uri_to_bucket_key(artifact)
    s3.copy({"Bucket": src_bucket, "Key": src_key}, bucket, MODEL_KEY)
    print(f"published artifact -> s3://{bucket}/{MODEL_KEY}")
    print(f"artifact members: {validate_model_artifact(bucket)}")

    evaluation = evaluate_artifact(bucket)
    print(f"test-set metrics: MAE={evaluation['mae']} RMSE={evaluation['rmse']}")
    publish_metadata(bucket, evaluation)
    return 0


def build_local_artifact(bucket: str) -> int:
    """Build the artifact with the container's own xgboost version (1.7.4).

    Replaces ``sagemaker`` mode, which cannot run: this account's ap-south-1
    training-instance quota is 0, so ``CreateTrainingJob`` always fails. Training
    locally with xgboost 1.7.4 (installed in an isolated venv) produces the
    legacy ``binf`` binary the ``sagemaker-xgboost:1.7-1`` inference container
    can load — a newer xgboost would write UBJSON and the endpoint would die.

    Publishes ``model.tar.gz`` containing **only** ``xgboost-model`` (ai.md §5).
    """
    import boto3

    rc = run_in_build_venv(BUILD_DIR / "build_artifact.py")
    if rc:
        print("artifact build failed", file=sys.stderr)
        return rc

    s3 = boto3.client("s3", region_name=REGION)
    # Clean slate: drop any stale/broken artifact before uploading the new one.
    s3.delete_object(Bucket=bucket, Key=MODEL_KEY)
    s3.upload_file(str(BUILD_DIR / "model.tar.gz"), bucket, MODEL_KEY)
    print(f"published s3://{bucket}/{MODEL_KEY}")
    print(f"artifact members: {validate_model_artifact(bucket)}")

    eval_path = BUILD_DIR / "evaluation.json"
    if eval_path.exists():
        evaluation = json.loads(eval_path.read_text())
        print(f"test-set metrics: MAE={evaluation.get('mae')} "
              f"RMSE={evaluation.get('rmse')}")
        publish_metadata(bucket, evaluation)
    return 0


def deploy_serverless(bucket: str, role_arn: str,
                      max_concurrency: int = SERVERLESS_MAX_CONCURRENCY,
                      memory_mb: int = SERVERLESS_MEMORY_MB) -> int:
    """Create model + SERVERLESS endpoint config + endpoint (scales to zero)."""
    import boto3
    from datetime import datetime, timezone

    sm = boto3.client("sagemaker", region_name=REGION)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")

    model_data = f"s3://{bucket}/{MODEL_KEY}"
    image = sagemaker_image_uri()
    model_name = f"mercury-xgb-{stamp}"
    sm.create_model(
        ModelName=model_name,
        ExecutionRoleArn=role_arn,
        PrimaryContainer={"Image": image, "ModelDataUrl": model_data},
    )
    print(f"Model created: {model_name}")
    print(f"  image: {image}")
    print(f"  model: {model_data}")

    config = f"mercury-xgb-serverless-{stamp}"
    sm.create_endpoint_config(
        EndpointConfigName=config,
        ProductionVariants=[{
            "VariantName": "AllTraffic",
            "ModelName": model_name,
            "ServerlessConfig": {
                "MaxConcurrency": max_concurrency,
                "MemorySizeInMB": memory_mb,
            },
        }],
    )
    print(f"Serverless endpoint config created: {config}")

    endpoint = ENDPOINT_NAME
    try:
        status = sm.describe_endpoint(EndpointName=endpoint)["EndpointStatus"]
    except sm.exceptions.ClientError as err:
        if "Could not find endpoint" not in str(err):
            raise
        status = None

    if status is None:
        sm.create_endpoint(EndpointName=endpoint, EndpointConfigName=config)
        print(f"Endpoint creation started: {endpoint} -> {config}")
    else:
        if status == "Failed":
            # SageMaker will not update a Failed endpoint in place reliably; a
            # delete + create is the deterministic path (deletion needs no quota).
            print(f"Endpoint {endpoint} is Failed; recreating it")
            sm.delete_endpoint(EndpointName=endpoint)
            sm.get_waiter("endpoint_deleted").wait(
                EndpointName=endpoint, WaiterConfig={"Delay": 15, "MaxAttempts": 40})
            sm.create_endpoint(EndpointName=endpoint, EndpointConfigName=config)
            print(f"Endpoint creation started: {endpoint} -> {config}")
        else:
            print(f"Endpoint {endpoint} is {status}; updating to {config}")
            sm.update_endpoint(EndpointName=endpoint, EndpointConfigName=config)

    waiter = sm.get_waiter("endpoint_in_service")
    try:
        waiter.wait(EndpointName=endpoint,
                    WaiterConfig={"Delay": 20, "MaxAttempts": 45})
    except Exception:
        info = sm.describe_endpoint(EndpointName=endpoint)
        print(f"Endpoint {endpoint} did not reach InService: "
              f"{info['EndpointStatus']} — {info.get('FailureReason', '')}",
              file=sys.stderr)
        return 1
    print(f"Endpoint {endpoint} is InService")
    return 0


def smoke_test(bucket: str) -> int:
    """Invoke the endpoint once with a real row from the encoded test split.

    The payload is read from the same headerless, label-first CSV the model was
    trained on, so ``product_id``/``category`` use the identical encoding. Sending
    a raw row would pass ``category`` as a string and the container's numeric CSV
    parser would reject it.
    """
    import boto3
    import pandas as pd

    sm = boto3.client("sagemaker-runtime", region_name=REGION)
    df = pd.read_csv(SM_PROCESSED / "test.csv", header=None,
                     names=[TARGET] + FEATURES)
    row = df[FEATURES].iloc[0].to_numpy()
    payload = ",".join(f"{v:.6f}" for v in row)
    resp = sm.invoke_endpoint(
        EndpointName=ENDPOINT_NAME,
        ContentType="text/csv",
        Body=payload,
    )
    prediction = float(resp["Body"].read().decode())
    actual = df[TARGET].iloc[0]
    print(f"payload={payload}")
    print(f"predicted_units={prediction:.3f} (actual={actual})")
    return 0


# XGBoost 1.7-1 container image URI per region (AWS SageMaker pre-built images).
# These are the official SageMaker-owned account IDs and the 'sagemaker-xgboost'
# repository name, as returned by sagemaker.image_uris.retrieve("xgboost", <region>, "1.7-1").
# NOTE: the previous table used a non-existent account/repo (e.g. 294414281381...xgboost)
# which is the root cause of the `ValidationException: ... cannot pull ...` error.
_XGBOOST_IMAGES = {
    "ap-south-1": "720646828776.dkr.ecr.ap-south-1.amazonaws.com/sagemaker-xgboost:1.7-1",
    "us-east-1":  "683313688378.dkr.ecr.us-east-1.amazonaws.com/sagemaker-xgboost:1.7-1",
    "us-east-2":  "257758044811.dkr.ecr.us-east-2.amazonaws.com/sagemaker-xgboost:1.7-1",
    "us-west-2":  "246618743249.dkr.ecr.us-west-2.amazonaws.com/sagemaker-xgboost:1.7-1",
}


def sagemaker_image_uri() -> str:
    """Return the SageMaker XGBoost 1.7-1 container URI for the configured region.

    Prefers the SageMaker SDK's ``image_uris.retrieve`` (the authoritative source
    for the AWS-owned ECR URI per region, including the correct account ID and the
    ``sagemaker-xgboost`` repository name). Handles both the SDK v3 layout
    (``sagemaker.core.image_uris``) and the legacy v2 layout
    (``sagemaker.image_uris``), and falls back to the verified per-region table in
    ``_XGBOOST_IMAGES``.
    """
    # Authoritative source: the SDK. Handles both SDK v2 and v3 import layouts.
    try:
        try:
            from sagemaker.core import image_uris  # SDK v3 layout
        except ImportError:
            import sagemaker  # SDK v2 layout
            image_uris = sagemaker.image_uris
        return image_uris.retrieve("xgboost", REGION, version="1.7-1")
    except Exception:
        pass
    # Verified fallback table.
    try:
        return _XGBOOST_IMAGES[REGION]
    except KeyError:
        raise ValueError(
            f"No XGBoost 1.7-1 image for region '{REGION}'. "
            f"Install the sagemaker SDK or add it to _XGBOOST_IMAGES.")


def pd_now_stamp() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")


REGION = "ap-south-1"
BUCKET = "pricing-ai-780891107631"


def main() -> int:
    import argparse
    ap = argparse.ArgumentParser(description="Train XGBoost on the M5-derived MVP dataset (ai.md).")
    ap.add_argument("mode",
                   choices=["local", "build", "sagemaker", "eval", "serve",
                            "deploy", "smoke"],
                   help="local=dry-run on CPU; "
                        "build=train with the container's xgboost 1.7.4 and publish model.tar.gz "
                        "(no SageMaker quota needed; use this instead of sagemaker); "
                        "sagemaker=submit one SageMaker training job (blocked: account training quota is 0); "
                        "eval=re-score the published S3 artifact with the container's xgboost 1.7.4 (build venv); "
                        "serve=build + deploy serverless endpoint + smoke-test; "
                        "deploy=deploy serverless endpoint from the existing S3 artifact; "
                        "smoke=smoke-test the existing endpoint")
    ap.add_argument("--role-arn", default=None, help="SageMaker execution role ARN (required for sagemaker/serve/deploy)")
    ap.add_argument("--instance", default="ml.m5.large",
                    help="SageMaker training instance type (default: ml.m5.large — cheapest CPU option)")
    args = ap.parse_args()

    role = args.role_arn
    if args.mode in ("sagemaker", "serve", "deploy") and not role:
        role = SAGEMAKER_ROLE_ARN
        print(f"--role-arn not given; defaulting to {role}")

    if args.mode == "local":
        return evaluate_local()
    if args.mode == "build":
        return build_local_artifact(BUCKET)
    if args.mode == "sagemaker":
        return train_sagemaker(role, args.instance, BUCKET)
    if args.mode == "eval":
        return evaluate_published(BUCKET)
    if args.mode == "serve":
        rc = build_local_artifact(BUCKET)
        if rc:
            return rc
        rc = deploy_serverless(BUCKET, role)
        if rc:
            return rc
        return smoke_test(BUCKET)
    if args.mode == "deploy":
        rc = deploy_serverless(BUCKET, role)
        if rc:
            return rc
        return smoke_test(BUCKET)
    if args.mode == "smoke":
        return smoke_test(BUCKET)


if __name__ == "__main__":
    sys.exit(main())
