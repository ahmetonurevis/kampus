---
etki: patch
---

- Deneme cevap kaydı ve tesliminde hata sırası taslak ucuyla aynı yapıldı (OG-996; DOM-KYN-051): kapsam 404 → rol 403 → sürüm 409 → içerik kuralı (422 `content_unavailable`, 409 `resource_license_expired`) → core kuralı. Kaldırılmış içerikte eski sürümle gelen istek artık 409 `version_conflict` alır, güncel sürümle 422 `content_unavailable`; kayıt değişmez. İçerik kapısı ve puanlama bağlamı aynı sürüm okumasını kullanır.
- Kaldırılmış quizin denemeleri liste ve ayrıntıda 404 yerine döner (OG-997; DOM-KYN-051): deneme kaydı ve cevaplar korunur, soru ve parça metni ve cevap anahtarı gelmez; yanıtta yeni `contentRemoved` alanı kaldırmayı söyler. Kaldırma cevap anahtarını sildiği ve puan saklanmadığı için (DOM-BEC-010) puan hesaplanamıyorsa `result: null` döner. Kapsam dışı ve başka kurum 404 aynen kalır. Web öğrenci, veli ve personel sonuç ekranında "Bu içerik kaldırıldı." notunu, personelin deneme listesinde "İçerik kaldırıldı" etiketini gösterir.
