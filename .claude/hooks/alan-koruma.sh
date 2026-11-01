#!/usr/bin/env bash
# PreToolUse (Edit|Write|MultiEdit|NotebookEdit): diğer geliştiricinin alanına yazmayı engeller (çıkış 2),
# ortak dosyada hatırlatır. Mantık alan-koruma.ts'te; harita .claude/alanlar.json.
exec node --no-warnings "$(dirname "${BASH_SOURCE[0]}")/alan-koruma.ts"
