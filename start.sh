#!/usr/bin/env bash
# 체험 부스 예약 서버 실행 (127.0.0.1:5501, 포탈 https://dev.daonlabs.kr/r/5501/)
cd "$(dirname "$0")"
export PORT="${PORT:-5501}"
export HOST=127.0.0.1
# ADMIN_KEY 는 실행 시 환경변수 > .env > 기본값(miso1234) 순으로 쓰인다
[ -n "$ADMIN_KEY" ] && export ADMIN_KEY
mkdir -p logs
if [ -f logs/server.pid ] && kill -0 "$(cat logs/server.pid)" 2>/dev/null; then
  echo "already running (pid $(cat logs/server.pid))"; exit 0
fi
nohup node server.js >> logs/server.log 2>&1 &
echo $! > logs/server.pid
sleep 1
echo "started pid $(cat logs/server.pid) → http://127.0.0.1:$PORT/  (https://dev.daonlabs.kr/r/$PORT/)"
