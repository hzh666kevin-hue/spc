@echo off
chcp 65001 >nul
title SPC - 安全生产力中枢
echo ========================================
echo   SPC - 安全生产力中枢
echo   正在启动本地服务器...
echo ========================================
echo.
echo 请在浏览器中访问: http://localhost:8080
echo.
echo 按 Ctrl+C 停止服务器
echo.
cd /d "%~dp0"
python -m http.server 8080
