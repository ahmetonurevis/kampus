---
etki: minor
---

Aday listesi ve sayımında (`GET /api/v1/collections/prospects`, `.../counts`) `dateField=trialLesson.date` ile deneme dersi tarihine göre `dateFrom`/`dateTo` gün aralığı süzülür (Europe/Istanbul günü; #13, IST-091). Alan izin listesindedir; iç içe alan yolu sabittir ve SQL ile bellekte aynı sonucu verir. `groupBy=trialLesson.date:month` aylık gruplamaya da girer.
