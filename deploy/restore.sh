#!/usr/bin/env bash
# 恢复：用备份覆盖当前数据库（可连带恢复 profile 配置）
#
# 用法：
#   bash deploy/restore.sh backups/pdca-20261112-031000.db
#   bash deploy/restore.sh backups/pdca-20261112-031000.db backups/profile-20261112-031000
#   PDCA_DB=data/pdca.db bash deploy/restore.sh backups/xxx.db
#
# 行为：
#   1. 覆盖前先把「当前库」另存为 backups/pre-restore-<时间>.db（留后路）
#   2. 若在 systemd 托管，会先 stop 再 start；否则提示你手动重启
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
SERVICE="${PDCA_SERVICE:-pdca-core}"
DB="${PDCA_DB:-$ROOT/data/pdca.db}"

if [ $# -lt 1 ]; then
  echo "用法：bash deploy/restore.sh <备份.db> [profile 目录]" >&2
  exit 2
fi
BACKUP="$1"
PROFILE_BACKUP="${2:-}"

[ -f "$BACKUP" ] || { echo "备份文件不存在：$BACKUP" >&2; exit 1; }
if [ ! -f "$DB" ]; then
  echo "==> 目标库尚不存在（首次部署），直接创建：$DB"
fi

mkdir -p "$ROOT/backups"
STAMP="$(date +%Y%m%d-%H%M%S)"
if [ -f "$DB" ]; then
  SAFE="$ROOT/backups/pre-restore-$STAMP.db"
  cp "$DB" "$SAFE"
  echo "==> 当前库已另存：$SAFE"
fi

HAVE_SYSTEMD=false
if command -v systemctl >/dev/null 2>&1 && systemctl is-enabled "$SERVICE" >/dev/null 2>&1; then
  HAVE_SYSTEMD=true
  echo "==> 停止 $SERVICE"
  systemctl stop "$SERVICE" || true
fi

echo "==> 覆盖数据库"
mkdir -p "$(dirname "$DB")"
rm -f "$DB-wal" "$DB-shm"   # 旧 WAL 必须清掉，否则会盖回旧数据
cp "$BACKUP" "$DB"

if [ -n "$PROFILE_BACKUP" ]; then
  [ -d "$PROFILE_BACKUP" ] || { echo "profile 目录不存在：$PROFILE_BACKUP" >&2; exit 1; }
  echo "==> 恢复 profile 配置"
  cp "$PROFILE_BACKUP"/*.json "$ROOT/profile/"
fi

if [ "$HAVE_SYSTEMD" = true ]; then
  echo "==> 启动 $SERVICE"
  systemctl start "$SERVICE"
  for i in $(seq 1 20); do
    if curl -fsS "http://127.0.0.1:${PORT:-3000}/api/health" >/dev/null; then
      echo "OK：恢复完成，服务健康"
      exit 0
    fi
    sleep 1
  done
  echo "服务已启动但健康检查未通过，查看：systemctl status $SERVICE" >&2
  exit 1
fi

echo "完成。当前不是 systemd 托管，请手动重启服务：npm start" >&2
