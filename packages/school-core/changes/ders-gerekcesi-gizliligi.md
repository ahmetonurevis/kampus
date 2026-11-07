---
etki: minor
---

Ders iptali ve yedek görevlendirme gerekçesi yalnız yöneticiye açıldı (OG-039; DOM-YTK-068, DOM-YTK-069).

- `schedule` alan ayıklaması `cancelReason` ve `substitutions` alanlarını yönetici dışındaki bütün rollerden (öğretmen, ön büro, öğrenci, veli) çıkarır. Bu roller iptali (`cancelledAt`) ve yedek atandığını (`originalTeacherId`) görür; gerekçeyi gösteren istemci kodu alanın yokluğunu ele almalıdır.
- İş akışı ders ayrıntısı gerekçeyi yalnız yöneticiye gösterir; diğer roller "Ders iptal edildi" ve "Yedek atandı · asıl öğretmen …" satırlarını görür.
- Yedek atanmış derste öğretmen düzenlemeyle değişmez: 422 `lesson_has_substitution` (yedek atama işlemi kullanılır).
- Yedek ve iptal formlarının gerekçe alanı şemanın 500 karakter sınırını taşır (`maxLength`).
