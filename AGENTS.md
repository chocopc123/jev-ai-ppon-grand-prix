# プロジェクトルール & 開発ガイドライン (jev-oogiri-grand-prix)

## 1. プロジェクト概要 & 技術仕様
- **目的**: TypeSafe の Jev (System One モデル) を TypeSafe AI 公式エンドポイント（または OpenRouter）経由で活用した、大喜利グランプリ（AI-PPON GRAND PRIX）風のリアルタイムマルチ対戦 Web / Discord Activity アプリケーション。
- **技術スタック**:
  - **バックエンド**: Python 3.11+ / FastAPI / Uvicorn / httpx / python-dotenv / WebSocket
  - **フロントエンド**: React 19 / TypeScript / Vite / `@discord/embedded-app-sdk` / Oxlint
  - **AI / 採点基盤**: TypeSafe decisions API (`https://api.typesafe.ai/v1/systemone` / `jev-latest`) / 決定論的モックフォールバック
  - **インフラ・デプロイ**: Google Cloud Run (Dockerfile によるマルチステージビルド、フロントエンド静的配信 + WebSocket 同一ポート運用)
  - **データ整合性 & 拡張・安全ルール**:
  - **自動テスト必須**:
    - **テスト一括実行**: `cmd /c npm test`（または `cmd /c npm run test:unit`, `cmd /c npm run test:integration`）
      - 単体テスト: 採点クライアント、レスポンス正規化 (`_normalize`)、スコア合成、点灯タイムライン生成、決定論的モックの整合性を検証。
      - 統合テスト: HTTP静的配信、WebSocket 接続、ルーム作成・参加・ゲーム進行フローを検証。
    - **フロントエンド静的検証**:
      - `cmd /c npm run lint` (Oxlint による構文・コードチェック)
      - `cmd /c npm run build` (TypeScript 型チェック & Vite 本番ビルド)
  - **Jev API 接続仕様**:
    - 通常の `chat/completions` は非対応。専用の `POST https://api.typesafe.ai/v1/systemone` を使用すること。
    - `noul`, `choice`, `score`, `probabilities` 形式のゆらぎは `jev_client.py` の `_normalize()` で吸収し、安全に型定義された辞書へマッピングする。
    - APIキー未設定時 (`TYPESAFE_API_KEY` なし) でも開発・テストできるよう、決定論的モックで正常動作を担保する。
  - **ステート管理 & Cloud Run 制約**:
    - ルームおよび対戦ステートはインメモリ管理のため、Cloud Run デプロイ時は `--max-instances 1` を厳守（複数インスタンスでの対戦分断を防止）。
    - WebSocket の持続接続のため、タイムアウトは `--timeout 3600` を設定。
  - **機密保持**:
    - `.env`, `.env.local` や実トークン（`TYPESAFE_API_KEY`, `OPENROUTER_API_KEY`, `DISCORD_CLIENT_SECRET` 等）はコミット厳禁。

---

## 2. UI/UX & 大喜利演出ガイドライン
- **大喜利グランプリ番組演出の再現**:
  - 5人の審査員 × 各2点（計10点満点）のリアルタイム点灯アニメーション。
  - **点灯テンポ & 瀬戸際演出**:
    - 1〜3人目はサクサク（250〜500ms）点灯。
    - 4〜5人目で8〜10点がかかる瀬戸際（`running >= 7`）では、確信度に応じたウェイト（700〜1600ms）を設け、スタジオの静寂と緊張感を再現。
  - **サウンド演出 (Web Audio API)**:
    - BGM、出題音、回答オープン音、点灯音（審査員ごと）、IPPONファンファーレの音響演出を壊さないよう配慮する。
- **マルチプラットフォーム対応**:
  - 通常ブラウザ（PC・スマートフォン）での直接アクセスと、Discord Activity（Embedded App SDK）環境の両方で破綻なく表示・操作できるレスポンシブ設計を維持する。

---

