---
name: is-baslat
description: İki geliştiricili Kampüs'te yeni işe başlama — çakışan iş araması, issue açma ya da üstlenme (sahip:<sen> + durum:devam), güncel entegrasyon dalından onur/<konu> veya oguzhan/<konu> dalı. Bir göreve, özelliğe veya düzeltmeye başlarken kullan.
---

# İşe başla

Kurallar: `docs/muhendislik/git-ve-surum.md` §7, `.claude/rules/ortak-calisma.md`. Görev listen `docs/is-bolumu/<sahip>.md`.

1. **Sahip:** `git config kampus.sahip` (yoksa `user.name`'den: Oguzhan → `oguzhan`, Onur → `onur`). Karşı taraf diğeridir.
2. **Çakışma:** `gh issue list -R ahmetonurevis/kampus --state open --json number,title,labels,body`. Aynı dosyaya veya migration numarasına dokunan açık iş varsa dur, kullanıcıya şıklı sor.
3. **Issue:** iş için açık issue varsa üstlen: `gh issue edit <no> --add-label durum:devam`. Yoksa aç:
   ```sh
   gh issue create -R ahmetonurevis/kampus --title "<iş> (migration 00NN)" \
     --label sahip:<sen> --label durum:devam [--label migration] [--label ortak-dosya] \
     --body "Alan: …
   Dokunulacak dosyalar: …"
   ```
   Migration/ADR numarası başlıkta yazılır ve kullanılır; onay beklenmez. Yalnız mevcut etiketler: `sahip:onur`, `sahip:oguzhan`, `migration`, `ortak-dosya`, `durum:devam`, `bug`.
4. **Dal:** `git fetch origin && git switch -c <sen>/<konu> origin/feature/platform-gecisi` (kebab-case, Türkçe karakter yok). Worktree'de: `git worktree add .claude/worktrees/<konu> -b <sen>/<konu> origin/feature/platform-gecisi` ve `pnpm install --frozen-lockfile`.
5. **Çalışırken:** commit gövdesi `#<no>` anar. Karşı alanda bir şey gerekirse durmadan `gh issue create -R ahmetonurevis/kampus --label sahip:<karşı taraf>` ile iş isteği aç ve geçici veriyle devam et. Davranış değişikliği `packages/school-core/changes/<konu>.md` parçası yazar; sürüm ve README sayıları değişmez.
6. Küçük, mantıklı birim yeşil olunca `entegre-et` ile hemen entegrasyona al; uzun yaşayan dal yok.
