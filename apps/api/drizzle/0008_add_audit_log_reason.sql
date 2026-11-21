ALTER TABLE "audit_log" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_reason_check" CHECK ("audit_log"."reason" is null or char_length("audit_log"."reason") <= 500);--> statement-breakpoint
-- Gerekçe metni `changes` jsonb'sinde değil kendi kolonundadır (veritabani.md §8: `changes` yalnız
-- alan adı tutar). Önceden yazılmış yazışma erişim kayıtları taşınır; bu tek seferlik bir düzeltmedir,
-- uygulama rolü yine yalnız ekler. İdempotent: yalnız `changes` içinde gerekçe olan satırlara dokunur.
UPDATE "audit_log"
   SET "reason" = left("changes" ->> 'reason', 500),
       "changes" = nullif("changes" - 'reason', '{}'::jsonb)
 WHERE "action" = 'conversation.access'
   AND "changes" ->> 'reason' IS NOT NULL;
