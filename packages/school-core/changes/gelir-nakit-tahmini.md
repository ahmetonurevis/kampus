---
etki: minor
---

- Gelir ve nakit akışı tahmini eklendi (ON-246, ON-247; IST-104, IST-105, IST-117; DOM-FIN-063): `lib/finance-forecast.ts`. `revenueForecast` yılın kesin gelirini (taksitler, yeni kayıt ve yenileme ayrımı), sözleşmelerdeki indirim ve burs etkisini ve açık adayların huni adımı dönüşüm oranı ile tarife fiyatından beklenen gelirini hesaplar; `cashFlowForecast` taksit vadelerinden aylık planlanan ve geçmiş tahsil oranıyla beklenen tahsilatı, gecikmiş alacaktan geç tahsil beklentisini, ödenmemiş iadeyi ve elle girilen aylık gideri verir. Varsayımlar sonuçta döner; CSV üreticileri `revenueForecastCsv`, `cashFlowForecastCsv`.
- Kayıt hunisinde adayın ulaştığı adım dışa açıldı: `funnelReach` (`lib/enrollment-funnel.ts`).
