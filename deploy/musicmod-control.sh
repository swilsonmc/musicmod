#!/bin/bash
# The dashboard runs as www-data and can't manage this user's services, so it
# writes "start" or "stop" to a file and this (run as the user) acts on it.
set -euo pipefail

REQUEST=/var/www/projects/musicmod/control/request

[ -f "$REQUEST" ] || exit 0
action=$(tr -d '[:space:]' < "$REQUEST")
rm -f "$REQUEST"

case "$action" in
  start|stop) systemctl --user "$action" musicmod.service ;;
  *) echo "ignoring unknown request: $action" >&2 ;;
esac
