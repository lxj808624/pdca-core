#!/usr/bin/env bash
# PDCA Core — 部署/更新脚本（不含任何密钥与个人环境信息）
#
# 用途：git pull → 装依赖 → 构建前端 → 重启服务 → 健康检查
# 用法：bash deploy/deploy.sh                     # 默认 /srv/pdca-core
#       bash deploy/deploy.sh /opt/pdca-core      # 指定目录
#       bash deploy/deploy.sh --seed              # 显式导入快照（覆盖同 ID 目标）
#
# 首次部署（一次性，见 README「部署」）：
#   1. git clone 本仓库到 /srv/pdca-core
#   2. cp deploy/pdca-core.service /etc/systemd/system/ && systemctl enable --now pdca-core
#   3. cp deploy/nginx-site.conf /etc/nginx/sites-available/pdca-core（改域名）
#   4. certbot 签证书
#   5. /etc/pdca-core.env 里配 PDCA_PASSCODE / PDCA_API_TOKEN / PDCA_DB

set -euo pipefail

usage() {
  echo "用法：bash deploy/deploy.sh [项目目录] [--seed]"
  echo "默认仅更新代码；--seed 显式导入快照，会覆盖同 ID 目标。"
}

PROJECT_DIR=""
IMPORT_DATA=false
for arg in "$@"; do
  case "$arg" in
    --seed) IMPORT_DATA=true ;;
    -h|--help) usage; exit 0 ;;
    -*) echo "未知参数：$arg" >&2; usage >&2; exit 2 ;;
    *)
      if [ -n "$PROJECT_DIR" ] || [ -z "$arg" ]; then
        echo "只能指定一个非空项目目录" >&2; usage >&2; exit 2
      fi
      PROJECT_DIR="$arg"
      ;;
  esac
done
PROJECT_DIR="${PROJECT_DIR:-/srv/pdca-core}"
SERVICE_NAME="${PDCA_SERVICE:-pdca-core}"

# 读取部署环境变量（PORT / PDCA_DB 等）；不存在就用默认值
ENV_FILE="${PDCA_ENV_FILE:-/etc/pdca-core.env}"
if [ -f "$ENV_FILE" ]; then set -a; . "$ENV_FILE"; set +a; fi

HEALTH_URL="http://127.0.0.1:${PORT:-3000}/api/health"
NPM="${PDCA_NPM:-/usr/bin/npm}"

cd "$PROJECT_DIR"

echo "==> git pull (ff-only)"
git pull --ff-only

echo "==> npm install (root)"
"$NPM" install --no-audit --no-fund

echo "==> npm install (client)"
"$NPM" install --no-audit --no-fund --prefix client

echo "==> npm run build"
"$NPM" run build

if [ "$IMPORT_DATA" = true ]; then
  echo "==> 显式 --seed：从快照导入目标"
  "$NPM" run seed
else
  echo "==> 跳过 seed：保留现有目标数据"
fi

echo "==> restart $SERVICE_NAME"
systemctl restart "$SERVICE_NAME"

echo "==> health check"
for i in $(seq 1 20); do
  if curl -fsS "$HEALTH_URL" >/dev/null; then
    echo "OK: $HEALTH_URL"
    exit 0
  fi
  sleep 1
done
echo "健康检查失败：$HEALTH_URL" >&2
systemctl status "$SERVICE_NAME" --no-pager || true
exit 1
