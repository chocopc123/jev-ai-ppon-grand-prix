# Discord Activities (Embedded App SDK) セットアップガイド

本アプリケーションを Discord のボイスチャンネルやテキストチャンネルから起動できる **Discord Activity** として動かすための設定手順です。

---

## 1. Discord Developer Portal でのアプリケーション作成

### 1-1. アプリケーションの新規作成
1. [Discord Developer Portal](https://discord.com/developers/applications) にアクセスしてログインします。
2. 画面右上の **「New Application」** をクリックします。
3. アプリケーション名（例: `AI-PPON GRAND PRIX` や `大喜利グランプリ`）を入力し、利用規約に同意して **「Create」** を押します。

### 1-2. 基本情報と認証情報の取得
1. 左メニュー **「General Information」** を開きます。
2. アプリのアイコン画像（App Icon）や説明文を設定します。
3. **`APPLICATION ID`**（これが Client ID になります）をコピーしておきます。

### 1-3. Client Secret の取得
1. 左メニュー **「OAuth2」** を開きます。
2. **「Client Secret」** の **「Reset Secret」** をクリックし、表示された秘密鍵をコピーして安全に保管します。
3. **Redirects** にローカル検証用および本番用のURL（例: `https://127.0.0.1`）を追加して **「Save Changes」** を押します。

---

## 2. Activities (Embedded App SDK) の有効化

### 2-1. Activities の有効化
1. 左メニュー **「Activities」**（または **「Embedded App SDK」**）を開きます。
2. **「Enable Activities」** をオンにします。

### 2-2. URL Mappings の設定
Discord のプロキシ（`discordsays.com`）からアプリケーションへリクエストを転送するための設定です。

1. **URL Mappings** セクションで **「Add Mapping」** をクリックします。
2. 以下の通り設定します：
   - **Prefix**: `/`
   - **Target**: アプリケーションの公開URL（例: `https://xxxx.ngrok-free.app` または Cloud Run の `https://xxxx.run.app`）
3. **「Save Changes」** を押して保存します。

---

## 3. 環境変数の設定

プロジェクトの `.env` ファイルに取得した認証情報を設定します。

### バックエンド用 (`.env`)
```env
# OpenRouter / Gemini 設定
OPENROUTER_API_KEY="sk-or-..."

# Discord Activities 設定
DISCORD_CLIENT_ID="<取得したAPPLICATION ID>"
DISCORD_CLIENT_SECRET="<取得したClient Secret>"
```

### フロントエンド用 (`frontend/.env`)
```env
VITE_DISCORD_CLIENT_ID="<取得したAPPLICATION ID>"
```

---

## 4. ローカル開発での動作確認手順

Discord Activity は HTTPS かつ外部からアクセス可能なドメインを要求するため、ローカル開発時は **Cloudflare Tunnel (`cloudflared`)** または **ngrok** を使用して一時的な公開URLを発行します。

### 手順 A: Cloudflare Tunnel を使用する場合（無料・アカウント不要）
```bash
# cloudflared を使ってポート 8080 を公開
cloudflared tunnel --url http://localhost:8080
```
ターミナルに表示される `https://xxxx.trycloudflare.com` を Discord Developer Portal の **URL Mapping (Target)** に設定します。

### 手順 B: ngrok を使用する場合
```bash
ngrok http 8080
```
表示される `https://xxxx.ngrok-free.app` を Discord Developer Portal の **URL Mapping (Target)** に設定します。

### ローカルサーバーの起動
```bash
# バックエンド & フロントエンド（単一サーバー起動）
cd frontend
npm run build
cd ..
uvicorn main:app --port 8080
```

---

## 5. Discord 内での起動とプレイ

1. あなたの Discord サーバー（またはテスト用サーバー）の **ボイスチャンネル** に接続します。
2. ボイスチャンネル下部の **ロケット型アイコン（「アクティビティを開始」）** をクリックします。
3. 作成したアプリ（例: `AI-PPON GRAND PRIX`）を選択して起動します。
4. **自動入室**:
   - チャンネルIDをもとに `DSC-<channelId>` という部屋が自動生成されます。
   - 同じチャンネルから起動したメンバー全員が自動的に同じ部屋に入室します。
   - Discord のアカウント名とアバター画像が自動で反映されます。
5. 全員が集まったら **「ゲームを開始する」** を押して大喜利対戦をお楽しみください！

---

## 6. Google Cloud (Cloud Run) 本番環境への適用

Cloud Run にデプロイする場合は、Cloud Run のサービス URL を Discord Developer Portal に設定します。

1. 通常通り Cloud Run にデプロイします：
   ```bash
   cmd /c deploy-gcp.bat
   ```
2. Cloud Run の環境変数に `DISCORD_CLIENT_ID` と `DISCORD_CLIENT_SECRET` を設定します。
3. デプロイ後に発行されたサービスURL（`https://xxx.run.app`）を Discord Developer Portal の **URL Mapping (Target)** に設定して保存します。
