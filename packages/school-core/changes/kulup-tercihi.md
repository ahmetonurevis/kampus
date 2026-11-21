---
etki: minor
---

- Kulüp tercihi ve kontenjanlı dağıtım kuralı eklendi (`lib/finance-club-selection.ts`, DOM-FIN-150): tercih dönemi (eğitim yılı ve dönem, açılış–kapanış günü, katılan kulüpler, en çok tercih ve atanacak kulüp sayısı, sınıf düzeyi süzgeci) ve sıralı tercih şemaları; tercih yalnız dönem açıkken girilir, kura sonrası dönem değişmez (K-505).
- `allocateClubSeats`, `lotteryOrder`, `seededRandom`: tohumlu kurayla rastgele sıralı seri diktatörlük, çok kulüpte yılan sıralı turlar; kontenjan aşılmaz, üye olunan kulüp yeniden atanmaz, yerleşemeyenler sıralı yedek listesine girer (K-506).
- `allocationDigest`, `planClubSelectionConfirm`, `waitlistView`: önizleme özeti onayda tutmazsa 409, ikinci onay yok; yer açılınca ilk bekleyen yedek önerilir, otomatik eklenmez (K-507).
