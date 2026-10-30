---
name: dogrula
description: Kampüs'te bir değişikliği bitmiş saymadan önceki doğrulama merdiveni — hangi komutun ne zaman koşulacağı (format, lint, typecheck, birim, API/PGlite, web-react, kapsam, e2e), e2e ve CI hatalarının ayıklanması, mobilin Android araç zinciri olmadan doğrulanması. Kod değiştirdikten sonra, commit öncesi ve CI kırmızıyken kullan.
---

# Doğrulama merdiveni

Değişikliğin büyüklüğüne göre alttan başla; bir basamak geçmeden üstüne çıkma. Henüz birleşmemiş paketlerin komut adları kural ve belgedeki gibidir (paket birleşince doğrulanır).

1. **Hızlı** (her değişiklikte):
   - `pnpm format:check` (hata varsa `pnpm exec prettier --write <dosyalar>`)
   - `pnpm lint`
   - `pnpm typecheck` (`pnpm -r --if-present typecheck`, sıfır hata)
   - İlgili birim testi: `node --test tests/<dosya>.test.ts`
2. **Paket** (core, API, web-react veya uygulama değiştiyse):
   - `pnpm test` (birim), `pnpm build`
   - API: `pnpm --filter @kampus/api test` (`app.inject` + bellek içi PGlite). `apps/api/src/db/**` veya `drizzle/**` değiştiyse Docker'da PostgreSQL 16 ile `test:pg` takımı.
   - Kapsam (yeni kural eklerken veya eşik değişince): `node --test --experimental-test-coverage --test-coverage-lines=<n> --test-coverage-branches=<n>`; eşikler school-core 90/85, api 85/80, api-client 90/85, react-shared 80/70 (`test-stratejisi.md` §2). Eşik yalnız yükselir.
3. **Arayüz** (ekran veya akış değiştiyse): ilgili e2e — `pnpm test:e2e tests/e2e/<dosya>.spec.ts` ya da `-g "<test adı>"`. Yeni web `pnpm dev:react` ile 5174 portunda açılır; eski Vue `pnpm dev` 5173'tür. Vue e2e dev sunucusunu `E2E_VUE_PORT` (varsayılan 5173, `--strictPort`, mevcut sunucu yeniden kullanılmaz) portunda açar; paralel ajanda `E2E_VUE_PORT=<port> pnpm test:e2e` ve görevde verilen portu kullan.
   3b. **React web + API arayüzü** (`apps/web-react`, `apps/api` ya da `tests/e2e-react/` değiştiyse): `docker compose up -d` sonrası `pnpm test:e2e:react` (~15 sn; `kampus_e2e` veritabanını sıfırlar, API 3020 ve önizleme 4180'i kendisi açıp kapatır; CI'daki aynı komut için `CI=1 pnpm test:e2e:react`). Port/veritabanı çakışırsa `E2E_API_PORT`, `E2E_WEB_PORT`, `E2E_DB_NAME`.
4. **Tam** (görev bitmeden, yalnız görev istiyorsa): `pnpm test:e2e` tamamı (~4,5 dk), `--reporter=line 2>&1 | tail -40` ya da `dogrulayici` ajanı.

## E2E hata ayıklama

- CI'da e2e derlenmiş uygulamayla `vite preview` üzerinde koşar (önce `pnpm build`); yerelde dev sunucusu. Yerelde geçip CI'da kırılan testi `pnpm build` + `vite preview` ile yeniden dene.
- Port eski bir `vite` tarafından tutuluyorsa Vue e2e "already used" hatasıyla durur (mevcut sunucu yeniden kullanılmaz); başka `E2E_VUE_PORT` ver ya da `lsof -ti:<port> | xargs kill`.
- Tek test: `pnpm test:e2e <spec> -g "<ad>" --trace on --reporter=line`; ardından `test-results/<test>/error-context.md` ve `test-failed-1.png` dosyalarını Read ile oku.
- CI: `gh run list --limit 3`, sonra `gh run view <id> --log-failed | grep -E '✘|Error|Timeout|›'`.
- CI'da test başına 45 sn sınır var; süre aşımı çoğunlukla soğuk Vite optimizer'ıdır ama `test.slow()`/süre artırma düzeltme değildir, testi böl.
- Kararsız testte yeniden deneme yok (e2e'de yalnız CI'da 1); `test.fixme` karantinası `.claude/rules/testler.md`'de.

## Mobil (Android araç zinciri yokken)

- `pnpm lint`, `node --test tests/mobile*.test.*` ve `pnpm --filter @kampus/mobile export:web` (~2 dk; Metro derleme ve içe aktarma hatalarını yakalar).
- `pnpm build:apk` Java ve Android SDK ister; yoksa raporda "APK doğrulanmadı" yaz.

## Rapor

Sonucu sayılarla yaz: "lint temiz, typecheck 0 hata, 80/80 birim, API 120/120, kapsam %91/%86, build ok, e2e 60/60 (4,5 dk)". Kırmızıyı gizleme; atlanan basamağı nedeniyle belirt.
