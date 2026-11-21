---
etki: minor
---

- Ziyaretçi kaydı kuralı eklendi (`lib/finance-visitors.ts`, DOM-FIN-141): giriş (ad soyad, kimlik görüldü işareti ve belge türü, isteğe bağlı telefon, amaç, ziyaret edilen personel, veli görüşmesinde öğrenci, giriş anı, kart, aydınlatma sürümü), çıkış, kart iadesi, anonimleştirme ve ayar şemaları; kimlik numarası alınmaz (K-478).
- `planVisitorCheckIn`, `planVisitorCheckOut`, `planVisitorBadgeRelease`: giriş anı gelecekte ve 24 saatten eski olamaz, ziyaret edilen kişi kurumun etkin personeli, kart havuzda ve iade edilmemiş başka ziyarette değil; çıkış bir kez ve girişten sonra, kart iade ya da kayıp işaretlenince serbest kalır (K-478, K-479).
- `visitorRetentionDueOn`, `assertVisitorAnonymization`, `planVisitorSettings`: kayıt ziyaret gününden kurum ayarlı süre (1–365 gün, varsayılan 30) saklanır; süresi dolan ya da ziyaretçinin talebiyle çıkışı yapılmış kayıt anonimleştirilir; iade edilmemiş kart havuzdan çıkarılamaz (K-480).
