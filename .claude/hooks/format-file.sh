#!/usr/bin/env bash
# Edit/Write sonrası değişen dosyayı Prettier ile biçimlendirir; proje dışı, desteklenmeyen veya yok sayılan dosyaları atlar.
file=$(node -e 'let s="";process.stdin.on("data",(d)=>(s+=d)).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write(j.tool_input?.file_path||j.tool_response?.filePath||"")}catch{}})')
project=${CLAUDE_PROJECT_DIR:-$PWD}
[[ -n "$file" && -f "$file" && "$file" == "$project"/* ]] || exit 0
prettier="$project/node_modules/.bin/prettier"
[[ -x "$prettier" ]] || exit 0
cd "$project" && "$prettier" --write --ignore-unknown --log-level silent "$file" >/dev/null 2>&1
exit 0
