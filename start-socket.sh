#!/bin/sh
# Socket + Redis trên VPS (host). Chạy: sudo sh start-socket.sh
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Đã tạo .env — sửa JWT_SECRET cho khớp backend"
fi

# Host VPS: luôn 127.0.0.1 (không dùng hostname "redis")
grep -q '^REDIS_HOST=' .env && sed -i 's/^REDIS_HOST=.*/REDIS_HOST=127.0.0.1/' .env || echo 'REDIS_HOST=127.0.0.1' >> .env

echo "=== [1/3] Redis :6379 ==="
if command -v redis-cli >/dev/null 2>&1 && redis-cli ping 2>/dev/null | grep -q PONG; then
  echo "Redis host OK"
elif docker ps --format '{{.Names}}' 2>/dev/null | grep -q redis; then
  echo "Redis Docker OK"
elif command -v docker >/dev/null 2>&1; then
  echo "Khởi động Redis Docker..."
  docker run -d --name mobi-redis --restart unless-stopped -p 6379:6379 redis:7-alpine 2>/dev/null \
    || docker start mobi-redis 2>/dev/null \
    || true
  sleep 2
else
  echo "ERROR: chưa có Redis. Cài: apt install redis-server  HOẶC  docker run -d -p 6379:6379 redis:7-alpine"
  exit 1
fi

echo "=== [2/3] Install deps ==="
npm install --omit=dev

echo "=== [3/3] Start socket :3001 ==="
pkill -f "node.*src/server.js" 2>/dev/null || true
fuser -k 3001/tcp 2>/dev/null || true
sleep 1

export REDIS_HOST=127.0.0.1
nohup npm start >> socket.log 2>&1 &
sleep 2

curl -sf http://127.0.0.1:3001/health || { echo "FAIL"; tail -20 socket.log; exit 1; }
echo ""
echo "✅ Socket OK — log: tail -f $ROOT/socket.log"
