#!/usr/bin/env bash
set -e

echo "=================================================="
echo "  AI-PPON GRAND PRIX - Google Cloud Run デプロイスクリプト"
echo "=================================================="
echo ""

# 1. GCP プロジェクトの確認
CURRENT_PROJECT=$(gcloud config get-value project 2>/dev/null || true)
if [ -z "$CURRENT_PROJECT" ] || [[ "$CURRENT_PROJECT" == *"unset"* ]]; then
    echo -e "\033[31m[ERROR] gcloud のプロジェクトが設定されていません。\033[0m"
    echo -e "\033[33m先に 'gcloud config set project <PROJECT_ID>' を実行してください。\033[0m"
    exit 1
fi

echo -e "\033[32m現在のGCPプロジェクト: $CURRENT_PROJECT\033[0m"
echo ""

# 2. API キーと Discord 設定の取得 (.env から読み込み、無ければ入力プロンプト)
API_KEY=""
DISCORD_CLIENT_ID=""
DISCORD_CLIENT_SECRET=""

if [ -f ".env" ]; then
    API_KEY=$(grep -E '^OPENROUTER_API_KEY=' .env | cut -d '=' -f2- | tr -d '"' | tr -d "'" | tr -d '\r')
    DISCORD_CLIENT_ID=$(grep -E '^DISCORD_CLIENT_ID=' .env | cut -d '=' -f2- | tr -d '"' | tr -d "'" | tr -d '\r')
    DISCORD_CLIENT_SECRET=$(grep -E '^DISCORD_CLIENT_SECRET=' .env | cut -d '=' -f2- | tr -d '"' | tr -d "'" | tr -d '\r')
fi

if [ -z "$API_KEY" ]; then
    read -p "OpenRouter API Key (sk-or-...): " API_KEY
fi

if [ -z "$API_KEY" ]; then
    echo -e "\033[31m[ERROR] APIキーが指定されていません。\033[0m"
    exit 1
fi

echo -e "\033[36m[1/3] 必要な Google Cloud API を有効化中...\033[0m"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com

echo ""
echo -e "\033[36m[2/3] Secret Manager (GEMINI_API_KEY) のアクセス権限を確認・付与中...\033[0m"
PROJECT_NUM=$(gcloud projects describe "$CURRENT_PROJECT" --format="value(projectNumber)")
SERVICE_ACCOUNT="${PROJECT_NUM}-compute@developer.gserviceaccount.com"

# シークレットが存在する場合にアクセス権限を付与 (存在しない場合は警告を表示してスキップ)
if gcloud secrets describe GEMINI_API_KEY --project="$CURRENT_PROJECT" >/dev/null 2>&1; then
    gcloud secrets add-iam-policy-binding GEMINI_API_KEY \
      --project="$CURRENT_PROJECT" \
      --member="serviceAccount:${SERVICE_ACCOUNT}" \
      --role="roles/secretmanager.secretAccessor" \
      --condition=None >/dev/null 2>&1 || true
    SECRET_FLAG="--set-secrets GEMINI_API_KEY=GEMINI_API_KEY:latest"
    echo -e "\033[32mGEMINI_API_KEY のシークレットバインドを設定しました。\033[0m"
else
    echo -e "\033[33m[WARN] Secret Manager に 'GEMINI_API_KEY' が見つかりませんでした。\033[0m"
    echo -e "\033[33m事前に GCP コンソール等で 'GEMINI_API_KEY' シークレットを作成してください。\033[0m"
    SECRET_FLAG=""
fi

echo ""
echo -e "\033[36m[3/3] Cloud Run へソースデプロイ中 (東京リージョン: asia-northeast1)...\033[0m"

ENV_VARS="OPENROUTER_API_KEY=${API_KEY},THEME_TIME_LIMIT=150,TARGET_IPPON=3"
if [ -n "$DISCORD_CLIENT_ID" ]; then
    ENV_VARS="${ENV_VARS},DISCORD_CLIENT_ID=${DISCORD_CLIENT_ID}"
fi
if [ -n "$DISCORD_CLIENT_SECRET" ]; then
    ENV_VARS="${ENV_VARS},DISCORD_CLIENT_SECRET=${DISCORD_CLIENT_SECRET}"
fi

gcloud run deploy ai-ppon-grand-prix \
  --source . \
  --region asia-northeast1 \
  --platform managed \
  --allow-unauthenticated \
  --min-instances 0 \
  --max-instances 1 \
  --cpu 1 \
  --memory 512Mi \
  --timeout 3600 \
  --concurrency 80 \
  --set-env-vars "${ENV_VARS}" \
  ${SECRET_FLAG}

echo ""
echo "=================================================="
echo "  デプロイが完了しました！ 上記の Service URL を開いてください。"
echo "=================================================="
