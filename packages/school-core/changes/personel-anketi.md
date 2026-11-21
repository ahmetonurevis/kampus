---
etki: minor
---

- Anonim personel memnuniyet anketi kuralı eklendi (`lib/finance-staff-surveys.ts`, DOM-FIN-143): taslak, düzeltme, yayım, kaldırma ve yeni sürüm şemaları; sorular Likert (1–5), eNPS (0–10) ve açık uçlu; açılış ve kapanış günü Europe/Istanbul, uçlar dahil, en çok 90 gün; hedef kitle bütün personel ya da rol ve organizasyon birimi süzgeci, yayımda donar (K-484).
- `planStaffSurveyResponse`, `normalizeStaffSurveyAnswers`: personel ankete bir kez, yalnız açılış ve kapanış günleri arasında yanıt verir; cevap türü ve ölçeği denetlenir, zorunlu sorular cevaplı olmalı (K-485).
- `staffSurveyResult`, `visibleAnonymousGroups`: sonuç yalnız kapanıştan sonra ve eşik geçilince toplu döner; birim kırılımı eşik ve tamamlayıcı gizlemeyle, soru başına da aynı kuralla süzülür; dağılım, ortalama, eNPS; açık uçlu cevaplar karıştırılır (K-486).
- Çok kaynaklı geri bildirim (`lib/finance-staff-feedback.ts`): eşik alanı ve denetimi `anonymityThresholdSchema` ve `meetsAnonymityThreshold` olarak paylaşıldı; davranış değişmedi.
