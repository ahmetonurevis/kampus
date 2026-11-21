---
etki: minor
---

- Servis aracı ve personeli belgesi kuralı eklendi (`lib/finance-transport-documents.ts`, DOM-FIN-147): araç (muayene, zorunlu trafik sigortası, koltuk sigortası, okul servis aracı uygunluk/izin belgesi), aracın kayıtlı sürücüsü ve kurum üyesi personel (ehliyet ve sınıfı, SRC, psikoteknik, adli sicil) belgeleri; kişi belgesinde içerik ve numara tutulmaz, adli sicil ve psikoteknik yalnız yöneticide (K-496, K-497).
- `planTransportDocument`: aynı öznenin aynı türdeki yeni belgesi eskisinin yerine geçer ("Diğer" hariç), geçerli belgeden eski ve gelecek tarihli belge, PDF/görsel dışı ve 10 MB üstü dosya reddedilir (K-496).
- `transportDocumentStatus`, `vehicleFitness`, `transportDocumentSettingsSchema`: kurum ayarlı uyarı penceresi (1–180 gün, varsayılan 30); zorunlu belgesi süresi geçmiş araç "uygun değil", eksik belge ayrı uyarı (K-498).
