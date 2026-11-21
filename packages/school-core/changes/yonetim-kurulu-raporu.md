---
etki: minor
---

- Yönetim kurulu raporu kuralı eklendi (`lib/finance-board-report.ts`, DOM-FIN-064): seçilen eğitim yılı, dönem ya da tarih aralığı için mutabakat toplamları, ödeme yöntemine göre tahsilat, gecikmiş alacak yaşlandırması, dil okulunda paket gelir toplamı, dönem başı ve sonu öğrenci sayısı, yeni kayıt, ayrılış nedenleri, yenileme oranı ve aday hunisi kişi adı olmadan hesaplanır; 5 kişiden küçük kırılım hücreleri gizlenir (`suppressSmallGroups`).
- Taksitin ödenmiş kısmı tek yardımcıya alındı (`invoicePaidCents`, `lib/finance-export.ts`); kartlar, özet ve bakiye davranışı değişmedi.
