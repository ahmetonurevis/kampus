---
etki: minor
---

- CEFR profilindeki "Tahmini seviye" değerlendirme görevlerinin sonuçlarından da hesaplanır oldu (OG-247; IST-060, DOM-BEC-030…034): otomatik görevde sayılan deneme, öğretmen puanlı görevde kesinleşmiş puanı olan son sürüm; beceri ve hedef seviye atanan içerik sürümünün etiketinden gelir. Alıştırma, iptal edilen atama ve kaldırılmış içerik kanıt adayı olmaz; puanlanmamış teslim ve itirazı süren sonuç nedeniyle dışarıda listelenir. Öğrenci ve veli görünümünde yalnız geri bildirimi açılmış puan kanıttır (DOM-BEC-045). Kur sonu kararının kanıt kopyası (`evidence_snapshot`) aynı öneriyi kullanır. Öneri saklanmaz (`TODO(cefr-gorev-kaniti)` profil ve kur sonu için kapandı; yerleştirme kararı için sürüyor).
- `GET /api/v1/students/:studentId/cefr-profile` yanıtında kanıt ve dışarıda kalan sonuç `task` (`assignmentId`, `scoring`: `auto` | `rubric`) taşır; seviye tespiti bölümünde `null`.
- React web: "Tahmini seviye" bölümü dayandığı kanıt görevlerini (beceri, hedef seviye, puan, başarı, tarih ve geçerlilik bitişi) listeler ve görevine bağlar (yönetici `/yonetici/odevler?gorev=`, öğretmen `/ogretmen/odevler?sekme=gorevler&gorev=`, öğrenci çalışma alanı, veli takip sekmesi; `learning` kapalıysa bağlantısız). Yetersiz kanıtta neden Türkçe söylenir ("2 kanıt ve 8 madde daha gerekir"); personel kanıt sayılmayan sonuçları nedenleriyle görür.
