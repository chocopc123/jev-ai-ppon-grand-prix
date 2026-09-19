#!/usr/bin/env bash
set -e

echo "========================================================"
echo "  OOGIRI GRAND PRIX - Google Cloud Run デプロイスクリプト"
echo "========================================================"
echo ""

# 1. GCP プロジェクトの確認
CURRENT_PROJECT=$(gcloud config get-value project 2>/dev/null || true)
if [ -z "$CURRENT_PROJECT" ] || [ "$CURRENT_PROJECT" = "(unset)" ]; then
    echo -e "\033[31m[ERROR] gcloud のプロジェクトが設定されていません。\033[0m"
    echo -e "\033[33m先に 'gcloud config set project <PROJECT_ID>' を実行してください。\033[0m"
    exit 1
fi

echo -e "\033[32m現在のGCPプロジェクト: $CURRENT_PROJECT\033[0m"
echo ""

# 2. API キーの取得 (.env から読み込み、無ければ入力プロンプト)
API_KEY=""
if [ -f ".env" ]; then
    API_KEY=$(grep -E '^OPENROUTER_API_KEY=' .env | cut -d '=' -f2- | tr -d '"' | tr -d "'" | tr -d '\r')
fi

if [ -z "$API_KEY" ]; then
    read -p "OpenRouter API Key (sk-or-...): " API_KEY
fi

if [ -z "$API_KEY" ]; then
    echo -e "\033[31m[ERROR] APIキーが指定されていません。\033[0m"
    exit 1
fi

echo -e "\033[36m[1/2] 必要な Google Cloud API を有効化中...\033[0m"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com

echo ""
echo -e "\033[36m[2/2] Cloud Run へソースデプロイ中 (東京リージョン: asia-northeast1)...\033[0m"

gcloud run deploy oogiri-grand-prix \
  --source . \
  --region asia-northeast1 \
  --platform managed \
  --allow-unauthenticated \
  --min-instances 1 \
  --max-instances 1 \
  --cpu 1 \
  --memory 512Mi \
  --timeout 3600 \
  --concurrency 80 \
  --set-env-vars "OPENROUTER_API_KEY=${API_KEY},THEME_TIME_LIMIT=150,TARGET_IPPON=3"

echo ""
echo "========================================================"
echo "  デプロイが完了しました！ 上記の Service URL を開いてください。"
echo "========================================================"
