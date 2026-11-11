---
etki: minor
---

- Beceri ilerleme panosu türetimi eklendi (`skills/progress.ts`; IST-057, DOM-BEC-035): okuma, dinleme, yazma ve konuşma için kanıt görevlerine bağlı, tarih sıralı puan noktaları, son değer ve eğilim her okumada hesaplanır, saklanmaz.
- Panoya yalnız değerlendirme türü görevler girer; alıştırma hiçbir rolde eklenmez (Sabah kararı 63, DOM-BEC-041). Kaldırılmış içerikteki görevin puanı panoda gösterilmez (Sabah kararı 64, DOM-KYN-051).
- Beceri ilerleme ucu eklendi: `GET /api/v1/students/:studentId/skill-progress` (`learning` modülü; öğrenci kendisi, veli çocuğu, öğretmen sınıfı/grubu ya da koordinatörlük kapsamı, yönetici herkes; kapsam dışı ve başka kurum 404). React web Akademik Gelişim sayfasında öğrenci ve veli dört beceriyi ayrı küçük grafik ve görev sonucuna bağlanan satırlarla görür.
