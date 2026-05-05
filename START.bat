@echo off
REM WardFlow HMS - Quick Start Script (Windows)

cd /d "%~dp0" || (
    echo ERROR: Could not change to script directory
    pause
    exit /b 1
)

echo.
echo ========================================
echo   WardFlow HMS - Starting stack
echo ========================================
echo.

docker compose up -d --build

if errorlevel 1 (
    echo ERROR: Failed to start containers. Is Docker Desktop running?
    pause
    exit /b 1
)

echo.
echo Waiting for API to become healthy...

:WAIT_LOOP
timeout /t 5 /nobreak > nul
powershell -Command "try { Invoke-RestMethod -Uri 'http://localhost:8001/api/health' -ErrorAction Stop | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if errorlevel 1 goto WAIT_LOOP

echo.
echo ========================================
echo   Stack ready!
echo ========================================
echo.
echo   Frontend:  http://localhost:5500
echo   API:       http://localhost:8001/api/health
echo   pgAdmin:   http://localhost:5051
echo.
echo   Login credentials (run seed.py first):
echo     admin@wardflow.com         / password123  (System Admin)
echo     wardflowhms@gmail.com      / password123  (System Admin)
echo     use@wardflow.com           / password123  (Consultant)
echo     consultant@wardflow.com    / password123  (Consultant)
echo     seniordoctor@wardflow.com  / password123  (Consultant)
echo     jdoctor@wardflow.com       / password123  (Junior Doctor)
echo     wmanager@wardflow.com      / password123  (Ward Manager)
echo     nurse@wardflow.com         / password123  (Ward Manager)
echo.
echo   pgAdmin login:  admin@wardflow.com / admin123
echo.
echo   To seed sample data:
echo     docker compose exec api python backend/scripts/seed.py
echo.
echo   To stop:              docker compose down
echo   To stop + clear data: docker compose down -v
echo.
start http://localhost:5500/login.html
pause
