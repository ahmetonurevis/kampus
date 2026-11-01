#!/usr/bin/env bash
# Oturum başında kısa durum: dal, commit edilmemiş değişiklikler, son commitler, varsa sıradaki gece
# işleri; iki geliştiricili çalışmada görev tabloları (gorev-durumu.ts), entegrasyon dalının gerisinde
# kalınıp kalınmadığı ve sahibe açılmış iş istekleri. Ağ işleri (fetch, gh) paralel ve en çok 3 sn.
hook_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "${CLAUDE_PROJECT_DIR:-$PWD}" || exit 0
# İlk kurulum yalnız ana klonda sorulur; worktree'lerde (`.git` dosyadır) `.env` bulunmaması olağandır.
if [[ -d .git ]] && [[ ! -f apps/api/.env || ! -d node_modules ]]; then
  echo "İlk kurulum: docs/is-bolumu/ilk-kurulum.md (apps/api/.env ya da node_modules yok)."
fi
echo "Dal: $(git branch --show-current 2>/dev/null)"
changes=$(git status --short 2>/dev/null | head -15)
[[ -n "$changes" ]] && printf 'Commit edilmemiş değişiklikler:\n%s\n' "$changes"
printf 'Son commitler:\n%s\n' "$(git log --oneline -5 2>/dev/null)"
if [[ -f .claude/gece/plan.md ]]; then
  next=$(grep -m3 -E '^- \[( |~)\]' .claude/gece/plan.md)
  [[ -n "$next" ]] && printf 'Sıradaki gece işleri (.claude/gece/plan.md):\n%s\n' "$next"
fi

# Komutu en çok $1 saniye çalıştırır; macOS'ta `timeout` olmadığı için kabukla sınırlanır.
with_timeout() {
  local seconds=$1
  shift
  "$@" &
  local pid=$!
  (sleep "$seconds" && kill "$pid") >/dev/null 2>&1 &
  local watcher=$!
  wait "$pid" 2>/dev/null
  local status=$?
  kill "$watcher" >/dev/null 2>&1
  wait "$watcher" 2>/dev/null
  return $status
}

# Oturum sahibi: `kampus.sahip`, yoksa git kullanıcı adı (alan-koruma hook'uyla aynı kural).
owner=$(git config kampus.sahip 2>/dev/null | tr '[:upper:]' '[:lower:]')
if [[ "$owner" != onur && "$owner" != oguzhan ]]; then
  case "$(git config user.name 2>/dev/null | tr '[:upper:]' '[:lower:]')" in
    *oguzhan* | *oğuzhan*) owner=oguzhan ;;
    *onur*) owner=onur ;;
    *) owner= ;;
  esac
fi
# fetch ve gh paralel koşar; ikisi de en çok 3 sn, ağ yoksa sessiz geçilir.
integration=feature/platform-gecisi
has_origin=
if git remote get-url origin >/dev/null 2>&1; then
  has_origin=1
  with_timeout 3 git fetch --quiet origin "$integration" </dev/null >/dev/null 2>&1 &
  fetch_pid=$!
fi

# Görev durumu tabloda, issue yalnız iş isteği ve hata bildirimi: sahibe açılmış olanlar gösterilir.
requests=
if [[ -n "$owner" ]] && command -v gh >/dev/null 2>&1; then
  requests=$(with_timeout 3 gh issue list --state open --label "sahip:$owner" --limit 20 \
    --json number,title --jq '.[] | "  #\(.number) \(.title)"' </dev/null 2>/dev/null)
fi

if [[ -n "$has_origin" ]]; then
  wait "$fetch_pid" 2>/dev/null
  behind=$(git rev-list --count "HEAD..origin/$integration" 2>/dev/null)
  if [[ -n "$behind" && "$behind" -gt 0 ]]; then
    echo "origin/$integration bu daldan $behind commit ileride: önce birleştir (git merge origin/$integration)."
  fi
fi

# Tablolar fetch'ten sonra okunur (origin/feature/platform-gecisi; yoksa yerel dosya).
if [[ -n "$owner" ]] && command -v node >/dev/null 2>&1; then
  with_timeout 2 node --no-warnings "$hook_dir/gorev-durumu.ts" "$owner" "$PWD" </dev/null 2>/dev/null
fi
[[ -n "$requests" ]] && printf 'Sana açılmış iş istekleri (sahip:%s):\n%s\n' "$owner" "$requests"
exit 0
