---
etki: minor
---

Zümre başkanı ve akademik koordinatör ek görevi; uyuşmazlıkta son puan (OG-006, F4b3b2b; `docs/domain/yetki-ve-kapsam.md` DOM-YTK-027, `docs/domain/beceri-gelisimi.md` DOM-BEC-024).

- Yeni `lib/coordinator-duties.ts` eklendi: `COORDINATOR_DUTY_KINDS` (`subject_head` `school`'da, `academic_coordinator` `language_school`'da), `dutyKindFor`, `coordinatorDutyInputSchema` (`membershipId`, `scopeId`), `planCoordinatorDuty` (yalnız öğretmene `duty_requires_teacher`; `school`'da öğretmenin kendi branşı `duty_outside_branch`, kadro kaydı yoksa `teacher_record_required`; dil okulunda CEFR seviyesi `invalid_cefr_level`; aynı görev `coordinator_duty_exists` 409), `coordinatorScopeOf`, `isCoordinator`, `coordinatesArea` (ders veya seviye eşleşmesi; etiketsiz alan kapsam dışı).
- `skills/rubric.ts` `scoresVisibleToRater` değiştirildi: koordinatör bir sürümün bütün puanlarını yalnız ilk ve ikinci puanın ikisi de verildikten sonra görür; ikinci puan beklenirken sıradan puanlayıcı gibi kördür (ikinci puanı kendisi verebilir; DOM-BEC-024). O sürümün ilk veya ikinci puanlayıcısıysa kör puanlama ona her zaman uygulanır (önceden koordinatör her durumda hepsini görüyordu). Yeni `coordinatorCase`: ilk ve ikinci puan bir kriterde uyuşmuyor mu (son puan verilse de `true`; koordinatörün öğrenci bazında okuma erişimi buna dayanır).
- `TODO(beceri-koordinator-bagimsiz)` kapatıldı: koordinatör o sürümün iki puanlayıcısından biri olamaz (`planRubricScore` `final`, 409 `rater_not_independent`); kural DOM-BEC-024'e yazıldı.

React ortak kancaları (`packages/react-shared`):

- `useCoordinatorDuties`, `useAssignCoordinatorDuty`, `useRemoveCoordinatorDuty` ve `useFinalScoreTaskSubmission` kancaları eklendi.
