@echo off
title MOGO Email API Server
color 0A
echo.
echo  ============================================
echo   MOGO Email Finder ^& Verifier API
echo   Starting on http://localhost:7823
echo  ============================================
echo.

:: Check if Node.js is installed
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Node.js is not installed!
    echo  Please install Node.js from https://nodejs.org
    echo.
    pause
    exit /b 1
)

:: Install dependencies if node_modules doesn't exist
if not exist "node_modules\" (
    echo  Installing dependencies...
    call npm install
    echo.
)

:: Start the server
echo  Starting server...
echo  Keep this window open while using MOGO.
echo  Press Ctrl+C to stop.
echo.
node server.js
pause
