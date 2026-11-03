---
etki: patch
---

- Mobil öğretmen, Sınıflarım ekranındaki Not girişi sekmesinden API üzerinden not girer ve düzeltir (OG-062, IST-124; DOM-AKD-003, -004, -051, -054). Sınıf ve ders yalnız ders atamalarından seçilir; kayıtsız öğrenciye yeni not, kayıtlıda gerekçeli düzeltme gider, dokunulmayan öğrenciye istek atılmaz. Core değişmedi; puan sınırları ve gerekçe kuralı mevcut `gradeUpdateSchema`'dan okunur.
