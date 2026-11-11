#!/usr/bin/env bash
# PreToolUse (Bash): yalnız `git push` komutlarında çalışır; force push ve main'e push'u engeller,
# entegrasyon dalına push'ta birleştirme ve migration numarası denetler. Mantık push-kontrol.ts'te.
input=$(cat)
# Hızlı yol: push içermeyen komutta node başlatılmaz.
[[ "$input" == *git* && "$input" == *push* ]] || exit 0
printf '%s' "$input" | exec node --no-warnings "$(dirname "${BASH_SOURCE[0]}")/push-kontrol.ts"