## 3. コンポーネント & コード設計ルール
- **ディレクトリ責務**:
  | ディレクトリ / ファイル | 役割 | ルール・留意事項 |
  | :--- | :--- | :--- |
  | `main.py` | API & WebSocketサーバー | FastAPIルーティング、WebSocketルーム管理、ゲーム進行ステートマシン。採点ロジック本体は `jev_client.py` に委任 |
  | `jev_client.py` | 採点・演出クライアント | TypeSafe Jev API 通信、採点正規化、点灯タイムライン生成の純粋ロジック。テストコードから直接検証可能にする |
  | `scoring_config.json` | 採点設定 | ゲートキーパー、構造化基準、プロンプト定義の外出し設定 |
  | `themes.json` | お題定義 | プリセットお題データ |
  | `frontend/src/` | フロントエンド実装 | React UIコンポーネント、Web Audioサウンド制御、WebSocketクライアント |
  | `frontend/src/DevTool.tsx` | 開発用ツール | 演出確認・デバッグ用コントロール |

- **設計の鉄則（拡張・保守の担保）**:
  1. **2箇所ルール & ボーイスカウトルール**: 2箇所以上で同一のUI部品や処理ロジックが現れたら共通化する。既存の巨大ファイル（`App.tsx` 等）を変更する際は、触った箇所をカスタムフックやサブコンポーネントに切り出し、段階的に責務を整理する。
  2. **フロントエンドのロジック分離**: WebSocket通信、サウンド再生、タイマー制御、審査員点灯アニメーションのステート管理は、描画用JSXと混在させずカスタムフック等に分離することを推奨。
  3. **バックエンドの疎結合化**: WebSocketメッセージハンドラ内に長大なビジネスロジックを直書きせず、ステート管理クラスや `jev_client.py` の関数へ委任する。

---

## 4. Git コミット規約
- **プレフィックス**:
  - `feat:` 新機能・新ルール追加
  - `fix:` バグ修正
  - `refactor:` リファクタリング（機能変更なし）
  - `perf:` パフォーマンス改善・演出テンポ最適化
  - `chore:` 依存関係更新・設定ファイル調整
  - `docs:` ドキュメント修正
  - `style:` UIスタイルの微調整
- **アトミックコミット**: 目的・機能が異なる変更はまとめてコミットせず、適切に分割する。

---

## 5. 開発ワークフロー & 安全規約
1. **未着手Issueの確認 (利用時)**:
   - `cmd /c call "C:\Program Files\GitHub CLI\gh.exe" issue list --state open`（`in-progress` は除外）
2. **着手時の宣言 (利用時)**:
   - `cmd /c call "C:\Program Files\GitHub CLI\gh.exe" issue edit <番号> --add-label "in-progress" --add-assignee "@me"`
3. **要件精査 & コード探索**:
   - 変更対象のファイル（`main.py`, `jev_client.py`, `frontend/src/` 等）の依存関係と既存実装を確認する。
4. **実装 & 自動テスト**:
   - コマンド実行時は必ず `cmd /c` を先頭に付与すること。
   - バックエンドロジック変更時は `test_jev_client.py` や `test_integration.py` を更新・追加。
5. **静的検証 & セルフチェック (全パス必須)**:
   - `cmd /c npm test` (単体・統合テスト全パス)
   - `cmd /c npm run lint` (Linter)
   - `cmd /c npm run build` (型チェック & ビルド)
   - **差分セルフチェック**: `git diff` で意図しない変更、デバッグログの消し忘れ、秘密情報の混入がないかを点検。
6. **ユーザー確認（コミット前の絶対原則）**:
   - **独断でコミット・プッシュしない**。変更内容を作業ツリーに保持した状態で、**具体的な動作確認手順（起動手順・対象画面・期待される挙動・リグレッション確認項目）**を提示してユーザーに確認を依頼する。
7. **承認後の厳格コミット**:
   - `git add .` は厳禁。変更対象ファイル・ハンクのみをステージングし、`git diff --cached` で差分を必ず確認した上でコミットする。
8. **Issue クローズ (利用時)**:
   - 承認後に実行: `cmd /c call "C:\Program Files\GitHub CLI\gh.exe" issue close <番号> --comment "✅ 実装完了・ユーザー確認済み"`
