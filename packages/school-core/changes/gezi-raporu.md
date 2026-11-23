---
etki: minor
---

- Gezi sonrası rapor kuralı eklendi (`lib/finance-trip-reports.ts`, DOM-FIN-158, ON-158). Gezi bitince (plan onaylı ya da tamamlanmış ve dönüş anı geçmiş) planın görevlisi öğretmen ya da yönetici gerçekleşme özeti, olaylar (kaza tutanağı bağı) ve kazanım metnini yazar; taslak → gönderildi → yönetici onayı ya da gerekçeli iade; onaylanan rapor değişmez (`tripReportAccess`, `planTripReportCreate`, `planTripReportUpdate`, `assertTripReportSubmit`, `assertTripReportDecision`, `assertTripReportIncidents`; K-529).
- Katılan ve katılmayan sayısı gezi günü yoklamasının kapanan turlarından hesaplanır (`tripAttendance`, `tripAttendedStudents`; K-529).
- Rapor fotoğrafında görünen öğrenciler etiketlenir ya da "öğrenci görünmüyor" işaretlenir; aileye yayım etiketli herkesin geçerli `photo_video_sharing` rızasını ister ve okuma anında hesaplanır (`tripReportPhotoSchema`, `planTripReportPhoto`, `tripReportPhotoVisibility`; K-530, IST-017).
- Katılan öğrenci ve velisi gezi başına bir kez 1–5 puan ve isteğe bağlı yorum verir, dönüşten 30 gün içinde; özet 5'ten az yanıtta gizlidir, yorumlar ad taşımaz (`tripEvaluationSchema`, `planTripEvaluation`, `tripEvaluationSummary`; K-531).
