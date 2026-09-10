@echo off
if "%MONGO_URL%"=="" (
  echo Set MONGO_URL first.
  exit /b 1
)
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set TS=%%i
if "%1"=="" (set OUT=backups\%TS%) else (set OUT=%1)
mkdir "%OUT%" 2>nul
mongodump --uri="%MONGO_URL%" --out="%OUT%"
echo Backup written to %OUT%
