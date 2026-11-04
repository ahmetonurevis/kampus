---
etki: minor
---

- Aday yaş grubu kuralı okul dışındaki her kurum türüne genişletildi (ON-292, #23; DOM-KAY-009, ADR 0008 karar 5): `prospectAgeGroupRequired(type)` dil okulu ve kursta (`course_center`) `minor` seçimini zorunlu kılar, okulda sormaz. Yetişkin adayda veli adı gönderilse de saklanmaz. Web aday formu yaş grubu alanını aynı kuralla gösterir.
- Kesin kayıtta kurs türü dil okuluyla aynı veli kuralını alır (DOM-KAY-012): 18 yaş ve üstünde yalnız "Kursiyerin kendisi" (`allowedGuardianModes`), veli verilirse 422 `guardian_not_applicable`, yaş grubu doğum tarihiyle uyuşmazsa 422 `birth_date_minor_mismatch`. Sözleşme başlığı `enrollmentContractTitle(type)` ile türden gelir; kursta "Özel öğretim kursu eğitim sözleşmesi", okul ve dil okulunda başlık değişmedi. Kurs ücreti okul gibi düz öğrenim ücretidir (ders saati yalnız dil okulunda).
- Web sözleşme PDF'i `institutionType` seçeneğiyle okul dışındaki türlerde kayıtlı kişiyi "kursiyer" diye yazar (ADR 0008 karar 1); ödeyici kursiyerse "Ödeyici" satırı "Kursiyer" olur. Kayıt yenilemenin kursta bulunmadığı (DOM-YTK-012) API ve menü testleriyle gösterildi.
