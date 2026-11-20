---
etki: minor
---

Çok kaynaklı geri bildirim kuralları eklendi (DOM-FIN-134; ON-212): `lib/finance-staff-feedback.ts` performans dönemine bağlı tek geri bildirim şablonunu (öz değerlendirme soru biçimi; ilk yanıttan sonra ve kapanan dönemde değişmez; K-457), değerlendirilen × değerlendiren atamasını (yönetici ya da meslektaş ilişkisi, kendini değerlendirme yok, yalnız dönemde performans kaydı olan personel) ve yöneticinin değerlendiren adına kâğıt form ya da e-postayla yanıt girişini, gerekçeli geri almayı ve atanan/yanıtlanan oranını (`multiSourceFeedbackSummary`; K-458) tanımlar. Meslektaş yanıtı anonimdir: `multiSourceFeedbackResult` yönetici yanıtlarını adıyla, meslektaş yanıtlarını yalnız değerlendirme aşamasından sonra ve en az N yanıtla (kurum ayarı 3–10, varsayılan 3) toplu verir; az cevaplanan soru da gizlidir (K-459).
