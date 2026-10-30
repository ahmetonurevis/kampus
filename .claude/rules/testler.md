---
paths:
  - 'tests/**'
  - '**/*.test.ts'
  - '**/*.spec.ts'
  - 'playwright.config.*'
---

# Test kuralları

- Birim testleri `node:test` + `node:assert/strict` ile `tests/` altında. Tarih `now` parametresiyle sabitlenir; gerçek saate bağlı test yazılmaz.
- E2E Playwright ile `tests/e2e/` altında. Seçiciler erişilebilir rol/etiketle (`getByRole`, `getByLabel`); CSS sınıfı yalnız rolü olmayan yapılar için. `waitForTimeout` yok; otomatik bekleyen beklentiler veya `expect.poll`.
- Her test bağımsızdır ve kendi verisini kurar; sıra varsayılmaz (`fullyParallel`).
- CI'da test başına 45 sn sınır var. Uzun tarama testleri bölünür; `test.slow()` asıl nedeni gizlediği için son çaredir.
- Kalıcılık doğrulaması: demo kalıcılığında `stored(page)` (localStorage snapshot); API'li uygulamada API sorgusu.
