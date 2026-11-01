#!/usr/bin/env bash
# 체험 부스 예약 서버 실행 (127.0.0.1:5500, 포탈 https://dev.daonlabs.kr/r/5500/)
cd "$(dirname "$0")"
export PORT="${PORT:-5500}"
export HOST=127.0.0.1
export ADMIN_KEY="${ADMIN_KEY:-miso1234}"
mkdir -p logs
if [ -f logs/server.pid ] && kill -0 "$(cat logs/server.pid)" 2>/dev/null; then
  echo "already running (pid $(cat logs/server.pid))"; exit 0
fi
nohup node server.js >> logs/server.log 2>&1 &
echo $! > logs/server.pid
sleep 1
echo "started pid $(cat logs/server.pid) → http://127.0.0.1:$PORT/  (https://dev.daonlabs.kr/r/$PORT/)"
