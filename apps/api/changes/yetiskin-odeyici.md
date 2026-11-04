---
etki: minor
---

- Yetişkin kursiyere ödeyici ekleme ucu eklendi: `POST /api/v1/finance/students/:studentId/payers` (ON-124; DOM-KAY-012, DOM-ILT-074). Yönetici ve ön büro kursta 18 yaş ve üstü kursiyere mevcut veli kaydını ya da yeni kişiyi velayetsiz ödeyici bağıyla (`custody: 'none'`, `isPayer: true`) bağlar; okulda ve 18 yaş altında 422 `payer_not_applicable`, kursiyerin kendi satırı ya da iletişim kısıtlı kişi 422 `payer_not_eligible`, ikinci ödeyici 409 `guardian_payer_exists`. Modül `finance`, `Idempotency-Key` zorunlu.
- Kesin kayıt (`POST /api/v1/prospects/:prospectId/enroll`) gövdesi isteğe bağlı `payer` alır; yetişkin kursiyerin ödeyici bağı aynı işlemde yazılır; sözleşmenin tarafı ve onaylayanı ödeyicidir (`payer: 'guardian'`, öğrencinin `parentId`'si ödeyicinin kaydı; kullanıcı kararı 2026-11-04).
- Taksit vadesi, tahsilat ve iade bildirimleri yetişkin kursiyerin ayrı ödeyicisi varsa veli kitlesine de yazılır; ödeyici onları ödeyici bağlantısıyla görür. Sözleşme bildirimleri sözleşmenin tarafına gider.
- Kayıttan sonra eklenen ödeyici onaylanmamış sözleşmelerin tarafı olur; imza yetkilisi işlenmiş olanların onay isteği ödeyiciye yeniden yazılır. Onaylı sözleşme değişmez (DOM-FIN-010).
- Kardeş kaydında yetişkin kursiyerin yalnız ödeyicisi olan kişi mevcut veli olarak önerilir ve seçilir (`guardian-matches`, kesin kayıt); 18 yaş altındakinin velayetsiz ödeyicisi ve iletişim kısıtlı kişi yine 422 `parent_not_guardian` (kullanıcı kararı 2026-11-04).
