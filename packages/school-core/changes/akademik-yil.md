---
etki: minor
---

Eğitim yılı ve dönem modeli eklendi (OG-023; IST-011, DOM-YTK-063…067).

- Yeni `lib/academic-years.ts`: eğitim yılı başlangıç yılıyla tanımlanır (`startYear`, 2026 → 2026–2027; mevcut `academicYear` sayısıyla aynı), varsayılan aralık 1 Eylül – 31 Ağustos ve kurumca değiştirilebilir; durum `planned`/`active`/`closed`. Doğrulama ve işlemler: `planAcademicYearCreation` (409 `academic_year_exists`, 422 `academic_year_start_mismatch`, `academic_year_dates_invalid`, `academic_year_too_long`, `academic_year_overlap`), `planAcademicYearUpdate`, `planTermCreation`/`planTermUpdate`/`planTermRemoval` (dönem yılın içinde, örtüşmez, adı yılda tekil — anahtar `academicTermNameKey`, Türkçe küçük harf —, en çok 12; kapanmış yıl 409 `academic_year_closed`), `planAcademicYearActivation` (tek etkin yıl: önceki etkin yıl aynı işlemde kapanır; yıl başlangıç gününden en çok 60 gün önce etkinleşir, daha erken 422 `academic_year_activation_too_early`, `earliestActivationDate`; okulda dönemsiz yıl 422 `academic_terms_required`), `planAcademicYearClosure` (yalnız etkin yıl, son gününden itibaren).
- Sorgular: `activeAcademicYear`, `locateDay`, `currentAcademicPeriod` (Europe/Istanbul günü), `periodRange` ve `isWithinPeriod` (raporun dönem ya da yıl aralığı), `academicYearView` (öğrenci ve veli yalnız ad, tarih ve etkinlik bilgisini görür).
- Yetki tablosuna `academicYear.read` (beş rol) ve `academicYear.manage` (yönetici) eylemleri eklendi; modüle bağlı değildir.
- Örnek veri: `platform/seed-academic.ts` `createAcademicYears` okul için iki dönemli, dil okulu için dönemsiz etkin yıl üretir (sabit dönem kimlikleri `seedTermId`).
