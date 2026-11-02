---
etki: minor
---

Veli–öğrenci bağı, velayet ve iletişim kısıtı eklendi (OG-031; IST-019, DOM-ILT-070…075).

- Yeni `lib/guardianship.ts`: bağ (`GuardianLink`) öğrenciyi veli kaydına (`parentId`) ve/veya veli hesabına (`membershipId`) bağlar; yakınlık `mother`/`father`/`legal_guardian`/`other`, velayet `full`/`joint`/`none`, `contactRestricted`, `isPayer`, `canPickUp`. İşlemler: `planGuardianLink` (hesap veli rolünde olmalı, 422 `guardian_account_not_parent`; aynı veli 409 `guardian_link_exists`), `planGuardianUpdate`, `planGuardianUnlink` (404 `guardian_link_not_found`). Kurallar: en çok bir ödeyici (409 `guardian_payer_exists`), kısıtlı veli velayetli/ödeyici/teslim alan olamaz (422 `guardian_restricted_custody`, `guardian_restricted_payer`, `guardian_restricted_pickup`), vasi velayetlidir (422 `guardian_legal_custody`), bağı olan öğrencide en az bir velayetli bağ (422 `guardian_custody_required`).
- Saf yardımcılar: `isCustodial`, `hasCustody`, `isContactRestricted`, `payerOf` (finans bildirimi alıcısı), `accessibleStudentIds` (okuma kapsamı girdisi, OG-032), `guardianBondsFor` (rıza kararı girdisi), `guardianLinksView` (yönetici ve ön büro hepsini, veli yalnız kendi bağını kısıt alanı olmadan görür; kısıtlı veli hiçbirini).
- Yetki tablosuna `guardian.read` (yönetici, ön büro, veli) ve `guardian.manage` (yönetici, ön büro) eylemleri eklendi; modüle bağlı değildir.
- Örnek veri: `platform/seed-guardians.ts` `createGuardianLinks` — örnek veli (`p1`) Deniz ve Ece'nin velayetli ödeyicisi ve teslim alma yetkilisi; Deniz'in ikinci velisi velayetsiz ve iletişim kısıtlı (sabit kimlikler `seedGuardianLinkId`).
