#!/usr/bin/env bash
# One-time setup on a fresh Ubuntu 24.04 EC2 instance.
set -euo pipefail
sudo apt-get update -y
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
if ! sudo swapon --show | grep -q /swapfile; then
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
fi
sudo mkdir -p /opt/workbench && sudo chown "$USER":"$USER" /opt/workbench
echo "Done. Log out and back in (docker group), then create /opt/workbench/.env from deploy/env.production.example."
