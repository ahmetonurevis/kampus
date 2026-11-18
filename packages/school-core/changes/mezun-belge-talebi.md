---
etki: minor
---

- Mezun belge talebi kuralları eklendi (ON-260, DOM-KAY-044; K-328…K-331): `lib/enrollment-alumni-documents.ts` talep (`planAlumniDocumentRequest`: yalnız mezun ya da ayrılmış kişi, diploma örneği yalnız okulda ve mezuna, talep eden kendisi, velisi ya da vekili, reşit kişinin velisi için yazılı rıza, ücretin adetle dondurulması), durum akışı (`alumniRequestActions`, `planAlumniRequestStart`, `planAlumniRequestReady`, `planAlumniRequestDeliver`, `planAlumniRequestReject`), yıl bazlı belge numarası (`alumniDocumentNumber`), öğrenim belgesi ve not dökümü içeriği (`buildAlumniEducationCertificate`, `buildAlumniTranscript`), yaş (`isAdultOn`) ve ücret ayarı şeması (`alumniDocumentFeesSchema`, `updateAlumniDocumentFeesSchema`).
