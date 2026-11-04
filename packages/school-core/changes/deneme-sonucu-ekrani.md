---
etki: minor
---

- Öğretmenin deneme dersi sonucu ekranı eklendi (ON-279; IST-079, DOM-DIL-031, DOM-YTK-080): React web'de öğretmen kendi gruplarının derslerine katılan deneme adaylarını sunucu sayfalı listede (arama, aşama ve deneme dersi günü süzgeci) görür ve sağ panelde seviye uygunluğunu (`Uygun`, `Alt kur önerilir`, `Üst kur önerilir`) ve en fazla 500 karakterlik notu yazar ya da düzeltir. Ders başlamadan, iptal edilmiş derste ve kapalı adayda form kilitlidir; karar yine sunucudadır. react-shared `useRecordTrialResult` ve `recordTrialResultRequest` eklendi.
- Öğretmen menüsüne "Deneme Dersleri" sayfası eklendi (`modules/full-navigation.ts` `TRIAL_RESULTS_PAGE`, yol `deneme-sonuclari`): AKADEMİK kategorisinde dil okulu sayfalarından önce, modül `crm` (kapalıysa gizlenir), yalnız dil okulunda; okulda, öteki rollerde ve Vue demosunda yoktur.
