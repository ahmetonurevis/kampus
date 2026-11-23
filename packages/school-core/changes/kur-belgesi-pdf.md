---
etki: minor
---

- Dil okulu menüsüne "Başarı Belgeleri" sayfası eklendi (OG-088; IST-081, DOM-DIL-080…082): `platform/navigation.ts` `API_LANGUAGE_SCHOOL_PAGES` yol `basari-belgeleri`, modül `academic` (kapalıysa sayfa gizlenir). Yönetici YÖNETİM, öğretmen ve veli AKADEMİK, öğrenci GELİŞİMİM ("Başarı Belgelerim") altında görür; ön büro görmez, okulda (`school`) görünmez.
- React web: personel belgeleri listeler, onaylı geçti kararından belge düzenler, gerekçeyle iptal eder, iptalin yerine yeniden düzenler ve MEBBİS izini işaretler; öğrenci ve 18 yaş altı kursiyerin velisi yalnız geçerli belgelerini görür. Kurum başarı belgesi PDF'i düzenleme anının kopyasından üretilir, doğrulama kodu ve QR taşır; iptal edilmiş belge "İPTAL EDİLDİ" işaretlidir.
- Kimliksiz doğrulama sayfası `/belge-dogrula/:kod` (DOM-DIL-082): giriş gerektirmez, kod adresten ya da formdan gelir ve core `normalizeVerificationCode` ile kanonik biçime iner; yalnız durum, baş harfler, kur, düzenleme tarihi ve kurum adı gösterilir. Router `basename`'i Vite `BASE_URL`'den kurulur; alt yolda yayında QR adresi aynı rotaya çözülür.
- QR üretimi `qr@0.7.2` paketiyle yapılır (yalnız belge açılınca tembel yüklenir): npm'de tek bakımcısı vardır, alternatiflerde de durum aynı olduğundan Sabah kararı 87 ile istisna olarak kabul edildi.
