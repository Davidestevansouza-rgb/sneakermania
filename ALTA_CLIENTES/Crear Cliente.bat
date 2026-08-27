@echo off
chcp 65001 >nul
cd /d "%~dp0"
python crear_cliente.py
if errorlevel 1 (
  echo.
  echo No se pudo ejecutar con "python". Intentando con "py"...
  py crear_cliente.py
)
