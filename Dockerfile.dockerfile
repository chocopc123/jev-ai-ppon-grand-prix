# ---- ステージ 1: フロントエンドのビルド ----
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci || npm install

COPY frontend/ ./
RUN npm run build

# ---- ステージ 2: バックエンド & 実行環境 ----
FROM python:3.12-slim
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py jev_client.py themes.json ./
# フロントエンドのビルド成果物を静的ディレクトリにコピー
COPY --from=frontend-builder /app/frontend/dist ./static

ENV PORT=8080
CMD exec uvicorn main:app --host 0.0.0.0 --port ${PORT}
