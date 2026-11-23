---
etki: minor
---

- Saat ücretli öğretmenin ders saati hakediş dökümü eklendi (`lib/finance-hourly-lesson-payouts.ts`, DOM-FIN-167, IST-087, K-556…K-558): `hourlyLessonPayout` ay için öğretmen başına gün gün ders satırları (verildi, iptal, yedeğe devredildi, telafi, yedek, tatil, izinli, henüz yapılmadı; dil okulunda plandan grup oturumu ve programla çakışan oturum), verilen saat, iptal ve telafi sayıları ve her satırın gününde yürürlükteki ana ücretten tutar (ders saati ücreti × ders saati, saatlik ücret × dakika ÷ 60; tanım yoksa ya da aylıksa tutar boş ve uyarılı) hesaplar. `groupPayoutSessions` açılmış grupların haftalık kalıbından ay oturumlarını üretir; `priceLine`, `payoutPayBasis`, `hourlyPayoutCsv`, `hourlyPayoutQuerySchema` ve etiketler dışa açıldı.
- Programdan ek ders önerisinde (`lib/finance-lesson-hour-suggestions.ts`) ders durumlarını belirleyen iç işlev `lessonItemsFor` ve gün aralığı denetimi `dayInRanges` dışa açıldı; davranış değişmedi.
