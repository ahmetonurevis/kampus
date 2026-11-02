---
etki: minor
---

Uygulama içi bildirim merkezi (F6a, OG-003; IST-065'in ilk parçası; `docs/domain/iletisim-ve-veli.md` DOM-ILT-020, DOM-ILT-022, DOM-ILT-023, DOM-ILT-073). API tarafı `apps/api/changes/bildirim-merkezi.md`'dedir.

- Yeni `lib/notifications.ts` eklendi: bildirim türleri kaydı `NOTIFICATION_KINDS` (`feedback_released` DOM-BEC-045, `enrollment_completed` DOM-KAY-011; konu, `service`/`commercial` ayrımı, zorunluluk, alıcı kitlesi ve başlık şablonu), `notifyStudentEvent` (yalnız ekler), `notificationAudienceOf`/`canSeeNotification` (öğrenci kendi `student`, veli bağlı çocuğunun `parent` bildirimini görür; personelin bildirimi yok), `markNotificationRead` ve `markAllNotificationsRead` (kullanıcı başına okundu işareti; görülemeyen bildirim 404 `notification_not_found`, tekrar çağrı ilk anı korur), `unreadNotificationCount`, `notificationTitle` (yalnız ilk ad), `learnerIsMinor` ve State'siz `isMinorLearner` (yetişkin kursiyerin bildirimi veliye gitmez).
- Bildirim kaydında serbest metin yoktur; `notificationRecordSchema` katı şemadır (tür, kitle, öğrenci, konu kimliği, an), başlık okumada şablondan üretilir (DOM-ILT-023).
- State'e iki koleksiyon eklendi, `notifications` ve `notificationReads` (modül `communication`; örnek veri ve çevrimdışı demo boş başlar, demo bildirim üretmez). Kapsam kuralı `lib/scope.ts`'tedir; yönetici bu koleksiyonları okumaz.
- `notification.read` ve `notification.read_all` komutları eklendi (modül `communication`, bütün roller).
- `skills/rubric.ts` `releasesFeedback` eklendi; yeni puan (ilk, ikinci ya da koordinatör son puanı) sürümün puanını kesinleştirip öğretmen geri bildirimini o anda açıyor mu (DOM-BEC-045), bildirim bu anda üretilir.

React ortak kancaları (`packages/react-shared`):

- `use-notifications.ts` eklendi (`useNotifications` imleçli, `useUnreadNotificationCount`, `useReadNotification`, `useReadAllNotifications`); `useApiQuery` isteğe bağlı `refetchInterval` alır. Okunmamış sayısının yedek tazelemesi 5 dk'dır, sekme odağa dönünce (bayatsa) ve okundu işaretinde tazelenir.
