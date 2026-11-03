---
etki: minor
---

- İçerik havuzunda okuma etkinliği formu (OG-984; IST-042, DOM-BEC-006, DOM-KYN-013): quiz ve alıştırma seti "Yeni içerik" formunda kurulur ve taslakta düzenlenir. Bağlı içerik seçicisi (iç içe pencere; arama, CEFR ve sınıf düzeyi süzgeci) yalnız yayındaki okuma parçasını ve soruları seçtirir; soru listesi düğmeyle sıralanır, çıkarılır, madde puanı alır ve satırda alt beceri etiketi görünür. Bağlı parça ve soru hataları (`passage_*`, `quiz_item_*`) ortak Türkçe iletiyle alanın altına yazılır.
- Hata düzeltmesi: kaynak ayrıntısının `publicationIssues` listesi bağlı okuma parçasını okur; yayındaki parçaya bağlı etkinlikte artık `passage_missing` görünmez. Web paneli quiz/alıştırma setinde "Onaya gönder"i bağlı sürümleri bilmediği için kilitliyordu; bağlı sürüm sorunları artık sunucunun yayım sorunlarından okunur (`LINKED_CONTENT_MESSAGES`).
