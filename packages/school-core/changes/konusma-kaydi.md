---
etki: minor
---

- Konuşma kaydı kuralları eklendi (OG-048; DOM-BEC-050, 052, 053, 054): `skills/recording.ts` `canAccessRecording` (sahibi, 18 yaş altında velisi, teslimi okuyan öğretmen ve yönetici; ön büro hiç), `recordingPeriodEnd` (ders yılı veya kur grubu sonu) ve `recordingRetentionUntil` (dönem sonu ile puanlama/itiraz kapanışından geç olanından 6 ay sonra).
- `planSubmissionVersion` sesli teslimde işlem anındaki rızayı (`recordingConsent`) ister; yoksa 403 türünde `consent_required`. Ölçülmemiş kayıt `recording_not_measured`, bir saniyeden kısa kayıt `recording_empty` ile reddedilir (önceden ölçülmemiş kayıt `recording_too_long` alıyordu).
- Konuşma süresi sınırı (`speakingSeconds`) artık isteğe bağlıdır, varsayılan 180 saniye (`SPEAKING_SECONDS`).
