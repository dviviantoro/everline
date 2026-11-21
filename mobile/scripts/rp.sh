#!/usr/bin/env bash
# Reach the Red Pitaya (the Cantol) with the credential saved in config/redpitaya.local.json.
#
#   scripts/rp.sh ssh [command...]     a shell on the board, or one command
#   scripts/rp.sh push <local> [remote]  copy a file or folder to the board (default: remote_dir)
#   scripts/rp.sh pull <remote> [local]  copy a file or folder from the board (default: .)
#   scripts/rp.sh info                 host, user and remote folder (never the password)
#
# The password is read from the JSON file only when ssh asks for it (SSH_ASKPASS), so it is not
# on any command line. The file is ignored by git; scripts/check-no-secrets.sh fails if it is tracked.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
conf="${RP_CONF:-$here/../config/redpitaya.local.json}"

field() { python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1])).get(sys.argv[2],""))' "$conf" "$1"; }

# ssh calls this script back to ask for the password.
if [ "${RP_ASKPASS:-}" = 1 ]; then field password; exit 0; fi

[ -f "$conf" ] || { echo "rp.sh: $conf is missing (copy config/redpitaya.example.json)" >&2; exit 2; }
host="$(field host)"; user="$(field user)"; rdir="$(field remote_dir)"
[ -n "$host" ] && [ -n "$user" ] || { echo "rp.sh: host and user must be set in $conf" >&2; exit 2; }

export RP_ASKPASS=1 SSH_ASKPASS="$here/rp.sh" SSH_ASKPASS_REQUIRE=force DISPLAY="${DISPLAY:-none}"
opts=(-o StrictHostKeyChecking=accept-new -o PreferredAuthentications=password,keyboard-interactive
      -o PubkeyAuthentication=no -o NumberOfPasswordPrompts=1 -o ConnectTimeout=10
      -o ServerAliveInterval=15 -o LogLevel=ERROR)

cmd="${1:-info}"; [ $# -gt 0 ] && shift
case "$cmd" in
  ssh)  exec ssh "${opts[@]}" "$user@$host" "$@" ;;
  push) [ $# -ge 1 ] || { echo "usage: rp.sh push <local> [remote]" >&2; exit 2; }
        src="$1"; dst="${2:-$rdir/}"; exec scp -r "${opts[@]}" "$src" "$user@$host:$dst" ;;
  pull) [ $# -ge 1 ] || { echo "usage: rp.sh pull <remote> [local]" >&2; exit 2; }
        exec scp -r "${opts[@]}" "$user@$host:$1" "${2:-.}" ;;
  info) echo "host=$host user=$user remote_dir=$rdir conf=$conf" ;;
  *)    echo "usage: rp.sh {ssh|push|pull|info}" >&2; exit 2 ;;
esac
