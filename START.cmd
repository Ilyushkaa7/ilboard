@echo off
cd /d "%~dp0"
echo ilboard - http://127.0.0.1:4173/
echo Keep this window open. Close it to stop ilboard.
python -m http.server 4173 --bind 127.0.0.1 --directory dist
pause
