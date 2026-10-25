#!/usr/bin/env bash
# Fails if something that must stay on this machine has been committed. Run it before a push.
#
#   - files that are never committed: the local device profile, .env files, signing material;
#   - the hotspot password from config/device-profile.local.json, if that file exists, must not
#     appear in any tracked file (it is the one real secret this app handles).
#
# It does not look inside the APK: an APK built with a real profile contains the password by
# design (the operator is shown it), so it is not for sharing.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"
status=0

forbidden='(^|/)(device-profile\.local\.json|\.env|\.env\.[^/]*|keystore\.properties|[^/]*\.jks|[^/]*\.keystore)$'
while IFS= read -r file; do
  case "$file" in
    */.env.example|.env.example) continue ;;
  esac
  echo "check-no-secrets: tracked file that must stay local: $file" >&2
  status=1
done < <(git ls-files | grep -E "$forbidden" || true)

profile="mobile/config/device-profile.local.json"
if [ -f "$profile" ]; then
  password="$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).password ?? ""))' "$profile")"
  if [ "${#password}" -ge 8 ] && git grep -q -F -e "$password" -- . ':(exclude)mobile/config/device-profile.local.json'; then
    echo "check-no-secrets: the hotspot password from $profile appears in a tracked file" >&2
    status=1
  fi
fi

if [ "$status" = 0 ]; then echo "check-no-secrets: ok"; fi
exit "$status"
