[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$Host.UI.RawUI.WindowTitle = "OOGIRI GRAND PRIX - GCP Cloud Run Deploy"

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "  OOGIRI GRAND PRIX - Google Cloud Run デプロイスクリプト" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host ""

# 1. GCP プロジェクトの確認
$rawProject = (gcloud config get-value project 2>$null)
$currentProject = if ($rawProject) { $rawProject.Trim() } else { "" }
if ([string]::IsNullOrWhiteSpace($currentProject) -or $currentProject -like "*unset*") {
    Write-Host "[ERROR] gcloud のプロジェクトが設定されていません。" -ForegroundColor Red
    Write-Host "先に 'gcloud config set project <PROJECT_ID>' を実行してください。" -ForegroundColor Yellow
    exit 1
}

Write-Host "現在のGCPプロジェクト: $currentProject" -ForegroundColor Green
Write-Host ""

# 2. API キーの取得 (.env から読み込み、無ければ入力プロンプト)
$apiKey = ""
if (Test-Path ".env") {
    Get-Content ".env" | ForEach-Object {
        if ($_ -match "^\s*OPENROUTER_API_KEY\s*=\s*(.+)$") {
            $apiKey = $matches[1].Trim().Trim('"').Trim("'")
        }
    }
}

if ([string]::IsNullOrWhiteSpace($apiKey)) {
    $apiKey = Read-Host "OpenRouter API Key (sk-or-...)"
}

if ([string]::IsNullOrWhiteSpace($apiKey)) {
    Write-Host "[ERROR] APIキーが指定されていません。" -ForegroundColor Red
    exit 1
}

Write-Host "[1/2] 必要な Google Cloud API を有効化中..." -ForegroundColor Cyan
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com

Write-Host ""
Write-Host "[2/2] Cloud Run へソースデプロイ中 (東京リージョン: asia-northeast1)..." -ForegroundColor Cyan

$envVars = "OPENROUTER_API_KEY=$apiKey,THEME_TIME_LIMIT=150,TARGET_IPPON=3"

gcloud run deploy oogiri-grand-prix `
  --source . `
  --region asia-northeast1 `
  --platform managed `
  --allow-unauthenticated `
  --min-instances 0 `
  --max-instances 1 `
  --cpu 1 `
  --memory 512Mi `
  --timeout 3600 `
  --concurrency 80 `
  --set-env-vars $envVars

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "========================================================" -ForegroundColor Green
    Write-Host "  デプロイが完了しました！ 上記の Service URL を開いてください。" -ForegroundColor Green
    Write-Host "========================================================" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "[ERROR] デプロイに失敗しました。エラーメッセージを確認してください。" -ForegroundColor Red
}
