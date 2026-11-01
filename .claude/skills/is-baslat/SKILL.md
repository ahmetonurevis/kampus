---
name: is-baslat
description: İki geliştiricili Kampüs'te yeni işe başlama — kendi görev tablosundan sıradaki bekleyen görevi seçme, durumunu entegrasyon dalında "çalışılıyor" yapıp gönderme, güncel entegrasyon dalından onur/<konu> veya oguzhan/<konu> dalı açma. Bir göreve, özelliğe veya düzeltmeye başlarken kullan.
---

# İşe başla

Kurallar: `docs/muhendislik/git-ve-surum.md` §7, `.claude/rules/ortak-calisma.md`. Görev tablon `docs/is-bolumu/<sahip>.md`; görev durumu issue'da değil tablodadır.

1. **Sahip:** `git config kampus.sahip` (yoksa `user.name`'den: Oguzhan → `oguzhan`, Onur → `onur`). Karşı taraf diğeridir; önekler `OG-`, `ON-`.
2. **Güncelle:** `git fetch origin`. Tabloları entegrasyondan oku: `git show origin/feature/platform-gecisi:docs/is-bolumu/<sahip>.md` (karşı taraf için de).
3. **Görevi seç:** kullanıcı bir görev verdiyse onu, yoksa kendi tablondaki ilk `bekliyor` satırı al: önce dalga sırası (D1 → Sonra), sonra Not'taki bağımlılık (bekleneni bitmemişse geçici veriyle yürüyebilir mi bak; yürüyemezse sıradakine geç). Görev tablonda yoksa önce tablonun ilgili dalgasının sonuna sıradaki ID'yle ekle.
4. **Çakışma:** karşı tablonun `çalışılıyor` satırları ve sana açılmış issue'lar (`gh issue list -R ahmetonurevis/kampus --state open --label sahip:<sen>`). Aynı dosyaya veya migration numarasına dokunan iş varsa dur, kullanıcıya şıklı sor.
5. **Durumu yaz ve gönder** (dal açılmadan, entegrasyon dalında tek satır):
   ```sh
   git switch feature/platform-gecisi && git merge --ff-only origin/feature/platform-gecisi
   # satır: Durum `çalışılıyor`, Dal / commit `<sen>/<konu>`; migration/ADR numarası gerekiyorsa Not'a
   git commit -m "Görev durumunu güncelle: OG-012 çalışılıyor" -- docs/is-bolumu/<sahip>.md
   git push origin feature/platform-gecisi
   ```
   İki tarafın oturumu da push'u kendisi yapar. Entegrasyon dalı başka bir çalışma ağacında açıksa bu commit orada yapılır.
6. **Dal:** `git switch -c <sen>/<konu> origin/feature/platform-gecisi` (kebab-case, Türkçe karakter yok). Worktree'de: `git worktree add .claude/worktrees/<konu> -b <sen>/<konu> origin/feature/platform-gecisi` ve `pnpm install --frozen-lockfile`.
7. **Çalışırken:** commit gövdesi görev ID'sini (`OG-012`) anar. Karşı alanda bir şey gerekirse durmadan `gh issue create -R ahmetonurevis/kampus --label sahip:<karşı taraf>` ile iş isteği aç (bağlı görev ID'si gövdede) ve geçici veriyle devam et; beklemen gerekirse satırı `engelli` yap, Not'a beklenen ID'yi yaz. Davranış değişikliği `packages/school-core/changes/<konu>.md` parçası yazar; sürüm ve README sayıları değişmez.
8. Küçük, mantıklı birim yeşil olunca `entegre-et` ile hemen entegrasyona al; uzun yaşayan dal yok.
