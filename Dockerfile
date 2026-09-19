FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py jev_client.py themes.json ./

# frontend をビルドしてある場合は一緒にコピー (frontend/dist)
COPY frontend/dist ./static

ENV PORT=8080
CMD exec uvicorn main:app --host 0.0.0.0 --port ${PORT}
