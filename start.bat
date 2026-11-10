@echo off
cd /d %~dp0
if not exist node_modules call npm install
echo Compilando Santacruzpedia...
call npm run build
start "" cmd /c "timeout /t 4 >nul & start http://localhost:8090"
call npm start
pause
