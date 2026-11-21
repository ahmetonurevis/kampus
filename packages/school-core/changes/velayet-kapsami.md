---
etki: minor
---

Velayet ve iletişim kısıtı okuma kapsamına uygulandı (OG-032; IST-019, DOM-ILT-070, DOM-ILT-074).

- Yeni `lib/guardianship.ts` `guardedActorLinks`: velinin çocuk bağlantısı (`child`) yalnız aynı öğrencide velayetli ve kısıtsız bağı varsa kapsam verir; öğrenci ve öğretmen bağlantıları değişmez.
- API aktör bağlantılarını bununla kurar (`listMembershipLinks`): iletişim kısıtlı ya da velayeti olmayan veli öğrenciyi `/me` çocuk listesinde, not, yoklama, fatura ve tahsilat gibi koleksiyonlarda, görev ve teslimde, panoda, yazışmada, bildirimde, randevuda ve öğrenciye bağlı dosyada görmez; kısıt kalkınca yeniden görür. Bağı kaldırılmış ya da hiç kurulmamış çocuk bağlantısı da kapsam vermez.
- Öğretmenin veli hesapları listesi (`GET /students/:id/parent-accounts`) yalnız velayetli ve kısıtsız velileri döndürür; kısıtlı veliyle yazışma başlatılamaz (422 `parent_account_not_found`). Kısıtlı veli kendi yazışmasını görmez, yanıt yazamaz (404).
- Rıza kararı değişmedi: velayetsiz ya da kısıtlı veli yeni rıza veremez (403 `consent_custody_required`), kendi verdiği rızayı geri çekebilir (200).
- Bilinen sınır: kısıt döneminde üretilen not, yoklama ve bildirim kısıt kalkınca görünür; velayeti olmayan ödeyici veli finans verisini görmez (DOM-ILT-074 açık sorular).
- `lib/school-workflows.ts` iş akışlarında kurum kapsamı olmayan rol (öğretmen, veli, öğrenci) için öğrenci kapsamı kayıt durumundan önce denetlenir: kapsam dışı öğrenci etkin, pasif ya da olmayan olsun aynı 403 `student_scope_denied` alır (`POST /workflows/consent?childId=` dahil); kısıtlı veli çocuğun pasif olduğunu 422 `record_inactive` farkından öğrenemez. Yönetici ve ön büroda olmayan öğrenci 404 kalır.
- `lib/communication-access.ts` `sendDecision` yeni isteğe bağlı `parentUserIds` (öğrencinin velayetli ve kısıtsız veli hesapları) alır; `sendMessage` bunu `options.parentUserIds`'ten geçirir. Öğretmen erişimi kalkan veliyle açık yazışmaya yeni mesaj gönderemez: 403 `conversation_parent_restricted` (DOM-ILT-074); API listeyi yazışmanın öğrencisinin bağlarından verir, kısıt kalkınca gönderim yeniden açılır. Liste verilmeyen çağıranda (demo) davranış değişmez.
- `GET /consents` (veli): velinin kendi verdiği, geri çekilmemiş öğrenci rızaları kapsamdan bağımsız döner (KVKK m.11): `studentId` olmadan hesap rızalarının ardından erişimi kalkan öğrencilerin satırları, kapsam dışı öğrenci için `studentId` ile yalnız bunlar; `canWithdraw` doğru, öğrenci adı ve başka velinin satırı dönmez, açık satır yoksa 404. Web Ayarlar "Rızalarım" bunları "Erişiminiz kalkan öğrenciler" altında geri çekmek için gösterir.
