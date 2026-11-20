---
etki: minor
---

- İş ilanı ve başvuru havuzu kuralı eklendi (`lib/finance-job-postings.ts`, DOM-FIN-128): ilan (başlık, pozisyon/branş, çalışma türü, açıklama, nitelikler, yayın ve son başvuru günü), başvuru (ilan, aday, iletişim, kanal, özgeçmiş, aydınlatma sürümü ve günü, not), aşamalar ve saklama ayarı şemaları.
- `planJobPostingUpdate`, `planJobPostingStatus`: taslak → yayında → kapandı; kapanan ilan değişmez ve yeniden açılmaz, yayındaki ilanın yayın günü kilitlidir (K-439). `assertJobApplication`, `planJobApplicationUpdate`, `planJobApplicationStage`: taslak ilana başvuru yok, gün aralığı, mükerrer e-posta/telefon, ileri aşama ya da ret, son aşamalar kilitli (K-440).
- `retentionStartOn`, `retentionDueOn`, `assertJobApplicationAnonymization`, `planJobApplicationSettings`: reddedilen başvuru ret gününden, kapanan ilandaki işe alınmamış başvuru kapanış gününden kurum ayarlı süre (1–60 ay, varsayılan 12) saklanır; süresi dolan ya da adayın talebiyle anonimleştirilir, işe alınan aday hariç (K-441).
