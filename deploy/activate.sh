#!/usr/bin/env bash
set -euo pipefail

release_id=${1:?Sürüm kimliği gerekli.}
if [[ ! "$release_id" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9]+$ ]]; then
  printf '%s\n' 'Geçersiz sürüm kimliği.' >&2
  exit 1
fi
if [[ $(id -u) != 0 ]]; then
  printf '%s\n' 'Yayın aktivasyonu root yetkisi gerektirir.' >&2
  exit 1
fi

deploy_root=/var/www/kampus-demo
release_dir="$deploy_root/releases/$release_id"
config_dir="$deploy_root/deploy/$release_id"
backup_dir="$deploy_root/backups/$release_id"
site_config=/etc/nginx/sites-available/demo.onurevis.com
enabled_config=/etc/nginx/sites-enabled/demo.onurevis.com
site_snippet=/etc/nginx/snippets/kampus-demo.conf

exec 9>/run/lock/kampus-demo-deploy.lock
flock -n 9 || { printf '%s\n' 'Başka bir Kampüs yayını devam ediyor.' >&2; exit 1; }
test -s "$release_dir/index.html"
test -s "$release_dir/health.json"
test -s "$config_dir/https.conf"
nginx -t

if [[ -e "$site_config" ]] && ! grep -q 'managed by scripts/deploy.sh' "$site_config"; then
  printf '%s\n' 'Domain için yönetilmeyen bir Nginx yapılandırması var; üzerine yazılmadı.' >&2
  exit 1
fi
if [[ -e "$deploy_root/current" && ! -L "$deploy_root/current" ]]; then
  printf '%s\n' 'Aktif yayın yolu bir sembolik bağlantı olmalıdır.' >&2
  exit 1
fi
if [[ -e "$enabled_config" || -L "$enabled_config" ]]; then
  test "$(readlink "$enabled_config")" = "$site_config"
fi

install -d -m 755 "$backup_dir" "$deploy_root/assets" /var/lib/letsencrypt
previous_release=$(readlink "$deploy_root/current" || true)
printf '%s\n' "$previous_release" > "$backup_dir/previous-release"
[[ ! -f "$site_config" ]] || cp -p "$site_config" "$backup_dir/site.conf"
[[ ! -f "$site_snippet" ]] || cp -p "$site_snippet" "$backup_dir/snippet.conf"
was_enabled=false
[[ ! -L "$enabled_config" ]] || was_enabled=true

rollback() {
  status=$?
  trap - ERR
  set +e
  if [[ -n "$previous_release" ]]; then
    ln -s "$previous_release" "$deploy_root/rollback-$release_id"
    mv -Tf "$deploy_root/rollback-$release_id" "$deploy_root/current"
  else
    rm -f "$deploy_root/current"
  fi
  if [[ -f "$backup_dir/site.conf" ]]; then
    cp -p "$backup_dir/site.conf" "$site_config"
  else
    rm -f "$site_config"
  fi
  if [[ -f "$backup_dir/snippet.conf" ]]; then
    cp -p "$backup_dir/snippet.conf" "$site_snippet"
  else
    rm -f "$site_snippet"
  fi
  if [[ "$was_enabled" == false ]]; then rm -f "$enabled_config"; fi
  nginx -t && systemctl reload nginx
  printf '%s\n' 'Yayın başarısız oldu; önceki yayın ve Nginx yapılandırması geri yüklendi.' >&2
  exit "$status"
}
trap rollback ERR

rsync -a --ignore-existing "$release_dir/assets/" "$deploy_root/assets/"
install -m 644 "$config_dir/site.conf" "$site_snippet"
ln -s "$release_dir" "$deploy_root/current-$release_id"
mv -Tf "$deploy_root/current-$release_id" "$deploy_root/current"

if [[ -s /etc/letsencrypt/live/demo.onurevis.com/fullchain.pem ]]; then
  install -m 644 "$config_dir/https.conf" "$site_config"
else
  install -m 644 "$config_dir/http.conf" "$site_config"
fi
ln -sfn "$site_config" "$enabled_config"
nginx -t
systemctl reload nginx

certbot certonly --webroot -w /var/lib/letsencrypt \
  -d demo.onurevis.com --cert-name demo.onurevis.com \
  --non-interactive --agree-tos --keep-until-expiring \
  --deploy-hook 'nginx -t && systemctl reload nginx'
install -m 644 "$config_dir/https.conf" "$site_config"
nginx -t
systemctl reload nginx

curl --fail --silent --show-error --retry 5 --retry-all-errors --retry-delay 1 \
  --resolve demo.onurevis.com:443:127.0.0.1 --connect-timeout 5 --max-time 15 \
  https://demo.onurevis.com/healthz | grep -Fq "$release_id"
systemctl is-active --quiet nginx
systemctl is-enabled --quiet certbot.timer
trap - ERR
printf 'Aktif sürüm: %s\n' "$release_id"
