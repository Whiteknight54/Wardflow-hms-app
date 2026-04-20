@echo off
REM HMS HA Environment - Quick Start Script

cd /d "c:\temp\HMS-HA-TEST" || (
    echo ERROR: folder not found at c:\temp\HMS-HA-TEST
    pause
    exit /b 1
)

echo.
echo ========================================
echo HMS HA Environment - Quick Start
echo ========================================
echo.
echo Starting isolated stack...
echo - wardflow-postgres (port 5432)
echo - wardflow-api (port 8001)
echo - wardflow-pgadmin (port 5050)
echo.

docker compose -f docker-compose.yml up -d --build

if errorlevel 1 (
    echo ERROR: Failed to start containers
    pause
    exit /b 1
)

echo.
echo ========================================
echo Waiting for containers to be ready...
echo ========================================
echo.

timeout /t 5 /nobreak

echo Checking API health...
powershell -Command "try { $resp = Invoke-RestMethod -Uri 'http://localhost:8001/api/health' -ErrorAction Stop; Write-Host 'API Status: OK' -ForegroundColor Green } catch { Write-Host 'API Status: Still starting...' -ForegroundColor Yellow }"

echo.
echo ========================================
echo Test Environment Ready!
echo ========================================
echo.
echo Frontend:  http://localhost:5500 (run: python -m http.server 5500)
echo API:       http://localhost:8001
echo pgAdmin:   http://localhost:5050
echo.
echo Credentials:
echo - Admin: admin@wardflow.com / password123
echo - Consultant: consultant@wardflow.com / password123
echo - Junior Doctor: jdoctor@wardflow.com / password123
echo - Ward Manager: wmanager@wardflow.com / password123
echo.
echo pgAdmin Login:
echo - Email: admin@wardflow.com
echo - Password: admin123
echo.
echo To stop: docker compose -f docker-compose.yml down
echo To stop + clear data: docker compose -f docker-compose.yml down -v
echo.
pause
