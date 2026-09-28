#!/usr/bin/env bash
set -euo pipefail

project_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_dir"
if [[ ${1:-} == -- ]]; then shift; fi
deploy_host=${1:-abbara-server}
if [[ $# -gt 1 || ! "$deploy_host" =~ ^[a-zA-Z0-9][a-zA-Z0-9._@-]*$ ]]; then
  printf '%s\n' 'Geçersiz SSH hedefi.' >&2
  exit 1
fi

pnpm lint
pnpm format:check
pnpm test
pnpm build

release_id="$(date -u +%Y%m%dT%H%M%SZ)-$$"
deploy_root=/var/www/kampus-demo
release_dir="$deploy_root/releases/$release_id"
config_dir="$deploy_root/deploy/$release_id"
printf '{"status":"ok","service":"kampus-demo","release":"%s"}\n' "$release_id" > apps/web/dist/health.json

ssh -o BatchMode=yes -o ConnectTimeout=10 "$deploy_host" \
  "install -d -m 755 '$release_dir' '$config_dir'"
rsync -az --chmod=Du=rwx,Dgo=rx,Fu=rw,Fgo=r -e 'ssh -o BatchMode=yes' \
  apps/web/dist/ "$deploy_host:$release_dir/"
rsync -az --chmod=Du=rwx,Dgo=rx,Fu=rw,Fgo=r -e 'ssh -o BatchMode=yes' \
  deploy/ "$deploy_host:$config_dir/"
ssh -o BatchMode=yes "$deploy_host" "bash '$config_dir/activate.sh' '$release_id'"

curl --fail --silent --show-error --retry 5 --retry-all-errors --retry-delay 1 \
  --connect-timeout 10 --max-time 30 https://demo.onurevis.com/healthz
printf '\nYayın tamamlandı: https://demo.onurevis.com — %s\n' "$release_id"
