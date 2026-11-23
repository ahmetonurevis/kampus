---
etki: minor
---

- Mobil API modunda ön büro için Aday Öğrenciler ve Tanışma Görüşmeleri ekranları eklendi (ON-122; DOM-KAY-003, -005, -030…034): sunucu sayfalı aday listesi (ad, telefon, ilgi araması, aşama süzgeci), aday kartı (iletişimin sahibi, veli, vazgeçme nedeni, planlanmış görüşme ve deneme dersi, değişmez iletişim geçmişi), aşama değiştirme (yalnız geçerli hedefler, vazgeçmede neden, yeniden açmada kardeş seçimi) ve görüşme notu; yaklaşan ve geçmiş görüşme listesi (dil okulunda tür süzgeci). Yazan komutlar kartın sürümünü `If-Match` ile taşır, hata pencere içinde Türkçe gösterilir. Yeni aday, bilgi düzeltme, planlama ve kesin kayıt web'de kalır. Aday aşaması ve görüşme olayları hesabı web ile ortaktır (`react-shared/prospect-model.ts`). Ekranlar, kayıt satırları (`PROSPECTS_SCREEN`, `PROSPECT_MEETINGS_SCREEN`) `ONUR_SCREENS`'e eklenince menüde görünür.
