@echo off
echo ========================================================
echo   IPPON GP Web - Production Server (FastAPI + Built UI)
echo ========================================================
echo.
echo Starting Server on http://192.168.10.112:8080 ...
echo - PC:    http://localhost:8080
echo - Phone: http://192.168.10.112:8080
echo.
cmd /c uvicorn main:app --host 0.0.0.0 --port 8080 --reload
pause
