---
etki: minor
---

Performans raporuna çok kaynaklı geri bildirim bölümü eklendi ve kesinleşen raporun gelişim hedefleri sabitlendi (DOM-FIN-137, DOM-FIN-133; ON-350, K-468): `PERFORMANCE_REPORT_SECTIONS` gözlemlerden sonra `staffFeedback` bölümünü taşır. `performanceReportFeedbackSection` toplu sonuçtan (`multiSourceFeedbackResult`, K-459) bölümü türetir: yönetici yanıtları adıyla, meslektaş sonucu yalnız eşik üstünde toplu; durum `not_collected`, `period_open`, `below_threshold` ("yeterli yanıt yok") ya da `visible` (`PERFORMANCE_REPORT_FEEDBACK_STATES`), tek meslektaş yanıtı hiç dönmez. `performanceReportGoalSnapshotSchema` kesinleştirmede yazılan hedef özetini doğrular, `performanceReportGoalSection` bölümü sıralar ve sayar.
