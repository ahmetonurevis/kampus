---
name: entegre-et
description: İki geliştiricili Kampüs'te çalışma dalını feature/platform-gecisi entegrasyon dalına alma — fetch, entegrasyonu dala birleştirme, pnpm gen, hızlı kontroller, --no-ff birleştirme, görev satırını "bitti" ve birleştirme hash'iyle güncelleme, push. Küçük bir iş birimi yeşil olduğunda kullan.
---

# Entegrasyona al

Kurallar: `docs/muhendislik/git-ve-surum.md` §7.3. Geçmiş yeniden yazılmaz: rebase, amend, reset, force push yok.

1. **Güncelle:** `git fetch origin && git merge origin/feature/platform-gecisi` (çalışma dalında).
2. **Çakışma:**
   - Üretilen dosyalar (`openapi.json`, `schema.d.ts`) ve lockfile elle çözülmez: `package.json`'ları birleştir, sonra `pnpm install && pnpm gen`.
   - Migration numarası çakışırsa ikinci giren sensin: kendi SQL, snapshot ve `_journal.json` kaydını sil, `pnpm --filter @kampus/api db:generate --name <ad>` ile yeniden üret; ardından `db:generate` boş çıkmalı.
   - Ortak dosyada (`page-registry`, `page-coverage`, `commands.test.ts`, `app.ts`) iki bloğu da koru. Görev tablosunda çakışma olursa iki tarafın satırlarını koru; sahibi olmadığın tablonun satırını değiştirme.
   - Kalan çakışmayı ölç: `git merge-tree --write-tree origin/feature/platform-gecisi HEAD`.
3. **Hızlı kontroller** (yalnız dokunulan paketler): `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, ilgili `node --test tests/<dosya>.test.ts` ve API değiştiyse `pnpm --filter @kampus/api test`. Tam set ve e2e CI'da; yerelde tam e2e yalnız ekran/akış değiştiyse ya da CI kırmızıysa.
4. **Birleştir:** `git switch feature/platform-gecisi && git merge --ff-only origin/feature/platform-gecisi && git merge --no-ff <dal> -m "Merge branch '<dal>' into feature/platform-gecisi" -m "OG-012"`.
5. **Görevi kapat:** hemen arkasından görev satırında Durum `bitti`, Dal / commit birleştirme commit'inin kısa hash'i (`git rev-parse --short HEAD`):
   ```sh
   git commit -m "Görev durumunu güncelle: OG-012 bitti" -- docs/is-bolumu/<sahip>.md
   ```
   Görev birden çok birleştirmeyle bitiyorsa satır son birleştirmeye kadar `çalışılıyor` kalır. İş bir iş isteği issue'sundan geldiyse: `gh issue close <no> -R ahmetonurevis/kampus --comment "feature/platform-gecisi'ye birleşti (<sha>, OG-012)"` (entegrasyon dalı varsayılan dal olmadığı için "Closes #n" işlemez).
6. **Push:** `git push origin feature/platform-gecisi` (birleştirme ve durum commit'i birlikte). `push-kontrol` hook'u entegrasyonun atası olmayı ve migration tekilliğini denetler. Proje ayarında push onay ister; iki tarafın oturumu da push'u kendisi yapar. Reddedilirse: fetch, merge, kontroller, durum satırını yeniden yaz, yeniden push.
7. **Temizle:** `git branch -d <dal>`; uzakta varsa `git push origin --delete <dal>` (aynı push kuralı).
8. CI (`gh run list --limit 3`) kırmızıysa ilk iş düzelt ya da `git revert -m 1 <merge>` ile geri al; satır `revizyon` olur, Not'a gerekçe.
