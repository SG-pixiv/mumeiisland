@echo off
chcp 65001 > nul
title Mumei Island - result uploader
cd /d "%~dp0"
where node > /dev/null 2> nul
if errorlevel 1 (
  echo Node.js is required. Install the LTS version from https://nodejs.org and run this again.
  echo Or use mumei-uploader.exe instead - it does not need Node.js.
  pause
  exit /b 1
)
node "%~dp0mumei-uploader.cjs" %*
pause
