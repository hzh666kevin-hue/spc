@echo off
chcp 65001 >nul
title SPC 服务器更新工具

echo ========================================
echo   SPC 服务器更新工具
echo ========================================
echo.

echo 正在下载最新的 server.js...

powershell -Command "Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/hzh666kevin-hue/spc/main/server.js' -OutFile 'D:\spc-server\server.js'"

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ✅ 下载成功！
    echo.
    echo 正在启动服务器...
    cd /d D:\spc-server
    node server.js
) else (
    echo.
    echo ❌ 下载失败，请手动复制 server.js
    echo.
    pause
)
