---
etki: minor
---

- Personel avansı ve ücret kesintileri kuralı eklendi (`lib/finance-staff-deductions.ts`, DOM-FIN-101): avans (tutar, veriliş günü ve yöntemi, 1–24 taksit, ilk mahsup ayı; taksit planı eşit kuruş, yuvarlama farkı son taksitte; erken kapama ve gerekçeli iptal), icra kesintisi (daire, dosya, alacak, onbinde oran varsayılan 2500, nafaka önceliği, tebliğ sırası, kalan alacak ve kapanış) ve BES otomatik katılım (oran varsayılan ve en az %3, ara verme en çok 12 ay, iki aylık cayma) şemaları ve kuralları.
- `monthlyDeductions` saf fonksiyonu ay ve isteğe bağlı net ücret ile BES matrahından o ayın kesinti listesini sıralı ve tavanlı hesaplar: avans taksiti, nafaka, sıradaki icra (ötekiler bekler), BES; oranlı tutarlar kuruşa aşağı yuvarlanır, net yoksa yalnız sabit tutarlar.
