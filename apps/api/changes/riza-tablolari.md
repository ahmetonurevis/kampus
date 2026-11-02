---
etki: minor
---

Aydınlatma ve açık rıza tabloları (OG-015; IST-016, IST-017; DOM-YTK-056…062).

- Yeni tablolar `privacy_notices` (sürümlü aydınlatma ve rıza metni; konu başına tekil sürüm `privacy_notices_audience_version_key`, `privacy_notices_purpose_version_key`), `notice_acknowledgements` (kullanıcı × sürüm tekil, değişmez satır) ve `consents` (veri sahibi, veren, ilişki, amaç, karar, metin sürümü, kanal, `given_at`, `expires_at`, geri çekme). Migration `0024_create_privacy_consents`.
- Aynı veri sahibi + amaç + karar için tek etkin rıza kısmi benzersiz indeksle korunur (`consents_subject_purpose_decision_key`, `withdrawn_at is null and archived_at is null`).
- Değişmezlik tetikleyicileri: yayımlanmış metnin içeriği değişmez (`kampus_reject_privacy_notice_change`), gösterim satırı değişmez (`kampus_reject_immutable_change`), rıza satırında tek değişiklik bir kez geri çekmedir (`kampus_reject_consent_change`); silme yalnız imha ayarıyla. Gösterilmiş ya da rıza verilmiş metin sürümü silinemez (`on delete restrict`).
- Kurum kapsamlı depo yardımcıları `src/db/privacy.ts` (listeleme, ekleme, sürümlü geri çekme). Uç yok; OpenAPI değişmedi.
