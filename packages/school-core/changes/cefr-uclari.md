---
etki: minor
---

Dil okulunda seviye tespiti ve CEFR profili API'ye ve React web'e bağlandı (OG-054; IST-058, IST-060; DOM-DIL-010…012, DOM-BEC-034).

- API: `GET`/`POST /api/v1/placement-sessions`, `GET /placement-sessions/:sessionId`, `POST /:sessionId/score`, `/complete`, `/decide` ve `GET /api/v1/students/:studentId/cefr-profile` eklendi. Uçlar yalnız dil okulundadır (okulda 404). Tespiti yönetici ve grup kapsamındaki öğretmen yürütür; kapsam dışı öğrenci 404 döner. Satır sürümü gövdede (`version`) gider. Rubrik becerisi bölümden farklıysa 422 `placement_rubric_skill_mismatch`, taslak rubrik 409 `rubric_version_unpublished` verir.
- Profil yanıtı iki görünümlüdür: yönetici ve öğretmen `staff`, öğrenci ve veli `learner` alır. `learner` zaman çizelgesinde kararın gerekçesi ve vereni yoktur. Ön büro profili göremez (403).
- Veritabanı: `placement_sessions.section_entries` jsonb kolonu eklendi (migration 0037). Bölüm girişleri core `placementSectionEntrySchema` ile doğrulanır; puan saklanmaz.
- `@kampus/react-shared`: `cefr.ts` ve `use-cefr.ts` eklendi (`useCefrProfile`, `usePlacementSessions`, `usePlacementSession`, tespit komutları ve Türkçe hata metinleri).
- Web: dil okulunda Akademik Gelişim sayfası not kayıtları yerine CEFR profilini gösterir. Gruplar özetine yönetici ve öğretmen için "Seviye profili" sekmesi eklendi.
- Henüz yok: tespit yürütme ekranı (`TODO(cefr-tespit-ekrani)`), görev kanıtlarının öneriye yüklenmesi (`TODO(cefr-gorev-kaniti)`), dönem sınırı (`TODO(cefr-donem)`), bölüm bazında hedef seviye (`TODO(cefr-tespit-bolum-seviyesi)`) ve kur sonu kararı uçları (IST-062).
