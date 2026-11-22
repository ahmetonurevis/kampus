---
etki: minor
---

- Okul etkinlik takvimi kuralı eklendi (`lib/finance-school-calendar.ts`, DOM-FIN-163): tür (tören, veli toplantısı, sınav haftası, tatil, gezi, gösteri, diğer), tüm gün ya da İstanbul saatli başlangıç–bitiş, yer, açıklama ve hedef kitle (tüm kurum, kademe, sınıf, dil okulu grubu) şemaları (`schoolEventCreateSchema`, `schoolEventUpdateSchema`, `schoolEventCancelSchema`); tatil ve sınav haftası tüm gündür, etkinlik en çok 120 gün sürer (`schoolEventIssues`, `normalizeSchoolEvent`; K-544).
- `planSchoolEventCreate`, `planSchoolEventUpdate`, `assertSchoolEventPublishable`, `assertSchoolEventCancellable`: taslak → yayımlandı; iptal gerekçeli, silme yok; iptal edilmiş etkinlik değişmez, bitmiş etkinlik iptal edilmez (K-544).
- Görünürlük `schoolEventVisibleTo` (taslak görünmez, yayımdan sonra iptal edilen görünür), kurum tatili `institutionHolidays` (yayımlanmış, tüm kurum hedefli tatil; izin takviminin tatil kaynağı, K-545), anlar `schoolEventInstants` ve iCal dosyası `schoolCalendarIcs` (RFC 5545; kaçış ve 75 sekizli katlama).
- Gezi planı ve biletli etkinlik bağlantı türleri (`SCHOOL_CALENDAR_LINK_SOURCES`; K-546).
