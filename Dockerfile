# SPC - 安全生产力中枢
# Docker 部署配置

FROM python:3.11-alpine

# 设置工作目录
WORKDIR /app

# 复制应用文件
COPY . .

# 暴露端口
EXPOSE 80

# 启动 HTTP 服务器
CMD ["python", "-m", "http.server", "80", "--directory", "/app"]
