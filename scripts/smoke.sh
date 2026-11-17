#!/usr/bin/env bash
# 一键冒烟：临时库 + 临时端口，跑完自动清理，不会碰 data/pdca.db
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PORT="${SMOKE_PORT:-3311}"
PASSCODE="smoke-pass-123"
TMPDIR="$(mktemp -d)"
DB="$TMPDIR/smoke.db"
PID=""

cleanup() {
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then kill "$PID" 2>/dev/null || true; wait "$PID" 2>/dev/null || true; fi
  rm -rf "$TMPDIR"
}
trap cleanup EXIT

[ -d client/dist ] || { echo "先构建前端：npm run build"; exit 1; }

PDCA_DB="$DB" PORT="$PORT" HOST=127.0.0.1 \
PDCA_PASSCODE="$PASSCODE" PDCA_API_TOKEN="smoke-token" \
node server/start.js >"$TMPDIR/server.log" 2>&1 &
PID=$!

for _ in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then break; fi
  sleep 0.25
done
if ! curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
  echo "服务没起来，日志："; cat "$TMPDIR/server.log"; exit 1
fi

SMOKE_BASE="http://127.0.0.1:$PORT" SMOKE_PASSCODE="$PASSCODE" node scripts/smoke.mjs

echo "· 备份脚本"
PDCA_DB="$DB" node server/backup.js "$TMPDIR/bk" | sed 's/^/  /'
ls "$TMPDIR/bk" >/dev/null
echo "冒烟完成（临时库已清理）"
