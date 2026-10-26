@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "TRANSPARENT_DIR=X:\INPUT\TRANSPARENT"
set "VBS_FILE=L:\Decal\Tool_DinhHinh\DinhHinh-main\DinhHinh.vbs"
set "PASSWORD=2502"

title Auto Run Transparent

:login
cls
echo ==========================================
echo LOGIN - AUTO RUN TRANSPARENT
echo ==========================================
echo.

for /f "delims=" %%P in ('powershell -Command "$p=Read-Host ''Password'' -AsSecureString; $B=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($p); [Runtime.InteropServices.Marshal]::PtrToStringAuto($B)"') do (
    set "INPUT=%%P"
)

if not "!INPUT!"=="%PASSWORD%" (
    echo.
    echo Sai mat khau.
    timeout /t 2 /nobreak >nul
    goto login
)

:loop

call :count_images

cls
echo ==========================================
echo Hien tai trong thu muc Transparent co !IMG_COUNT! file anh
echo ==========================================

if !IMG_COUNT! EQU 0 (
    echo.
    echo Khong con file anh nao trong thu muc Transparent.
    echo Dung chuong trinh.
    echo.
    pause
    exit /b
)

echo.
echo Dang chay DinhHinh.vbs (Transparent)...
echo.

cscript //nologo "%VBS_FILE%"

echo.
echo ==========================================
echo Da chay xong. Dang cho lan tiep theo...
echo ==========================================
echo.

for /l %%S in (15,-1,1) do (
    cls
    call :count_images
    echo ==========================================
    echo Hien tai trong thu muc Transparent co !IMG_COUNT! file anh
    echo ==========================================
    echo.
    echo Da chay xong. Dang cho lan tiep theo...
    echo.
    echo Con lai: %%S giay...
    timeout /t 1 /nobreak >nul
)
cls

goto loop


:count_images
set /a IMG_COUNT=0
for %%E in (png jpg jpeg tif tiff bmp psd ai) do (
    for %%F in ("%TRANSPARENT_DIR%\*.%%E") do (
        if exist "%%F" (
            call :check_image "%%~nF"
        )
    )
)
exit /b

:check_image
echo %~1| findstr /i /c:"- done" /c:"-done" >nul
if errorlevel 1 (
    set /a IMG_COUNT+=1
)
exit /b
