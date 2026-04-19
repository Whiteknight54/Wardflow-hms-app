@echo off
REM HMS HA Test Environment - Quick Start Script

cd /d "c:\temp\HMS-HA-TEST" || (
    echo ERROR: Test folder not found at c:\temp\HMS-HA-TEST
    pause
    exit /b 1
)

echo.
echo ========================================
echo HMS HA Test Environment - Quick Start
echo ========================================
echo.
echo Starting isolated test stack...
echo - wardflow-test-postgres (port 5433)
echo - wardflow-test-api (port 8001)
echo - wardflow-test-pgadmin (port 5051)
echo.

docker compose -f docker-compose.test.yml up -d --build

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
echo pgAdmin:   http://localhost:5051
echo.
echo Credentials:
echo - Admin: admin@wardflow.com / password123
echo - Consultant: consultant@wardflow.com / password123
echo - Junior Doctor: jdoctor@wardflow.com / password123
echo - Ward Manager: wmanager@wardflow.com / password123
echo.
echo pgAdmin Login:
echo - Email: admin@wardflow.test
echo - Password: admin123
echo.
echo To stop: docker compose -f docker-compose.test.yml down
echo To stop + clear data: docker compose -f docker-compose.test.yml down -v
echo.
pause
