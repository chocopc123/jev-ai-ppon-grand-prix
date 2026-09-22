#!/usr/bin/env python3
"""
AI-PPON GRAND PRIX - Google Cloud Run Deploy Script
Python 標準ライブラリのみで動作するクロスプラットフォームデプロイスクリプト
"""
import os
import re
import subprocess
import sys


def run_cmd(cmd: list[str] | str, check: bool = True, shell: bool = False) -> subprocess.CompletedProcess:
    """コマンドを標準出力・エラー出力をそのまま流して実行する"""
    return subprocess.run(cmd, check=check, shell=shell)


def get_cmd_output(cmd: list[str] | str, shell: bool = False) -> str:
    """コマンドの標準出力を取得する（エラー時は空文字）"""
    try:
        res = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            shell=shell,
        )
        return res.stdout.strip()
    except Exception:
        return ""


def load_env_file() -> dict[str, str]:
    """ .env ファイルをパースして辞書で返す """
    env_vars = {}
    if not os.path.exists(".env"):
        return env_vars
    with open(".env", "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            match = re.match(r"^([^=]+)=(.*)$", line)
            if match:
                k = match.group(1).strip()
                v = match.group(2).strip().strip("'\"")
                env_vars[k] = v
    return env_vars


def main():
    print("==================================================")
    print("  AI-PPON GRAND PRIX - Google Cloud Run Deploy")
    print("==================================================\n")

    # 1. GCP プロジェクトの確認
    current_project = get_cmd_output(["gcloud", "config", "get-value", "project"], shell=sys.platform == "win32")
    if not current_project or "unset" in current_project.lower():
        print("\033[31m[ERROR] gcloud のプロジェクトが設定されていません。\033[0m")
        print("\033[33m先に 'gcloud config set project <PROJECT_ID>' を実行してください。\033[0m")
        sys.exit(1)
    print(f"\033[32m現在のGCPプロジェクト: {current_project}\033[0m\n")

    # 2. .env から設定読み込み
    env_data = load_env_file()
    api_key = env_data.get("TYPESAFE_API_KEY") or env_data.get("OPENROUTER_API_KEY") or ""
    discord_client_id = env_data.get("DISCORD_CLIENT_ID", "")
    discord_client_secret = env_data.get("DISCORD_CLIENT_SECRET", "")

    if not api_key:
        api_key = input("TypeSafe API Key (apikey_...): ").strip()

    if not api_key:
        print("\033[31m[ERROR] APIキーが指定されていません。\033[0m")
        sys.exit(1)

    print("\033[36m[1/3] 必要な Google Cloud API を有効化中...\033[0m")
    run_cmd(
        [
            "gcloud", "services", "enable",
            "run.googleapis.com",
            "cloudbuild.googleapis.com",
            "artifactregistry.googleapis.com",
            "secretmanager.googleapis.com",
        ],
        shell=sys.platform == "win32",
    )

    print("\n\033[36m[2/3] Secret Manager (GEMINI_API_KEY) の権限を確認中...\033[0m")
    project_num = get_cmd_output(
        ["gcloud", "projects", "describe", current_project, "--format=value(projectNumber)"],
        shell=sys.platform == "win32",
    )
    service_account = f"{project_num}-compute@developer.gserviceaccount.com"

    secret_flag = []
    secret_desc = get_cmd_output(
        ["gcloud", "secrets", "describe", "GEMINI_API_KEY", f"--project={current_project}"],
        shell=sys.platform == "win32",
    )
    if secret_desc and "ERROR" not in secret_desc:
        try:
            get_cmd_output(
                [
                    "gcloud", "secrets", "add-iam-policy-binding", "GEMINI_API_KEY",
                    f"--project={current_project}",
                    f"--member=serviceAccount:{service_account}",
                    "--role=roles/secretmanager.secretAccessor",
                    "--condition=None",
                ],
                shell=sys.platform == "win32",
            )
            secret_flag = ["--set-secrets", "GEMINI_API_KEY=GEMINI_API_KEY:latest"]
            print("\033[32mGEMINI_API_KEY のシークレットバインドを設定しました。\033[0m")
        except Exception:
            pass
    else:
        print("\033[33m[WARN] Secret Manager に 'GEMINI_API_KEY' が見つかりませんでした (スキップ)。\033[0m")

    print("\n\033[36m[3/3] Cloud Run へソースデプロイ中 (asia-northeast1)...\033[0m")
    env_vars = f"TYPESAFE_API_KEY={api_key},THEME_TIME_LIMIT=150,TARGET_IPPON=3"
    if discord_client_id:
        env_vars += f",DISCORD_CLIENT_ID={discord_client_id}"
    if discord_client_secret:
        env_vars += f",DISCORD_CLIENT_SECRET={discord_client_secret}"

    deploy_cmd = [
        "gcloud", "run", "deploy", "ai-ppon-grand-prix",
        "--source", ".",
        "--region", "asia-northeast1",
        "--platform", "managed",
        "--allow-unauthenticated",
        "--min-instances", "0",
        "--max-instances", "1",
        "--cpu", "1",
        "--memory", "512Mi",
        "--timeout", "3600",
        "--concurrency", "80",
        f"--set-env-vars={env_vars}",
    ] + secret_flag

    run_cmd(deploy_cmd, shell=sys.platform == "win32")

    print("\n==================================================")
    print("  デプロイが完了しました！ 上記の Service URL を開いてください。")
    print("==================================================")


if __name__ == "__main__":
    main()
