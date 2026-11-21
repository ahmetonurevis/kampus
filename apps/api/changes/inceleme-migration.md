---
etki: patch
---

- `invoices_fee_kind_check` migration 0072'de `not valid` eklenir, migration 0073'te doğrulanır (ON-318, DOM-FIN-004): ekleme eski satırları taramaz; kural dışı eski taksit doğrulamada yakalanır, düzeltilip 0073 yeniden çalıştırılır. Drizzle bekleyen migration'ları tek transaction'da uyguladığı için kilit kazancı iki migration ayrı yayınlarda uygulanınca geçerlidir.
- Migration 0073, `idempotency_keys`'te saklanan ayrılış ve iade yanıtlarındaki `reason: 'health'` değerini `documented` yapar (ON-318, K-30; 0071'in devamı): bu yanıtların tekrarı yanıt şemasına takılıp 500 veriyordu ve sağlık bilgisi kayıtta kalıyordu. Tekrar yine ilk işlemin başarı yanıtını döndürür.
