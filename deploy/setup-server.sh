#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu 24.04 Droplet. Run as root:  bash setup-server.sh
set -euo pipefail

echo "==> Updating the system"
apt-get update && apt-get -y upgrade

echo "==> Installing Docker"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi

echo "==> Firewall: only SSH and web traffic"
apt-get install -y ufw
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

echo "==> Automatic security updates"
apt-get install -y unattended-upgrades
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "==> 2 GB swap (keeps builds from running out of memory on small Droplets)"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> Done. Next: clone the project (see DEPLOY.md, step 5)."
