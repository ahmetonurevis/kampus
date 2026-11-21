---
etki: patch
---

Migration 0062 (`0062_rename_parent_relationship_legal_guardian`) veli kayıtlarında (`records`, `collection = 'parents'`) eski yasal vasi yakınlığı `relationship: 'guardian'`ı `'legal_guardian'` yapar ve kaydın sürümünü artırır (ON-127, DOM-KAY-012). Arşivli kayıtlar da çevrilir; diğer yakınlıklar, `self` ve başka koleksiyonlar değişmez. İdempotenttir: yeniden çalışınca satır değişmez.
