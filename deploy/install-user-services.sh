#!/bin/bash
# Installs musicmod's systemd user units for the current user.
# Re-run after editing anything in deploy/ — the installed copies don't update themselves.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
dest="$HOME/.config/systemd/user"

mkdir -p "$dest" /var/www/projects/musicmod/storage/logs
# The dashboard (www-data) writes requests here, so the group needs write access.
mkdir -p /var/www/projects/musicmod/control
chmod 2775 /var/www/projects/musicmod/control

cp "$here/musicmod.service" "$here/musicmod-control.service" "$here/musicmod-control.path" "$dest/"
systemctl --user daemon-reload
systemctl --user enable --now musicmod-control.path

echo "Installed. musicmod itself is NOT running — start it from the dashboard or with:"
echo "  systemctl --user start musicmod"
