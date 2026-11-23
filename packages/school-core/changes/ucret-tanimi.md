---
etki: minor
---

- Personel ücret tanımı kuralı eklendi (`lib/finance-pay-rates.ts`, DOM-FIN-099): ana ücret (aylık brüt, aylık net, saatlik, ders saati), ek ders ücreti (ek ders, nöbet; saat başı) ve yan haklar (yemek, yol, çocuk yardımı, servis; nakdi/ayni, vergiye tabi) yürürlük tarihli tanımlanır. Yuva başına aralıklar çakışmaz, yeni tanım son tanımı bir gün önceye kapatır; bitiş değiştirme ve iptal yalnız son tanımda, iptal kapattığı tanımın eski bitişini geri yazar (`payRateInputSchema`, `planPayRate`, `planPayRateEnd`, `planPayRateCancel`).
- "Şu tarihte geçerli ücret" okuma fonksiyonları: `payRatesOn`, `wageOn`, `payRateState` ve kıdem hesaplayıcısına öneri `severancePaySuggestion`.
