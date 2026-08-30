@echo off
setlocal EnableExtensions
title OpenCode Skin Studio
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Please install from https://nodejs.org
  pause
  exit /b 1
)

if "%~1"=="dev" (
  echo [dev] starting dev servers: web=http://localhost:5173
  call npm run dev
  goto :eof
)

if "%~1"=="tray" (
  echo [tray] starting tray icon; it will launch/keep the service running...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\tray.ps1"
  goto :eof
)

powershell -NoProfile -Command "try{Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 'http://127.0.0.1:5175/api/health'|Out-Null;exit 0}catch{exit 1}"
if not errorlevel 1 (
  echo [info] service already running, opening browser...
  start "" http://127.0.0.1:5175
  timeout /t 2 /nobreak >nul
  exit /b 0
)

if not exist node_modules (
  echo [setup] installing dependencies, please wait...
  call npm install --no-fund --no-audit
  if errorlevel 1 goto :fail
)

if not exist dist\index.html (
  echo [setup] building frontend, please wait...
  call npm run build
  if errorlevel 1 goto :fail
)

echo.
echo ============================================================
echo   OpenCode Skin Studio  -  http://127.0.0.1:5175
echo   Waiting for service ready, browser will open soon...
echo   Keep this window OPEN. Close it to stop the service.
echo ============================================================
echo.

start "" /min powershell -NoProfile -Command "for($i=0;$i -lt 120;$i++){try{Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 'http://127.0.0.1:5175/api/health'|Out-Null;break}catch{Start-Sleep -Milliseconds 500}};try{Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 'http://127.0.0.1:5175/api/health'|Out-Null;Start-Process 'http://127.0.0.1:5175'}catch{}"

call npm start

echo.
echo [info] server stopped. If this was unexpected, scroll up for the error.
pause
goto :eof

:fail
echo.
echo [ERROR] setup failed. Check messages above.
pause
