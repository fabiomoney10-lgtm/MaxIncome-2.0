@echo off
setlocal
cd /d "%~dp0.."

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 18 ou superior nao foi encontrado.
  echo Instale o Node.js LTS e execute este arquivo novamente.
  pause
  exit /b 1
)

echo Instalando dependencias do projeto...
call npm install --ignore-scripts --no-audit --no-fund
if errorlevel 1 (
  echo Falha ao instalar dependencias.
  pause
  exit /b 1
)

echo Executando backtest historico publico da Bybit...
call npm run research:backtest
if errorlevel 1 (
  echo A coleta ou o backtest falhou. Confira a mensagem acima.
  pause
  exit /b 1
)

echo.
echo Relatorios gerados em artifacts\research
pause
