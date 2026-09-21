[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$Host.UI.RawUI.WindowTitle = "AI-PPON GRAND PRIX - GCP Cloud Run Deploy"

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "  AI-PPON GRAND PRIX - Google Cloud Run デプロイスクリプト" -ForegroundColor Cyan
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

# 2. API キーと Discord 設定の取得 (.env から読み込み、無ければ入力プロンプト)
$apiKey = ""
$discordClientId = ""
$discordClientSecret = ""

if (Test-Path ".env") {
    Get-Content ".env" | ForEach-Object {
        if ($_ -match "^\s*TYPESAFE_API_KEY\s*=\s*(.+)$") {
            $apiKey = $matches[1].Trim().Trim('"').Trim("'")
        }
        elseif ([string]::IsNullOrWhiteSpace($apiKey) -and $_ -match "^\s*OPENROUTER_API_KEY\s*=\s*(.+)$") {
            $apiKey = $matches[1].Trim().Trim('"').Trim("'")
        }
        if ($_ -match "^\s*DISCORD_CLIENT_ID\s*=\s*(.+)$") {
            $discordClientId = $matches[1].Trim().Trim('"').Trim("'")
        }
        if ($_ -match "^\s*DISCORD_CLIENT_SECRET\s*=\s*(.+)$") {
            $discordClientSecret = $matches[1].Trim().Trim('"').Trim("'")
        }
    }
}

if ([string]::IsNullOrWhiteSpace($apiKey)) {
    $apiKey = Read-Host "TypeSafe API Key (apikey_...)"
}

if ([string]::IsNullOrWhiteSpace($apiKey)) {
    Write-Host "[ERROR] APIキーが指定されていません。" -ForegroundColor Red
    exit 1
}

Write-Host "[1/3] 必要な Google Cloud API を有効化中..." -ForegroundColor Cyan
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com

Write-Host ""
Write-Host "[2/3] Secret Manager (GEMINI_API_KEY) のアクセス権限を確認・付与中..." -ForegroundColor Cyan
$projectNum = (gcloud projects describe $currentProject --format="value(projectNumber)" 2>$null).Trim()
$serviceAccount = "${projectNum}-compute@developer.gserviceaccount.com"

$secretFlag = @()
$hasSecret = (gcloud secrets describe GEMINI_API_KEY --project=$currentProject 2>$null)
if ($LASTEXITCODE -eq 0) {
    gcloud secrets add-iam-policy-binding GEMINI_API_KEY `
      --project=$currentProject `
      --member="serviceAccount:$serviceAccount" `
      --role="roles/secretmanager.secretAccessor" `
      --condition=None 2>$null | Out-Null
    $secretFlag = @("--set-secrets", "GEMINI_API_KEY=GEMINI_API_KEY:latest")
    Write-Host "GEMINI_API_KEY のシークレットバインドを設定しました。" -ForegroundColor Green
} else {
    Write-Host "[WARN] Secret Manager に 'GEMINI_API_KEY' が見つかりませんでした。" -ForegroundColor Yellow
    Write-Host "事前に GCP コンソール等で 'GEMINI_API_KEY' シークレットを作成してください。" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "[3/3] Cloud Run へソースデプロイ中 (東京リージョン: asia-northeast1)..." -ForegroundColor Cyan

$envVarsList = @("TYPESAFE_API_KEY=$apiKey", "THEME_TIME_LIMIT=150", "TARGET_IPPON=3")
if ($discordClientId) {
    $envVarsList += "DISCORD_CLIENT_ID=$discordClientId"
}
if ($discordClientSecret) {
    $envVarsList += "DISCORD_CLIENT_SECRET=$discordClientSecret"
}
$envVars = $envVarsList -join ","

$deployArgs = @(
  "run", "deploy", "ai-ppon-grand-prix",
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
  "--set-env-vars", $envVars
) + $secretFlag

& gcloud $deployArgs

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "========================================================" -ForegroundColor Green
    Write-Host "  デプロイが完了しました！ 上記の Service URL を開いてください。" -ForegroundColor Green
    Write-Host "========================================================" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "[ERROR] デプロイに失敗しました。エラーメッセージを確認してください。" -ForegroundColor Red
}
