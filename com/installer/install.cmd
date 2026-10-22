@echo off
rem Claude for Outlook (COM add-in): installs for the current Windows user. No admin rights needed.
rem Copies ClaudeOutlook.dll to %LOCALAPPDATA%\ClaudeOutlook and registers it under HKCU.
setlocal EnableExtensions

set "NAME=Claude for Outlook"
set "PROGID=ClaudeOutlook.Connect"
set "CLSID={83000B78-7DD0-4B7C-9BE5-DF621925674D}"
set "CLASS=ClaudeOutlook.AddIn.Connect"
set "ASM=ClaudeOutlook, Version=1.0.0.0, Culture=neutral, PublicKeyToken=null"
set "VER=1.0.0.0"
set "DEST=%LOCALAPPDATA%\ClaudeOutlook"
set "SRC=%~dp0ClaudeOutlook.dll"

echo.
echo   %NAME%: install
echo.

if not exist "%SRC%" (
  echo ClaudeOutlook.dll is not next to this script. Extract the whole zip to a folder first, then run install.cmd from there.
  goto :fail
)
tasklist /fi "imagename eq outlook.exe" 2>nul | find /i "outlook.exe" >nul
if not errorlevel 1 (
  echo Outlook is running. Close it, then run install.cmd again.
  goto :fail
)

if not exist "%DEST%" mkdir "%DEST%" || goto :fail
copy /y "%SRC%" "%DEST%\ClaudeOutlook.dll" >nul || goto :fail

rem Downloaded files carry a "from the internet" mark, and .NET refuses to load a marked DLL.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Unblock-File -LiteralPath (Join-Path $env:DEST 'ClaudeOutlook.dll')" >nul 2>&1
if errorlevel 1 (
  > "%DEST%\ClaudeOutlook.dll:Zone.Identifier" echo [ZoneTransfer]
  >> "%DEST%\ClaudeOutlook.dll:Zone.Identifier" echo ZoneId=0
)

set "CODEBASE=file:///%DEST:\=/%/ClaudeOutlook.dll"

reg add "HKCU\Software\Classes\%PROGID%" /ve /d "%NAME%" /f >nul || goto :fail
reg add "HKCU\Software\Classes\%PROGID%\CLSID" /ve /d "%CLSID%" /f >nul || goto :fail

rem Register the class for both 64-bit and 32-bit Office.
call :register_class /reg:64 || goto :fail
if defined ProgramFiles(x86) call :register_class /reg:32 || goto :fail

set "ADDIN=HKCU\Software\Microsoft\Office\Outlook\Addins\%PROGID%"
reg add "%ADDIN%" /v FriendlyName /d "%NAME%" /f >nul || goto :fail
reg add "%ADDIN%" /v Description /d "Summarize, draft and rewrite email with Claude" /f >nul || goto :fail
reg add "%ADDIN%" /v LoadBehavior /t REG_DWORD /d 3 /f >nul || goto :fail
rem Ask Outlook not to auto-disable it when a slow network makes startup look slow.
reg add "HKCU\Software\Microsoft\Office\16.0\Outlook\Resiliency\DoNotDisableAddinList" /v "%PROGID%" /t REG_DWORD /d 1 /f >nul 2>&1

echo Installed to %DEST%
echo.
echo Start Outlook. The Claude group is at the right end of the Home tab, and on the
echo Message tab when you open or write an email. Click Settings there first and paste
echo your Claude API key (it starts sk-ant-api03-).
echo.
pause
exit /b 0

:register_class
set "K=HKCU\Software\Classes\CLSID\%CLSID%"
reg add "%K%" /ve /d "%PROGID%" /f %1 >nul || exit /b 1
reg add "%K%\ProgId" /ve /d "%PROGID%" /f %1 >nul || exit /b 1
reg add "%K%\Implemented Categories\{62C8FE65-4EBB-45E7-B440-6E39B2CDBF29}" /f %1 >nul || exit /b 1
reg add "%K%\InprocServer32" /ve /d "mscoree.dll" /f %1 >nul || exit /b 1
reg add "%K%\InprocServer32" /v ThreadingModel /d "Both" /f %1 >nul || exit /b 1
for %%S in ("" "\%VER%") do (
  reg add "%K%\InprocServer32%%~S" /v Class /d "%CLASS%" /f %1 >nul || exit /b 1
  reg add "%K%\InprocServer32%%~S" /v Assembly /d "%ASM%" /f %1 >nul || exit /b 1
  reg add "%K%\InprocServer32%%~S" /v RuntimeVersion /d "v4.0.30319" /f %1 >nul || exit /b 1
  reg add "%K%\InprocServer32%%~S" /v CodeBase /d "%CODEBASE%" /f %1 >nul || exit /b 1
)
exit /b 0

:fail
echo.
echo Install did not finish.
echo.
pause
exit /b 1
