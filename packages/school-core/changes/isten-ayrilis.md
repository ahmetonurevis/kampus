---
etki: minor
---

- İşten ayrılış süreci eklendi (DOM-FIN-118, ON-180): `lib/finance-staff-separations.ts` ayrılış dosyası şemalarını (açılış, düzeltme, adım işareti, iptal), ayrılış nedenlerini ve SGK çıkış kodu önerisini (`SGK_EXIT_CODE_SUGGESTIONS`, H-85), dosya kurallarını (`planStaffSeparation`, `planStaffSeparationUpdate`, `planStaffSeparationStep`, `planStaffSeparationComplete`, `planStaffSeparationCancel`; K-403) taşır.
- Kontrol listesi `staffSeparationSteps`: zimmet iadesi, avans ve icra, kullanılmayan izin, kıdem ve ihbar (isteğe bağlı), hesap kapatma ve hizmet belgesi; kayıttan okunan ve elle işaretlenen adımlar, `missingSeparationSteps` (K-404).
- Bildirim süresi bilgisi `staffSeparationNotice` (4857 md. 17; yalnız istifa ve işveren feshinde, K-405, H-86) ve ilişik kesme belgesi metni `staffSeparationParagraphs`.
