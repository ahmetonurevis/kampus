---
etki: minor
---

- Veli menüsüne Materyaller sayfası eklendi (OG-982; DOM-KYN-041): `API_LEARNING_PAGES.veli` içinde `materyaller` (`learning` modülü, AKADEMİK kategorisi, `apiOnly`; Vue demosunda ve mobilde yok). Öğrenme sayfaları artık kendi kategorilerinin (`group`) sonuna yerleşir; personelin İçerik Havuzu yeri değişmedi.
- `GET /api/v1/resources` isteğe bağlı `studentId` süzgeci aldı: velide görünüm seçili çocuğa (velayetli ve kısıtsız bağ) daralır, bağlı olmayan, kısıtlı ya da başka kurumun öğrencisi 404; öğrencide yalnız kendi kaydı; personelde 400 `learner_only_filter`. Seçimsiz liste değişmedi.
