@echo off
chcp 65001 > nul
echo ========================================================
echo   IPPON GP Web - Google Cloud Run デプロイスクリプト
echo ========================================================
echo.

REM プロジェクトIDの確認
for /f "tokens=*" %%i in ('gcloud config get-value project 2^>nul') do set CURRENT_PROJECT=%%i
if "%CURRENT_PROJECT%"=="" (
    echo [ERROR] gcloud のプロジェクトが設定されていません。
    echo 'gcloud config set project <PROJECT_ID>' を実行してください。
    exit /b 1
)

echo 現在のGCPプロジェクト: %CURRENT_PROJECT%
echo.

REM APIキーの確認 (.env から読み込みを試みる)
set API_KEY=
if exist .env (
    for /f "tokens=1,2 delims==" %%a in (.env) do (
        if "%%a"=="OPENROUTER_API_KEY" set API_KEY=%%b
    )
)

if "%API_KEY%"=="" (
    set /p API_KEY="OpenRouter API Key (sk-or-...): "
)

if "%API_KEY%"=="" (
    echo [ERROR] APIキーが指定されていません。
    exit /b 1
)

echo.
echo [1/2] 必要な Google Cloud API を有効化中...
call gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com

echo.
echo [2/2] Cloud Run へソースデプロイ中 (東京リージョン: asia-northeast1)...
call gcloud run deploy ippon-gp ^
  --source . ^
  --region asia-northeast1 ^
  --platform managed ^
  --allow-unauthenticated ^
  --min-instances 1 ^
  --max-instances 1 ^
  --cpu 1 ^
  --memory 512Mi ^
  --timeout 3600 ^
  --concurrency 80 ^
  --set-env-vars OPENROUTER_API_KEY=%API_KEY%,THEME_TIME_LIMIT=150,TARGET_IPPON=3

if %ERRORLEVEL% equ 0 (
    echo.
    echo ========================================================
    echo   デプロイが完了しました！ 上記の Service URL を開いてください。
    echo ========================================================
) else (
    echo.
    echo [ERROR] デプロイに失敗しました。エラーログを確認してください。
)
