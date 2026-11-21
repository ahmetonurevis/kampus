---
etki: minor
---

- Servis seferi ve biniş-iniş kuralı eklendi (`lib/finance-transport-trips.ts`, DOM-FIN-149): sefer güzergâh × İstanbul günü × yöndür, günde bir sefer (409); rehber personel ya da yönetici yürütür, ön büro bütün seferleri okur, öğretmen yalnız rehberi olduğu güzergâhı görür (`transportTripAccess`; K-502).
- `planTransportTripMark`: öğrenci başına bindi, indi (önce biniş), gelmedi; saatler seferin gününde ve ileri tarihsiz; aynı işaretin yinelenmesi değişiklik değildir. Kapanmış seferi yalnız yönetici gerekçeyle ve öğrenciyi araçta bırakmadan düzeltir (K-503). Konum alınmaz.
- `planTransportTripClose`: binip inişi işaretlenmemiş ya da hiç işaretlenmemiş öğrenci varken sefer kapanmaz (422; K-504). `transportTripCounts`, `transportTripCountsLabel` sefer özetini verir.
