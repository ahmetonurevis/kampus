---
name: entegre-et
description: İki geliştiricili Kampüs'te çalışma dalını feature/platform-gecisi entegrasyon dalına alma — fetch, entegrasyonu dala birleştirme, pnpm gen, hızlı kontroller, --no-ff birleştirme, push ve issue kapatma. Küçük bir iş birimi yeşil olduğunda kullan.
---

# Entegrasyona al

Kurallar: `docs/muhendislik/git-ve-surum.md` §7.3. Geçmiş yeniden yazılmaz: rebase, amend, reset, force push yok.

1. **Güncelle:** `git fetch origin && git merge origin/feature/platform-gecisi` (çalışma dalında).
2. **Çakışma:**
   - Üretilen dosyalar (`openapi.json`, `schema.d.ts`) ve lockfile elle çözülmez: `package.json`'ları birleştir, sonra `pnpm install && pnpm gen`.
   - Migration numarası çakışırsa ikinci giren sensin: kendi SQL, snapshot ve `_journal.json` kaydını sil, `pnpm --filter @kampus/api db:generate --name <ad>` ile yeniden üret; ardından `db:generate` boş çıkmalı.
   - Ortak dosyada (`page-registry`, `page-coverage`, `commands.test.ts`, `app.ts`) iki bloğu da koru.
   - Kalan çakışmayı ölç: `git merge-tree --write-tree origin/feature/platform-gecisi HEAD`.
3. **Hızlı kontroller** (yalnız dokunulan paketler): `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, ilgili `node --test tests/<dosya>.test.ts` ve API değiştiyse `pnpm --filter @kampus/api test`. Tam set ve e2e CI'da; yerelde tam e2e yalnız ekran/akış değiştiyse ya da CI kırmızıysa.
4. **Birleştir:** `git switch feature/platform-gecisi && git merge --ff-only origin/feature/platform-gecisi && git merge --no-ff <dal> -m "Merge branch '<dal>' into feature/platform-gecisi" -m "#<no>"`.
5. **Push:** `git push origin feature/platform-gecisi`. `push-kontrol` hook'u entegrasyonun atası olmayı ve migration tekilliğini denetler. Proje ayarında push onay ister; **Oğuzhan tarafında yerel ayar push'u reddeder, push'u kullanıcı yapar** (komutu hazırla, kullanıcıya ver). Reddedilirse: fetch, merge, kontroller, yeniden push.
6. **Kapat:** entegrasyon dalı varsayılan dal olmadığı için "Closes #n" işlemez: `gh issue close <no> -R ahmetonurevis/kampus --comment "feature/platform-gecisi'ye birleşti (<sha>)"`.
7. **Temizle:** `git branch -d <dal>`; uzakta varsa `git push origin --delete <dal>` (aynı push kuralı).
8. CI (`gh run list --limit 3`) kırmızıysa ilk iş düzelt ya da `git revert -m 1 <merge>` ile geri al.
