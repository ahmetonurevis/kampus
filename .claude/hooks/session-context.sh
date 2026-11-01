#!/usr/bin/env bash
# Oturum başında kısa durum: dal, commit edilmemiş değişiklikler, son commitler, varsa sıradaki gece
# işleri; entegrasyon dalının gerisinde kalınıp kalınmadığı ve açık issue'lar (iki geliştiricili çalışma).
cd "${CLAUDE_PROJECT_DIR:-$PWD}" || exit 0
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
other=
[[ "$owner" == onur ]] && other=oguzhan
[[ "$owner" == oguzhan ]] && other=onur

if [[ -n "$owner" && -f "docs/is-bolumu/$owner.md" ]]; then
  tasks=$(grep -m5 -E '^[[:space:]]*- \[ \]' "docs/is-bolumu/$owner.md")
  [[ -n "$tasks" ]] && printf 'Sıradaki işlerin (docs/is-bolumu/%s.md):\n%s\n' "$owner" "$tasks"
fi

# fetch ve gh paralel koşar; ikisi de en çok 3 sn, ağ yoksa sessiz geçilir.
integration=feature/platform-gecisi
has_origin=
if git remote get-url origin >/dev/null 2>&1; then
  has_origin=1
  with_timeout 3 git fetch --quiet origin "$integration" </dev/null >/dev/null 2>&1 &
  fetch_pid=$!
fi

issues=
if command -v gh >/dev/null 2>&1; then
  # Satır biçimi: <durum:devam ise D, değilse -><TAB><sahip etiketleri><TAB>#no başlık
  issues=$(with_timeout 3 gh issue list --state open --limit 50 --json number,title,labels \
    --jq '.[] | [([.labels[].name] | if index("durum:devam") then "D" else "-" end), ([.labels[].name | select(startswith("sahip:"))] | join(",")), "#\(.number) \(.title)"] | @tsv' \
    </dev/null 2>/dev/null)
fi

if [[ -n "$has_origin" ]]; then
  wait "$fetch_pid" 2>/dev/null
  behind=$(git rev-list --count "HEAD..origin/$integration" 2>/dev/null)
  if [[ -n "$behind" && "$behind" -gt 0 ]]; then
    echo "origin/$integration bu daldan $behind commit ileride: önce birleştir (git merge origin/$integration)."
  fi
fi

if [[ -n "$issues" ]]; then
  if [[ -n "$other" ]]; then
    active=$(printf '%s\n' "$issues" | awk -F'\t' -v who="sahip:$other" '$1 == "D" && index($2, who) { print $3 }' | head -8)
    [[ -n "$active" ]] && printf 'Karşı tarafın sürmekte olan işleri (durum:devam):\n%s\n' "$active"
  fi
  list=$(printf '%s\n' "$issues" | awk -F'\t' '{ print $3 " [" ($2 == "" ? "sahipsiz" : $2) "]" }' | head -8)
  printf 'Açık issue'"'"'lar (çakışan iş var mı bak):\n%s\n' "$list"
fi
exit 0
