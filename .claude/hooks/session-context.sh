#!/usr/bin/env bash
# Oturum başında kısa durum: dal, commit edilmemiş değişiklikler, son commitler ve varsa sıradaki gece işleri.
cd "${CLAUDE_PROJECT_DIR:-$PWD}" || exit 0
echo "Dal: $(git branch --show-current 2>/dev/null)"
changes=$(git status --short 2>/dev/null | head -15)
[[ -n "$changes" ]] && printf 'Commit edilmemiş değişiklikler:\n%s\n' "$changes"
printf 'Son commitler:\n%s\n' "$(git log --oneline -5 2>/dev/null)"
if [[ -f .claude/gece/plan.md ]]; then
  next=$(grep -m3 -E '^- \[( |~)\]' .claude/gece/plan.md)
  [[ -n "$next" ]] && printf 'Sıradaki gece işleri (.claude/gece/plan.md):\n%s\n' "$next"
fi
exit 0
