---
etki: minor
---

- Personel özlük kartı kuralı eklendi (`lib/finance-personnel-files.ts`, DOM-FIN-140): kimlik (T.C. kimlik no kontrol haneli, doğum günü), kişisel iletişim, eğitim geçmişi, banka (TR IBAN mod-97 ve hesap sahibi) ve acil durum kişileri; kart açma ve kısmi düzeltme şemaları (`personnelFileInputSchema`, `personnelFileUpdateSchema`), kurallar `planPersonnelFile`, `planPersonnelFileUpdate`, `assertPersonnelFileValues`.
- Alan grubu × rol okuma/yazma matrisi (`PERSONNEL_FILE_ACCESS_MATRIX`, `personnelFileAccess`, `readablePersonnelFileGroups`, `writablePersonnelFileGroups`, `assertPersonnelFileWritable`; K-475) ve rol görünümü `personnelFileView` (okunamayan grup çıkar, T.C. kimlik no ve IBAN maskeli; K-476). Muhasebe satırı rol açılınca geçerli olur.
- Özlük saklama ve imhasında `personnel_file` kategorisinin içeriği özlük kartını da sayar (K-477).
