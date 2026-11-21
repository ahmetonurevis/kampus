-- Aday aydınlatma kitlesi (iş isteği #14; DOM-KAY-003, DOM-YTK-056). Kısıt Drizzle şemasından
-- (core `NOTICE_AUDIENCES`) üretildi. Kitle yalnız eklenir; var olan satırların kitlesi listede
-- kaldığından kısıt tek adımda doğrulanır.
ALTER TABLE "privacy_notices" DROP CONSTRAINT "privacy_notices_audience_check";--> statement-breakpoint
ALTER TABLE "privacy_notices" ADD CONSTRAINT "privacy_notices_audience_check" CHECK ("privacy_notices"."audience" is null or "privacy_notices"."audience" in ('veli', 'ogrenci', 'personel', 'aday'));