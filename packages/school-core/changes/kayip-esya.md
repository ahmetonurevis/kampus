---
etki: minor
---

- Kayıp eşya kuralı eklendi (`lib/finance-lost-items.ts`, DOM-FIN-145): bulunan eşya (tanım, kategori, bulunduğu yer ve gün, isteğe bağlı bulan personel, saklama yeri, en çok üç fotoğraf), düzeltme, fotoğraf, teslim, toplu bağış/imha, ayar, kayıp bildirimi ve eşleme şemaları (K-490…K-492).
- `planLostItemRecord`, `planLostItemUpdate`, `planLostItemPhotoAdd`, `planLostItemHandover`: bulunma günü gelecekte ve 90 günden eski olamaz, bulan kurumun etkin personeli; teslim alan öğrenci, öğrencinin kısıtsız velisi ya da adıyla başka kişi; teslim edilen, bağışlanan ya da imha edilen eşya değişmez (K-490).
- `planLostReport`, `planLostReportMatch`, `planLostReportUnmatch`, `planLostReportClose`: veli çocuğu, öğrenci kendisi için bildirim açar; bildirim bekleyen ve eşlenmemiş eşyayla eşlenir (K-491).
- `lostItemRetentionDueOn`, `assertLostItemDisposal`, `planLostItemSettings`: eşya bulunduğu günden kurum ayarlı süre (7–365 gün, varsayılan 30) saklanır; süresi dolan, eşlenmemiş eşya gerekçeyle toplu bağışlanır ya da imha edilir (K-492).
