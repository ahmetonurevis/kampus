---
etki: minor
---

- Kazanım / öğrenme çıktısı kataloğu eklendi (`content/outcomes.ts`; DOM-KYN-011, IST-030, 031): kurum kazanımı şeması (büyük harfe çevrilen kod, ad, ders, sınıf düzeyi), yönetim yetkisi (yönetici ve kendi dersindeki zümre başkanı), kaynak sürümünün kazanım seçimi denetimi (yeni seçilen kod katalogda ve etkin olmalı; sürümde zaten bulunan arşivli kod korunur) ve müfredat örnek verisinden türetilen örnek platform kataloğu (`samplePlatformOutcomes`, program sürümü `ornek-2025`; resmî MEB kodları değildir).
- API kazanım kataloğu uçları (`GET/POST /api/v1/learning-outcomes`, `POST …/:code/archive`; migration 0049): içerik oluşturma ve taslak düzenleme yeni seçilen kodu katalogla denetler, katalogda olmayan ya da arşivli kod 422 (`outcome_not_found`, `outcome_archived`). Liste `codes` ile mevcut içeriğin kodlarını arşivliler dahil çözer.
- React web içerik ve soru formunda kazanım artık serbest kodla yazılmaz: `Kazanım ekle` arama, ders ve sınıf düzeyi süzgeçli `Kazanım seç` penceresini açar; arşivlenmiş kod mevcut içerikte "Arşivli" etiketiyle görünür, seçicide çıkmaz.
