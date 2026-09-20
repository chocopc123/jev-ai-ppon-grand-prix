@echo off
echo ========================================================
echo   AI-PPON GRAND PRIX - Simultaneous Launch (FastAPI + Vite)
echo ========================================================
echo.
echo Starting FastAPI Backend (Port 8080)...
start "FastAPI Backend" cmd /c uvicorn main:app --host 0.0.0.0 --port 8080 --reload

echo Starting Vite Frontend Dev Server (Port 5173)...
start "Vite Dev Server" cmd /c "cd frontend && npm run dev"

echo.
echo Launch complete!
echo - PC:    http://localhost:5173
echo - Phone: http://192.168.10.112:5173
echo.
pause
