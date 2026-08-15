@echo off
setlocal enabledelayedexpansion

REM Garante que estamos rodando a partir da pasta do script
cd /d "%~dp0"

set "ARQUIVO=dados.json"

echo [1/3] Coletando dados...
python coletar.py > "%ARQUIVO%"
if errorlevel 1 (
    echo ERRO: coletar.py falhou ao executar.
    goto :fim
)

REM Verifica se o arquivo foi gerado e nao esta vazio
if not exist "%ARQUIVO%" (
    echo ERRO: %ARQUIVO% nao foi criado.
    goto :fim
)

for %%A in ("%ARQUIVO%") do set TAMANHO=%%~zA
if !TAMANHO! EQU 0 (
    echo ERRO: %ARQUIVO% esta vazio.
    goto :fim
)

echo [2/3] Enviando dados...
curl -f -s -S -X POST -H "Content-Type: application/json" -d "@%ARQUIVO%" https://huss-w2h3.onrender.com/receber
if errorlevel 1 (
    echo ERRO: falha ao enviar dados ao servidor.
    goto :fim
)

echo [3/3] Concluido com sucesso.

:fim
REM Limpa o arquivo temporario
if exist "%ARQUIVO%" del "%ARQUIVO%" >nul 2>&1

endlocal
exit /b
