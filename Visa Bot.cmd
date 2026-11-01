@echo off
rem Windows: double-click to open the Visa Bot dashboard (starts it if needed).
cd /d "%~dp0"
where node >nul 2>nul || (echo   Node.js isnt installed - get it from https://nodejs.org and try again. & pause & exit /b 1)
if not exist node_modules call npm install --silent
node scripts\launch.js
timeout /t 4 >nul
