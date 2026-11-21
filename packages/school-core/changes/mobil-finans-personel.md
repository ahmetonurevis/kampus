---
etki: minor
---

- Mobil API modunda yönetici ve ön büro için Finans & Tahsilat ekranı eklendi (ON-123, DOM-FIN-030…033): kurum geneli toplamlar, taksit listesi (arama, durum süzgeci, sayfa) ve ayrıntısı, tahsilat kaydı (kısmi ödeme, kalan tutar, nakit ayarı, banka hesabı, referans, geçmiş gün), tahsilat geçmişi (arama, yöntem, MEBBİS ve gün süzgeci), MEBBİS işareti ve yönetici gerekçeli iptali. Sonucu belirsiz tahsilatta form kilitlenir, yalnız aynı gövde aynı `Idempotency-Key` ile yeniden gönderilir. Taksit satırı ve tahsilat gövdesi web ile ortaktır (`react-shared/finance-model.ts`). Öğrenciye açılmaz. Ekran, kayıt satırı (`FINANCE_STAFF_SCREEN`) `ONUR_SCREENS`'e eklenince menüde görünür.
