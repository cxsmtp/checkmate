#!/bin/bash
# EC2 user data for Checkmate with Podman (Amazon Linux 2023 or Ubuntu 24.04), app on port 3333,
# self-updating. Set DOMAIN and ACME_EMAIL, paste into "Advanced details → User data", launch.
# First admin password afterwards:  podman logs checkmate | grep -A1 'Admin panel'
set -euo pipefail

DOMAIN="checkmate.example.com"      # <- the DNS name that points at this instance's Elastic IP
ACME_EMAIL="you@example.com"        # <- Let's Encrypt notices
TZ_NAME="Asia/Dubai"
BUNDLE="https://raw.githubusercontent.com/cxsmtp/checkmate/main/deploy/aws"

# --- Podman ---------------------------------------------------------------------
if command -v dnf >/dev/null 2>&1; then dnf -y install podman curl; else apt-get update -y && apt-get install -y podman curl uidmap; fi
systemctl enable --now podman.socket >/dev/null 2>&1 || true

# --- Settings and units ------------------------------------------------------------
mkdir -p /etc/checkmate /etc/containers/systemd
if [ ! -f /etc/checkmate/checkmate.env ]; then
  curl -fsSL "$BUNDLE/checkmate.env.example" -o /etc/checkmate/checkmate.env
  sed -i "s|^DOMAIN=.*|DOMAIN=${DOMAIN}|; s|^ACME_EMAIL=.*|ACME_EMAIL=${ACME_EMAIL}|; s|^TZ=.*|TZ=${TZ_NAME}|; s|^PUBLIC_BASE_URL=.*|PUBLIC_BASE_URL=https://${DOMAIN}|" /etc/checkmate/checkmate.env
  chmod 600 /etc/checkmate/checkmate.env
fi
curl -fsSL "$BUNDLE/Caddyfile" -o /etc/checkmate/Caddyfile
curl -fsSL "$BUNDLE/checkmate.container" -o /etc/containers/systemd/checkmate.container
curl -fsSL "$BUNDLE/caddy.container" -o /etc/containers/systemd/caddy.container

# --- Start, and keep the images fresh daily (rollback if a new one does not start) ---
systemctl daemon-reload
systemctl start checkmate.service caddy.service
systemctl enable --now podman-auto-update.timer
echo "Checkmate is starting on port 3333 and at https://${DOMAIN}. Password: podman logs checkmate | grep -A1 'Admin panel'"
