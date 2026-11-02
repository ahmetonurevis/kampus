---
etki: minor
---

Aydınlatma ve amaç bazlı açık rıza modeli (OG-015; IST-016, IST-017).

- Yeni `lib/consent-purposes.ts`: rıza amaç kodları (`photo_video_sharing`, `photo_video_website`, `photo_video_social_media`, `photo_video_print`, `promotional_messages`, `speaking_recording`), veri sahibi türü, itiraz edilebilirlik, geçerlilik ve açtığı modül; kanal `web`/`mobile`.
- Yeni `lib/privacy-notices.ts`: rol bazlı (veli, öğrenci, personel) sürümlü aydınlatma ve amaç bazlı rıza metni; `planNoticePublication`, `needsNoticeAcknowledgement` (yeni sürüm yeniden gösterilir), `planNoticeAcknowledgement` (409 `notice_outdated`, `notice_already_acknowledged`; 404 `notice_not_found`), `minimumConsentTextVersion` (DOM-YTK-056, DOM-YTK-060).
- Yeni `lib/consents.ts`: `requireConsentAuthority`/`canGiveConsent` (18 yaş altında doğrulanmış velayetli veli, 18 ve üstünde öğrencinin kendisi; yaş Europe/Istanbul gününe göre), `planConsent` (tek etkin rıza, 409 `consent_exists`, eski metin 409 `consent_text_outdated`, süresi dolan/eski sürümlü rızayı `renewed` ile kapatır; velinin rızası öğrencinin 18. yaş gününde, fotoğraf rızası eğitim yılı sonunda biter), `planConsentWithdrawal` (anında etkili, 409 `consent_already_withdrawn`), `hasValidConsent` (veri sahibi öğrenci kaydıyla sorgulanır; veli rızası ve itiraz yalnız öğrenci güncel doğum tarihine göre 18 yaş altındayken, öğrencinin kendi rızası yalnız 18 yaşını doldurmuşken etkili; en düşük geçerli metin sürümünü verilen metin listesinden hesaplar), öğrencinin fotoğraf itirazı (velinin rızasına karşıdır, 18. yaş gününde biter) (DOM-YTK-057…062).
