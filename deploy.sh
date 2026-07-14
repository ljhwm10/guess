#!/usr/bin/env bash
# 你画我猜 · 一键部署 / 更新脚本
#
# 用法:
#   ./deploy.sh                  拉最新代码 → 安装依赖 → 构建前端 → 重启服务 → 健康检查
#   SKIP_PULL=1 ./deploy.sh      跳过 git pull(本地代码已是最新)
#   SERVICE_NAME=guess ./deploy.sh   指定 systemd/pm2 的服务名(默认 guess)
#   PORT=8080 ./deploy.sh        指定健康检查端口(需与服务实际监听端口一致,默认 5310)
#
# 说明:脚本会自动识别用 systemd 还是 pm2 重启;首次部署请先按 DEPLOY.md 配好守护进程。
set -euo pipefail

SERVICE_NAME="${SERVICE_NAME:-guess}"
PORT="${PORT:-5310}"

# 切到脚本所在目录(即仓库根),不管从哪调用都对
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> [1/5] 拉取最新代码"
if [ "${SKIP_PULL:-0}" = "1" ]; then
  echo "    (SKIP_PULL=1,跳过)"
elif [ -d .git ]; then
  git pull --ff-only
else
  echo "    (非 git 仓库,跳过)"
fi

echo "==> [2/5] 安装依赖"
pnpm install

echo "==> [3/5] 构建前端"
pnpm build

echo "==> [4/5] 重启服务"
if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files 2>/dev/null | grep -q "^${SERVICE_NAME}\.service"; then
  sudo systemctl restart "$SERVICE_NAME"
  echo "    systemd 已重启 ${SERVICE_NAME}"
elif command -v pm2 >/dev/null 2>&1 && pm2 describe "$SERVICE_NAME" >/dev/null 2>&1; then
  pm2 restart "$SERVICE_NAME"
  echo "    pm2 已重启 ${SERVICE_NAME}"
else
  echo "    ⚠ 未检测到 systemd/pm2 上的 '${SERVICE_NAME}' 服务。"
  echo "      首次部署请先按 DEPLOY.md 配置守护进程;或临时前台运行:PORT=${PORT} pnpm start"
  exit 0
fi

echo "==> [5/5] 健康检查"
sleep 2
if curl -fsS "http://127.0.0.1:${PORT}/healthz" >/dev/null 2>&1; then
  echo "    OK: http://127.0.0.1:${PORT}/healthz 正常"
else
  echo "    ⚠ 健康检查未通过,请查看日志:"
  echo "      journalctl -u ${SERVICE_NAME} -f    (systemd)"
  echo "      pm2 logs ${SERVICE_NAME}            (pm2)"
  exit 1
fi

echo "✅ 部署完成"
