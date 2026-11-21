---
etki: minor
---

Etkinlik değişikliği izni düşürür, iptal edilebilir (OG-254; DOM-ILT-032).

- İzin formuna isteğe bağlı etkinlik ayrıntısı eklendi: `eventDate` (`YYYY-MM-DD`), `eventTime` (`SS:DD`), `location`, `transport`, `fee` (tamsayı kuruş). Açılışta ve düzenlemede verilir; düzenlemede `null` ayrıntıyı kaldırır. Etkinlik günü geçmişte olamaz (422 `permission_form_event_in_past`).
- Saf karar `permissionDroppingChanges(current, patch)`: gün, saat, yer, ulaşım ve ücretten değişenleri döner; başlık, açıklama ve son gün düzeltmesi, aynı değerin yeniden yazılması izni düşürmez. Ayrıntının eklenmesi ve kaldırılması değişikliktir.
- Düşme saklanan bayrak değil sürüm farkıdır: form `detailsRevision`, karar satırı `formRevision` taşır; sürümü formunkinden eski karar satır olarak kalır (ispat, DOM-ILT-034) ama durumu etkilemez (`isCurrentDecision`, `currentDecisions`). `decidePermission` yeni satıra güncel sürümü yazar; düşmüş karar "aynı karar" sayılmaz. `updatePermissionForm` sonucuna `droppedFields` ve `previousRevision` eklendi; `permissionReminders` düşen kararı bekleyen sayar.
- Yeni `cancelPermissionForm` (yetki `permissionForm.cancel`, yönetici ve formun öğretmeni): formu kapatır, `cancelledAt` işaretler, kararlar korunur; ikinci iptal 409 `permission_form_cancelled`.
- Alıcı kuralları: `permissionReaskStudents` (kararı düşen: onay ya da ret), `permissionCancelStudents` (izin vermiş ve bekleyen; ret verene gitmez). Durumlar yalnız bugün velayetli veliler üzerinden hesaplanır (DOM-ILT-037).
- Yeni bildirim türleri `permission_form_reconsent` ve `permission_form_cancelled` (konu `consent`, zorunlu, 18 yaş altında veli, yetişkinde kendisi; yalnız form kimliği).
- Son günü geçmiş açık formda izni düşüren değişiklik 422 `permission_form_deadline_passed` ile reddedilir (izin düşüp yeniden alınamazdı, DOM-ILT-038); açıklama gibi düşürmeyen düzeltmeler serbesttir.
- Etkinlik günü olan formda son gün etkinlik gününden sonra olamaz (422 `permission_form_deadline_after_event`, DOM-ILT-044); form açılırken ve düzenlenirken uygulanır, eski kayıt okunur.
