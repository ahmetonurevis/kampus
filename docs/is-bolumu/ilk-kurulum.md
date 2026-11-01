# İlk kurulum

Yeni bir makinede ya da yeni bir klonda Kampüs'e başlarken izlenir. Hem geliştirici hem Claude Code oturumu için yazıldı: oturum başında `apps/api/.env` ya da `node_modules` yoksa hook bu dosyayı gösterir. Kurallar [.claude/rules/ortak-calisma.md](../../.claude/rules/ortak-calisma.md), görev tabloları [onur.md](onur.md) ve [oguzhan.md](oguzhan.md).

## 1. Bir kerelik geçiş (Onur)

Eski klasör yeni kurallardan önce kuruldu. Migration'lar 0016–0022 olarak yeniden numaralandı; eski yerel veritabanı yeni migration zinciriyle uyumsuzdur. Yeni klasörde Claude Code'un proje hafızası da sıfırdan başlar, eski bilgi yeni kurallarla çelişmez.

1. Eski klasörde gönderilmemiş iş var mı bak:
   ```sh
   git status
   git stash list
   git log --branches --not --remotes --oneline
   ```
   Çıktı boş değilse işi commit'le ve yedek dala gönder: `git switch -c onur/yedek && git add -A && git commit -m "Eski klasördeki işi yedekle" && git push origin onur/yedek`. Stash varsa önce bu dalda `git stash apply` ile açıp commit'e kat.
2. Repoda olmayan özel dosyaları yedekle: `apps/api/.env`, varsa `.claude/settings.local.json`, `CLAUDE.local.md`, imza ve anahtar dosyaları.
3. Eski veritabanı kapsayıcısını durdur, verisini silme: `docker compose down` (`-v` yok; birim yerinde kalır).
4. Yeni klasöre temiz klon al ve entegrasyon dalına geç. Klasör adı eskisinden farklı olsun: Docker Compose birim adını klasör adından türetir (`<klasör>_kampus-postgres`), aynı ad eski, uyumsuz veritabanını yeniden bağlar.
   ```sh
   git clone git@github.com:ahmetonurevis/kampus.git kampus-platform
   cd kampus-platform
   git switch feature/platform-gecisi
   ```
5. Yedeklediğin `apps/api/.env`'i yeni klasöre koy, `.env.example`'daki yeni değişkenlerle karşılaştır.

## 2. Kurulum

Node.js 24 (`.nvmrc`) ve pnpm 11.21 kullanılır. Komutlar README "Çalıştırma" ve "API" bölümlerindedir.

```sh
pnpm install --frozen-lockfile
cp apps/api/.env.example apps/api/.env      # BETTER_AUTH_SECRET'ı değiştir: openssl rand -base64 32
docker compose up -d                        # PostgreSQL 16, 127.0.0.1:5433
pnpm --filter @kampus/api db:migrate
pnpm --filter @kampus/api db:seed           # idempotent örnek kurumlar ve kullanıcılar
```

- `auth:schema` yalnız Better Auth sürümü ya da eklentisi değiştiğinde gerekir: `pnpm --filter @kampus/api auth:schema`.
- `db:migrate` eski migration kaydıyla durursa yeni klasör eski birime bağlanmış demektir (`docker volume ls` ile bak). Klasör adını değiştir ya da eski birimi kullanıcıya sorarak sil; yerel veritabanında yalnız örnek veri bulunur.
- Compose 5433 portunu kullanır; eski kapsayıcı açıksa önce eski klasörde `docker compose down`.
- e2e için bir kez: `pnpm exec playwright install chromium`.
- Çalıştırma: `pnpm dev:api` (3000) ve `pnpm dev:react` (5174).

Hızlı doğrulama:

```sh
pnpm test:hooks
pnpm typecheck
pnpm test
```

## 3. Kontroller

- Git kimliği alan haritasıyla eşleşmeli: `git config user.name` çıktısı `.claude/alanlar.json`'daki `gitName` ile aynı olmalı (Onur: `Ahmet Onur Evis`, Oğuzhan: `Oguzhan Demirci`). Farklı bir ad kullanılıyorsa `git config kampus.sahip onur` (ya da `oguzhan`).
- Hook'lar çalışıyor mu: `pnpm test:hooks` yeşil olmalı. Bir yolun sahibi: `echo apps/api/src/services/payments.ts | node .claude/hooks/alan-koruma.ts --classify`.
- GitHub CLI giriş yapmış olmalı: `gh auth status`. Oturum hook'u iş isteklerini `gh` ile okur.

## 4. Claude oturumunun ilk açılışı

Yeni klasörde ilk açılan oturum sırayla şunları yapar:

1. Kuralları okur: `CLAUDE.md` "İki geliştiriciyle çalışma", `.claude/rules/ortak-calisma.md`, `docs/muhendislik/git-ve-surum.md` §7, bu dosya ve [README](README.md) (kümeler, sözleşmeler, bağımlılıklar).
2. Kendi görev tablosunu ve karşı tarafınkini okur (oturum hook'u özetini gösterir): `git show origin/feature/platform-gecisi:docs/is-bolumu/<sahip>.md`.
3. Açık iş isteklerine bakar: `gh issue list -R ahmetonurevis/kampus --state open --label sahip:<sahip>`.
4. `is-baslat` ile ilk görevi alır: satır `çalışılıyor` olur, entegrasyon dalında küçük bir commit'le gönderilir, sonra dal açılır.
5. Onur için ilk görev birleştirme incelemesidir (ON-001, #9): migration 0016–0022, taşınan kesin kayıt kuralları, aday ekranları ve veli kuralı (okulda veli her yaşta zorunlu; dil okulu ve kursta 18 yaş üstünde gerekmez).
