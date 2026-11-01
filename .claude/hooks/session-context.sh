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

integration=feature/platform-gecisi
if git remote get-url origin >/dev/null 2>&1; then
  with_timeout 3 git fetch --quiet origin "$integration" </dev/null >/dev/null 2>&1
  behind=$(git rev-list --count "HEAD..origin/$integration" 2>/dev/null)
  if [[ -n "$behind" && "$behind" -gt 0 ]]; then
    echo "origin/$integration bu daldan $behind commit ileride: önce birleştir (git merge origin/$integration)."
  fi
fi

if command -v gh >/dev/null 2>&1; then
  issues=$(with_timeout 3 gh issue list --state open --limit 8 --json number,title,labels \
    --jq '.[] | "#\(.number) [\([.labels[].name | select(startswith("sahip:"))] | join(",") | if . == "" then "sahipsiz" else . end)] \(.title)"' \
    </dev/null 2>/dev/null)
  [[ -n "$issues" ]] && printf 'Açık issue'"'"'lar (çakışan iş var mı bak):\n%s\n' "$issues"
fi
exit 0
