---
etki: minor
---

- Kayıt dondurma uçları eklendi (ON-067; DOM-DIL-052, IST-084): `/api/v1/finance/enrollment-freezes` liste, ayrıntı ve talep; `/:freezeId/approve`, `/reject`, `/return`. Modül `crm`, yalnız dil okulunda; tablo `enrollment_freezes` (migration 0065). Başlangıç günü gelen onaylı dondurmayı işleyen `enrollment-freezes.start` işi tanımlandı, zamanlama listesine eklenmesi bekliyor. Ayrılış açık dondurma kaydını kapatır. Talep yalnız neden kategorisi alır, onay ve ret gövde almaz; tabloda serbest metin kolonu yoktur (K-20, DOM-KAY-024).
