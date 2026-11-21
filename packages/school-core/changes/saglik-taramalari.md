---
etki: minor
---

- Okul sağlığı taraması kuralı eklendi (`lib/finance-health-screenings.ts`, DOM-FIN-153, ON-163). Tarama oturumu: tür (boy-kilo, görme), gün (180 gün geriden 90 gün ileriye), hedef sınıflar, yapan (kurumun etkin personeli ya da dış sağlık personelinin adı) ve kurumun eşikleri (BKİ alt/üst, görme keskinliği alt sınırı) (`healthScreeningSessionInputSchema`, `planHealthScreeningSession`); açık oturum düzeltilir, sonuç girildikten sonra eşik ve sonuçlu sınıf kilitlenir (`planHealthScreeningSessionUpdate`; K-514).
- Sonuç: öğrenci başına tek sonuç (tarandı, katılmadı, reddetti); boy cm ve kilo kg tek ondalık (mm ve 100 g tamsayısı saklanır), BKİ hesaplanır (`bmiOf`); görme iki göz ondalık keskinlik ve gözlük. Eşik aşılırsa "ileri değerlendirme önerilir" kendiliğinden konur (`thresholdExceeded`, `planHealthScreeningResults`); persentil hesabı yoktur (K-514).
- Yayımlama (`assertHealthScreeningPublish`; K-515) ve küçük grupları gizleyen sınıf raporu (`healthScreeningReport`, `referralVisible`; en az 5; K-516).
- Sağlık erişim günlüğü eylem etiketlerine tarama ayrıntısı okuması eklendi (`HEALTH_ACCESS_ACTION_LABELS`: `finance.health_screening.read` → "Sağlık taraması"; DOM-FIN-156).
