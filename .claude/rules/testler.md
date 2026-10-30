---
paths:
  - 'tests/**'
  - 'apps/api/test/**'
  - '**/*.test.ts'
  - '**/*.spec.ts'
  - 'playwright.config.*'
---

# Test kuralları

Ayrıntı: `docs/muhendislik/test-stratejisi.md`.

- Piramit: birim ~%70, API bütünleşik ~%25, e2e ~%5. Kural en alt katmanda test edilir; e2e iş kuralının bütün dallarını denemez.
- Birim testleri `node:test` + `node:assert/strict` ile `tests/` altında. Tarih `now` parametresiyle sabitlenir; gerçek saate bağlı test yazılmaz. API saati `buildApp({ clock })` ile.
- Test verisi seed (`createSeed(new Date(now))`) ve fabrikalardan; varsayılan geçerli, yalnız ilgili alan değiştirilir. Test kimlikleri önekli; mevcut seed kimlikleri değiştirilmez. Gerçek kişi verisi yok.
- Başarısızlık testi kaydın değişmediğini de doğrular (`unchangedOnFailure`, API'de satır karşılaştırması).
- API testleri `app.inject` + dosya başına bellek içi PGlite + üretim migration'ları. Her test kendi kurumunu kurar; tablo boşaltma ve sıra varsayımı yok. Eşzamanlılık testleri PostgreSQL 16 ile `test:pg` takımında.
- Her uç için: 401, 403, başka kurum kaydına okuma/yazma 404 ve B değişmemiş, listede B kaydı yok, gövdedeki `institutionId` etkisiz, rol kapsamı, modül kapalı 403. Açık uçlar listesi dışındaki her rota kimliksiz 401.
- E2E Playwright ile `tests/e2e/` (Vue demosu) ve `tests/e2e-react/` (React web + API; temiz durum stratejisi test stratejisi §6) altında. Seçiciler erişilebilir rol/etiketle (`getByRole`, `getByLabel`); CSS sınıfı yalnız rolü olmayan yapılar için. `waitForTimeout` yok; otomatik bekleyen beklentiler veya `expect.poll`.
- Her test bağımsızdır ve kendi verisini (API'li uygulamada kendi kurumunu) kurar; sıra varsayılmaz (`fullyParallel`). Kurulum UI'dan değil test ucundan/seed'den.
- React e2e'de veri yazan test seed kurumuna yazmaz: `tenant()` fixture'ıyla kendi kurumunu kurar (`support/tenant.ts`). Satırları `rows.all()` ile değil `expectEveryRow`/`expect.poll` ile okur (eski sayfa yeni yanıta kadar ekranda kalır).
- CI'da test başına 45 sn sınır var. Uzun tarama testleri bölünür; `test.slow()` ve zaman aşımı artırma düzeltme sayılmaz.
- Kalıcılık doğrulaması: demo kalıcılığında `stored(page)` (localStorage snapshot); API'li uygulamada API sorgusu.
- Flaky: birim/API'de yeniden deneme yok; e2e'de yalnız CI'da 1. Kararsız test iki iş gününde düzeltilir veya `test.fixme('… kayıt #<no>')` ile karantinaya alınır (en fazla 3, en fazla 2 hafta).
- Kapsam eşikleri (satır/dal): school-core 90/85, api 85/80, api-client 90/85, react-shared 80/70. Eşik yalnız yükselir.
- Hata düzeltmesi önce hatayı üreten testle gelir.
