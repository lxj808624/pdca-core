#!/usr/bin/env bash
# 备份：数据库 + 世界观配置 → ./backups/（可在 cron 里挂）
#
# 用法：
#   bash deploy/backup.sh                        # 备份到 <项目>/backups/
#   bash deploy/backup.sh /mnt/nas/pdca-backup   # 备份到指定目录
#   PDCA_DB=/srv/pdca-core/data/pdca.db bash deploy/backup.sh
#
# 建议 crontab（每天 03:10）：
#   10 3 * * * cd /srv/pdca-core && bash deploy/backup.sh >> /var/log/pdca-backup.log 2>&1
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
NODE_BIN="${PDCA_NODE:-node}"

cd "$ROOT"
exec "$NODE_BIN" server/backup.js "$@"
