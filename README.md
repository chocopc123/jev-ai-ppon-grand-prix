# IPPON GP Web — Jev × 大喜利マルチ対戦

TypeSafe の Jev (System One モデル) を OpenRouter 経由で使った、テレビの大喜利番組「IPPONグランプリ」風マルチ対戦 Web アプリケーション。

## 特徴 (Jev の強みを生かした設計)

| レイヤー | 内容 |
| :--- | :--- |
| ゲートキーパー | 採点前に `noul` (boolean) / `choice` の型付き質問で即座にはじく (低コスト・高頻度判断) |
| 本審査 | 「面白いか」を `on_topic` / `has_punchline` / `novelty` 等の**構造化基準に分解**して Jev に質問 |
| 合成 | 確率 → 5審査員×2点 (係数2.3底上げ) → 10点満点への変換は**コード側**で制御 |
| 演出 | Jev の確信度 (probability) に応じて審査員の点灯スピードが変化。8〜10点がかかる瀬戸際では緊張感あるタメ・焦らしを演出 |

IPPON 条件: 構造的満点 (10点) × 直感のウケ (`gut_funny >= 0.60`) × 定番ボケ排除 (`is_cliche < 0.40`)。

---

## 構成

```
.
├── main.py              # FastAPI + WebSocket (ルーム管理・進行・採点パイプライン・静的配信)
├── jev_client.py        # OpenRouter decisions API クライアント + スコア合成・点灯タイムライン生成
├── themes.json          # プリセットお題
├── requirements.txt     # Python依存パッケージ (fastapi, uvicorn, httpx)
├── Dockerfile           # Cloud Run / コンテナ用 Dockerfile
├── test_jev_client.py   # 単体テスト (正規化・モック・判定)
├── test_integration.py  # 統合テスト (HTTP配信・WebSocket対戦)
└── frontend/            # Vite + React (TypeScript) UI
    ├── src/
    │   └── App.tsx      # 入室・回答送信・審査員点灯演出・Web Audio効果音
    ├── vite.config.ts   # /ws WebSocket プロキシ設定
    └── package.json
```

---

## ローカル開発手順

### 1. バックエンドの起動 (APIキーなしでもモックで動作可能)

```bash
# 依存パッケージのインストール
pip install -r requirements.txt

# APIキーなし（決定論的モックで演出・動作確認）
uvicorn main:app --port 8080

# 実API接続時
export OPENROUTER_API_KEY="sk-or-..."
uvicorn main:app --port 8080
```

> **Note**: Jev は通常の `chat/completions` には非対応です。必ず `POST https://openrouter.ai/api/alpha/decisions` (`model: ~typesafe/jev-latest`) を使用します。`_normalize()` 関数により `noul`, `choice`, `score`, `probabilities` 形式を自動整形します。

### 2. フロントエンドの開発

```bash
cd frontend
npm install
npm run dev
```

ブラウザで `http://localhost:5173` を開くと、`vite.config.ts` のプロキシ経由でバックエンドの WebSocket (`/ws`) に接続されます。
2つのタブを開くことでマルチ対戦をテストできます。

### 3. 本番ビルドと単一サーバー起動

```bash
cd frontend
npm run build
cd ..
uvicorn main:app --port 8080
```

`http://localhost:8080` にアクセスすると、FastAPI 経由でビルド済みフロントエンド (`frontend/dist`) が配信され、そのままプレイ可能です。

### 4. テストの実行

```bash
# 単体テスト (正規化・モック検証)
python test_jev_client.py

# 統合テスト (WebSocket対戦フロー検証)
python test_integration.py
```

---

## Google Cloud (Cloud Run) へのデプロイ

```bash
# 1. フロントエンドのビルド
cd frontend && npm run build
cd ..

# 2. Cloud Run へデプロイ
gcloud run deploy ippon-gp \
  --source . \
  --region asia-northeast1 \
  --allow-unauthenticated \
  --min-instances 1 \
  --timeout 3600 \
  --concurrency 80 \
  --set-env-vars OPENROUTER_API_KEY=sk-or-...
```

### Cloud Run 設定の重要ポイント:
- `--min-instances 1`: コールドスタートによるWebSocket切断を防止
- `--timeout 3600`: デフォルト300秒(5分)タイムアウトによるWebSocket強制切断を防止
- `--concurrency 80`: 1コンテナで多数の同時接続を処理
- ルーム状態はメモリ管理のためシングルインスタンス運用を想定。マルチインスタンス拡張時は Memorystore (Redis) を併用。

---

## チューニング内容

- **IPPON難易度 (`jev_client.py`)**:
  - `judges_raw` の係数を `2.0` → `2.3` に引き上げ、良回答時にしっかり10点満点が出るよう底上げ。
  - `is_ippon` の条件を `(total == 10) and (cliche < 0.40) and (gut >= 0.60)` に緩和し、10点獲得時の爽快感と納得感を向上。
- **点灯演出テンポ (`jev_client.py`)**:
  - 1〜3人目はサクサク（250〜500ms）進行。
  - 4人目・5人目で 8〜10点がかかる瀬戸際（`running >= 7`）では、確信度に応じたウェイト（700〜1600ms）でタメを作り、番組のような緊張感を演出。
