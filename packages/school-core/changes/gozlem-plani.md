---
etki: minor
---

Ders gözlem planı kuralları eklendi (DOM-FIN-139; ON-207): `lib/finance-observation-plans.ts` öğretmen × gözlemci atamasını, gün, saat ve süreyi, form sürümünü, isteğe bağlı sınıf, ders ve performans dönemini, planlandı → ertelendi → gerçekleşti ya da iptal durumlarını (erteleme ve iptal gerekçeli) tanımlar. Gözlemcinin ve gözlenenin aynı saatte iki planı olamaz, öğretmen başına dönemde en çok 3 plan açılır, geçmiş güne plan açılmaz (K-472); gözlem plan günü gelince plandan başlatılır, gecikme hesaplanır (K-473); görünürlük yönetici ve planın öğretmenleridir (K-474). `lib/finance-lesson-observations.ts` kişi ve kayıt denetimini `assertObservationPeople` ve `assertObservationRecords` olarak dışa açar; davranış değişmedi.
