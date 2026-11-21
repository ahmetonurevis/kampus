---
etki: minor
---

- Mobil API modunda yönetici ve ön büro için Kayıt Yenileme ekranı eklendi (ON-122; IST-100, DOM-KAY-020, DOM-FIN-005): sunucu sayfalı yenileme planları (öğrenci adı araması, durum süzgeci) ve ayrıntı (dönem ve sınıf geçişi, plan anındaki ücret kararı ve tavan açıklaması, yeni dönem taksitleri). Ekran salt okurdur; plan, toplu yenileme, dönem geçişi ve sözleşme PDF'i web'de kalır. `renewal` ya da `finance` modülü kapalıysa ekran kapalıdır. Satır ve ayrıntı bölümleri web ile ortaktır (`react-shared/renewal-model.ts`). Ekran, kayıt satırı (`RENEWALS_SCREEN`) `ONUR_SCREENS`'e eklenince menüde görünür.
