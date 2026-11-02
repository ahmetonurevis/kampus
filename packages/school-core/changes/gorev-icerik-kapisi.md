---
etki: patch
---

- Görev özeti içerik kapısını yansıtır (OG-985; DOM-KYN-021, 025, 051): kursiyerin görev listesi ve ayrıntısındaki `progress` satırında yazma ucunun 422 `content_unavailable` vereceği durumda `canAct: false`, yeni `blockedBy: 'content_unavailable'`; lisansı dolmuş içerikte süren işi olmayan yazma görevi de `license_expired` döner. Web liste, panel ve çalışma alanı bu durumda birincil işlemi göstermez, "Bu içerik şu an kullanıma kapalı." notunu yazar; deneme, taslak ve teslim hatalarında aynı Türkçe ileti çıkar.
- Telif askısında süren işi (süren deneme, taslak ya da teslim) olan öğrenci görevin yönergesini ve sorularını görmeye devam eder (Sabah kararı 47); yeni işi olmayan ve kaldırılmış içerikte kimse göremez. Askıdaki içeriğin dosyası görevden açılmaz.
