---
name: dogrula
description: Kampüs'te bir değişikliği bitmiş saymadan önceki doğrulama merdiveni — hangi komutun ne zaman koşulacağı, e2e ve CI hatalarının nasıl ayıklanacağı, mobilin Android araç zinciri olmadan nasıl doğrulanacağı. Kod değiştirdikten sonra, commit öncesi ve CI kırmızıyken kullan.
---

# Doğrulama merdiveni

Değişikliğin büyüklüğüne göre alttan başla; bir basamak geçmeden üstüne çıkma.

1. **Hızlı** (her değişiklikte):
   - `pnpm format:check` (hata varsa `pnpm exec prettier --write <dosyalar>`)
   - `pnpm lint`
   - `pnpm typecheck` (script tanımlandıktan sonra)
   - İlgili birim testi: `node --test tests/<dosya>.test.<js|ts>`
2. **Paket** (core, API veya uygulama değiştiyse): `pnpm test` (tümü, ~10 sn), `pnpm build`, API varsa `pnpm --filter @kampus/api test`.
3. **Arayüz** (ekran veya akış değiştiyse): ilgili e2e — `pnpm test:e2e tests/e2e/<dosya>.spec.<js|ts>` ya da `-g "<test adı>"`.
4. **Tam** (görev bitmeden): `pnpm test:e2e` tamamı (~4,5 dk). Çıktı uzun: `--reporter=line 2>&1 | tail -40` kullan ya da `dogrulayici` ajanına ver.

## E2E hata ayıklama

- Port 5173 eski bir `vite` tarafından tutuluyorsa Playwright onu kullanır (CI dışında); takılırsa `lsof -ti:5173 | xargs kill`.
- Tek test: `pnpm test:e2e <spec> -g "<ad>" --trace on --reporter=line`; ardından `test-results/<test>/error-context.md` ve `test-failed-1.png` dosyalarını Read ile oku.
- CI: `gh run list --limit 3`, sonra `gh run view <id> --log-failed | grep -E '✘|Error|Timeout|›'`.
- Süre aşımı gerçek hata değildir: önce testin yerel süresine bak. Soğuk Vite optimizer'ı CI'da ilk sayfayı 30 sn'ye kadar geciktirebilir.

## Mobil (Android araç zinciri yokken)

- `pnpm lint`, `node --test tests/mobile*.test.*` ve `pnpm --filter @kampus/mobile export:web` (~2 dk; Metro paketlemesi derleme ve içe aktarma hatalarını yakalar).
- `pnpm build:apk` Java ve Android SDK ister; yoksa raporda "APK doğrulanmadı" diye açıkça yaz.

## Rapor

Sonucu sayılarla yaz: "lint temiz, 80/80 birim, build ok, e2e 60/60 (4,5 dk)". Kırmızıyı gizleme; atlanan basamağı nedeniyle belirt.
