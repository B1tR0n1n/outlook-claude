@echo off
rem Claude for Outlook (COM add-in): removes it for the current Windows user, including the saved API key.
setlocal EnableExtensions

set "PROGID=ClaudeOutlook.Connect"
set "CLSID={83000B78-7DD0-4B7C-9BE5-DF621925674D}"
set "DEST=%LOCALAPPDATA%\ClaudeOutlook"

tasklist /fi "imagename eq outlook.exe" 2>nul | find /i "outlook.exe" >nul
if not errorlevel 1 (
  echo Outlook is running. Close it, then run uninstall.cmd again.
  pause
  exit /b 1
)

reg delete "HKCU\Software\Microsoft\Office\Outlook\Addins\%PROGID%" /f >nul 2>&1
reg delete "HKCU\Software\Microsoft\Office\16.0\Outlook\Resiliency\DoNotDisableAddinList" /v "%PROGID%" /f >nul 2>&1
reg delete "HKCU\Software\Classes\%PROGID%" /f >nul 2>&1
reg delete "HKCU\Software\Classes\CLSID\%CLSID%" /f /reg:64 >nul 2>&1
if defined ProgramFiles(x86) reg delete "HKCU\Software\Classes\CLSID\%CLSID%" /f /reg:32 >nul 2>&1
reg delete "HKCU\Software\ClaudeOutlook" /f >nul 2>&1
if exist "%DEST%" rmdir /s /q "%DEST%"

echo Claude for Outlook is removed, along with its saved API key.
pause
exit /b 0
