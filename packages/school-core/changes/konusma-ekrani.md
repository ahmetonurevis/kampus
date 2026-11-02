---
etki: patch
---

- Öğrenci konuşma görevi web ekranı eklendi (OG-050; IST-051, DOM-BEC-050, 052, 054): `?yaz=<atama>` çalışma alanında tarayıcıda ses kaydı (hazırlık süresi, süre sınırında otomatik durma, gönderilmeden önce dinleme, hak yettiği sürece yeniden kayıt), dosya işlenirken yoklama ve `ready` olunca kendiliğinden teslim. Ses kaydı rızası yoksa kayıt düğmesi çıkmaz, görevin yüz yüze değerlendirileceği yazılır. Mobil kayıt ekranı, deneme hakkının sunucuda sayımı (`TODO(konusma-deneme-sunucu)`) ve aydınlatma gösterim kaydı (`TODO(konusma-aydinlatma-kaydi)`) henüz yok.
- İlk teslimden sonra yazma ve konuşma çalışma alanı sürüm ayrıntısı yenilenirken yükleniyor ekranına dönmez; konuşma kaydında teslim iletisi ve atılan kayıt sayısı korunur.
