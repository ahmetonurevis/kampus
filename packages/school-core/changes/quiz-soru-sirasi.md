---
etki: minor
---

- Quiz soru sırasını karıştırmak için `shuffleItemOrder(items, shuffle, random)` eklendi (OG-249; `docs/domain/beceri-gelisimi.md` DOM-BEC-010). Maddeler `questionVersionId`'ye göre dizilip tohumlu karıştırılır, yazarın sırası sonuca sızmaz; `shuffle` kapalıysa sıra korunur ve rastgelelik çağrılmaz. API, `shuffleItems` açık quiz'de sırayı `seededRandom(denemeKimliği:items)` ile kurar: aynı denemede sıra sabit, denemeler arasında değişebilir. Puan ve cevap eşleme madde kimliğiyle kalır.
