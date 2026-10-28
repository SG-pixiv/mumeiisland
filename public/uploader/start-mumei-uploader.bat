@echo off
chcp 65001 > nul
title Mumei Island - result uploader
cd /d "%~dp0"
where node > /dev/null 2> nul
if errorlevel 1 (
  echo Node.js is required. Install the LTS version from https://nodejs.org and run this again.
  pause
  exit /b 1
)
node "%~dp0mumei-uploader.mjs"
pause
