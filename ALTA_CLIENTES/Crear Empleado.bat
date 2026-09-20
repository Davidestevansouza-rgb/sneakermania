@echo off
chcp 65001 >nul
cd /d "%~dp0"
if "%SUPABASE_SERVICE_KEY%"=="" (
  echo.
  echo ERROR: falta la variable SUPABASE_SERVICE_KEY.
  echo Configura la nueva clave privilegiada fuera del repositorio antes de usar este script.
  echo Revisa LEEME.txt para instrucciones.
  echo.
  pause
  exit /b 1
)
python crear_empleado.py
if errorlevel 1 (
  echo.
  echo No se pudo ejecutar con "python". Intentando con "py"...
  py crear_empleado.py
)
