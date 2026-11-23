---
etki: minor
---

Koleksiyon listesine `level` (düzey) süzgeci eklendi (OG-069, IST-035).

- `GET /collections/:collection` ve `/counts` uçlarında `level` sorgu parametresi; çoklu değer parametre tekrarıyla. Değer CEFR seviyesi (`Pre-A1`…`C2`) ya da `N. Sınıf` (5–12) olmalıdır, başka değer 400.
- Süzgeç SQL'de uygulanır, sayfalama ve `meta.total` süzgeçten sonradır; kurum ve rol kapsamı değişmez (öğrenci ve veli yalnız kendi düzeyindeki materyali görür).
