---
etki: major
---

Üçüncü kurum türü `course_center` (kurs: YKS, KPSS, LGS sınav hazırlık) eklendi (OG-033, IST-001; ADR 0008).

- **Kırıcı:** `modules/collection-modules.ts` `INSTITUTION_TYPES` ve `InstitutionType` üç değerlidir. Geçiş: türe göre anahtarlanan her tablo (`Record<InstitutionType, …>`) ve `switch` `course_center` dalını alır; ikili denetimler (`=== 'language_school'`) kursu okul gibi ele alır. Deneme (`exams`), optik (`optical`), otomatik etüt (`tutoring`) ve hedef (`goals`) modülleri kursta da açılır; rehberlik (`guidance`) ve kayıt yenileme (`renewal`) yalnız okuldadır (DOM-YTK-012).
- `lib/institution-types.ts` eklendi: tür adları (`INSTITUTION_TYPE_LABELS`), terminoloji (`TERMINOLOGY`, `terminologyFor`), yeni kurumun varsayılan modülleri (`defaultModulesFor`, `defaultModuleMap`; kursta servis, yemek ve kulüp kapalı başlar, okul ve dil okulunda değişiklik yok), menü kategori adları (`categoryLabel`; kursta "SINAV HAZIRLIK", "KURS YAŞAMI") ve 18 yaş üstü velisiz kayıt kuralının adı (`adultEnrollsWithoutGuardian`).
- `lib/exam-programs.ts` eklendi: sınav programı şeması (`examProgramSchema`: sınav, oturum, puan türü, ders ve soru sayısı, en çok üç düzeyli konu ağacı), toplam soru sayısı (`programQuestionCount`), düzleştirilmiş konu listesi (`programTopics`) ve örnek programlar (`SAMPLE_EXAM_PROGRAMS`: YKS TYT, AYT Sayısal, KPSS GY-GK, LGS).
- `lib/coordinator-duties.ts`: kursta ek görev ders kapsamlı zümre başkanlığıdır (`dutyKindFor`). **Kırıcı:** `COORDINATOR_DUTY_KINDS` girdilerindeki `institutionType` alanı `institutionTypes` dizisi oldu; geçiş: türün görevi için `dutyKindFor(type)` kullanılır.
- `lib/permission-forms.ts` `permissionDecider`: doğum tarihi bilinmeyen kursiyerde adayın açık `minor: false` seçimi kursta da yetişkin sayılır (dil okuluyla aynı; DOM-YTK-030).
