---
etki: minor
---

- Velinin Akademik Takip sayfasına "Beceri görevleri" sekmesi eklendi (OG-992; IST-051, DOM-YTK-028, DOM-BEC-045): `/veli/akademik-takip?sekme=gorevler` seçili çocuğun okuma, dinleme, yazma ve konuşma görevlerini durum, son teslim (Europe/Istanbul), hak ve açılmış puanla listeler; `learning` modülü kapalıyken sekme görünmez. Liste mevcut `GET /api/v1/task-assignments` kursiyer görünümünün `learnerIds` ve `progress` alanlarıyla istemcide çocuğa daraltılır; API değişmedi. Sağ panel (`?gorev=`, çocuk değişince kapanır) tamamlanan denemenin ve teslimin yalnız sunucunun açtığı sonucunu gösterir; doğru cevap yalnız anahtar açıldıysa, puan ve geri bildirim yalnız kesinleşip açıldıysa görünür. Veli salt okurdur: başlatma, çözme, teslim ve itiraz düğmesi yoktur. Sonuç ekranı velide "Çocuğunuzun cevabı:" der (`AttemptResult` ve `SubmissionVersions` `audience='parent'`).
