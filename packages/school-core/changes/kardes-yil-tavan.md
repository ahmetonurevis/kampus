---
etki: patch
---

- Kardeş indirimi koşulu kalkınca uygulanan tavan istisnası (DOM-FIN-023) kardeşin yenileme yılındaki kaydına baktı (DOM-FIN-022, K-22; ON-307): `renewalCeiling` kardeş indirimi kuralıyla aynı aktif kayıt tanımını (`enrolledSiblings`, yeni `lib/enrollment-siblings.ts`) kullanır; etkin ama yenileme yılında sözleşmesi ya da planı olmayan, dondurulan veya velisi yazılmamış kardeş koşulu sürdürmez. Paket satışında kardeş sırası çocuğun ilan ücretiyle değil sözleşmesine yazılacak brütle kurulur.
