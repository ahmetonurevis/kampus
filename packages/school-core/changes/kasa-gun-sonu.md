---
etki: minor
---

- Kasa ve gün sonu eklendi (ON-064, IST-113; DOM-FIN-036): `lib/finance-day-closings.ts` yöntem bazında gün özetini, kasa farkını, kapanış ve yeniden açma planını, kapatılmış güne tahsilat ve kapalı bugüne iptal engelini hesaplar. Kapatma yönetici ve ön büroda, yeniden açma yalnız yöneticide ve gerekçelidir. `parseAmountInput` kasa sayımı için `allowZero` ve `maxCents` seçenekleri aldı; varsayılan davranışı değişmedi.
