---
etki: minor
---

- Servis güzergâhı kuralı eklendi (`lib/finance-transport.ts`, DOM-FIN-142): araç (plaka, kapasite, sürücü adı ve telefonu, isteğe bağlı rehber personel), sabah/akşam yönlü güzergâh ve sıralı, saatli duraklar (durak adı ya da semt; açık adres alınmaz) şemaları; sürücü telefonu yalnız maskeli gösterilir (K-481).
- `planTransportAssignment`, `planTransportStops`, `planTransportVehicleUpdate`, `planTransportRouteUpdate`: öğrenci aynı yönde tek güzergâhta olur, araç kapasitesi aşılamaz (409); kapasite atanmış öğrenci sayısının altına inemez, atanmış durak kaldırılamaz (K-482).
- Kulüp kuralı eklendi (`lib/finance-clubs.ts`, DOM-FIN-142): kulüp (ad, sorumlu öğretmen, kontenjan, gün ve saat), üyelik ve oturum yoklaması; üyelik tekil ve kontenjan aşılamaz, aynı günün oturumu yinelenmez (409), yoklama bütün etkin üyeleri işaretler (K-483).
- `finance-trip-plans.ts` plaka kalıbını `TRIP_PLATE_PATTERN` olarak dışa verir.
