#!/usr/bin/env bash
# Setup Telegram bot webhook to point at the kembang-api worker.
#
# Usage:
#   TELEGRAM_BOT_TOKEN=xxx WORKER_URL=https://kembang-api.xxx.workers.dev bash scripts/set-telegram-webhook.sh
#
# To remove the webhook:
#   TELEGRAM_BOT_TOKEN=xxx bash -c 'curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/deleteWebhook"'

set -euo pipefail

if [ -z "${TELEGRAM_BOT_TOKEN:-}" ]; then
  echo "ERROR: TELEGRAM_BOT_TOKEN env var is required" >&2
  exit 1
fi

if [ -z "${WORKER_URL:-}" ]; then
  echo "ERROR: WORKER_URL env var is required" >&2
  exit 1
fi

WEBHOOK_URL="${WORKER_URL}/telegram/webhook"

echo "Setting Telegram webhook to: ${WEBHOOK_URL}"
curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook?url=${WEBHOOK_URL}"
echo ""
