---
etki: minor
---

Dil okulu kur ve grup web ekranları için menü kaydı eklendi (OG-030; IST-076, IST-077, DOM-DIL-008).

- `platform/navigation.ts`: `API_LANGUAGE_SCHOOL_PAGES` yönetici (YÖNETİM), ön büro (KAYIT & SATIŞ) ve öğretmen (AKADEMİK) menüsüne "Kurlar" ve "Gruplar" sayfalarını ekler. Sayfalar modüle değil kurum türüne bağlıdır (`institutionTypes: ['language_school']`): okul kurumunda menüde yoktur ve doğrudan adres "Sayfa bulunamadı" açar. Öğrenci ve veli menüsü değişmedi.
