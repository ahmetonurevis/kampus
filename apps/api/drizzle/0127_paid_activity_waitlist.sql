ALTER TABLE "paid_activity_participants" DROP CONSTRAINT "paid_activity_participants_status_check";--> statement-breakpoint
ALTER TABLE "paid_activity_participants" DROP CONSTRAINT "paid_activity_participants_cancel_kind_check";--> statement-breakpoint
DROP INDEX "paid_activity_participants_student_key";--> statement-breakpoint
ALTER TABLE "paid_activity_participants" ALTER COLUMN "invoice_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "paid_activities" ADD COLUMN "requires_consent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "paid_activities" ADD COLUMN "permission_form_id" text;--> statement-breakpoint
ALTER TABLE "paid_activity_participants" ADD COLUMN "waitlist_position" integer;--> statement-breakpoint
ALTER TABLE "paid_activity_participants" ADD COLUMN "promoted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "paid_activity_participants" ADD COLUMN "consent_status" text DEFAULT 'not_required' NOT NULL;--> statement-breakpoint
ALTER TABLE "paid_activity_participants" ADD COLUMN "consent_channel" text;--> statement-breakpoint
ALTER TABLE "paid_activity_participants" ADD COLUMN "consent_grantor_name" text;--> statement-breakpoint
ALTER TABLE "paid_activity_participants" ADD COLUMN "consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "paid_activity_participants" ADD COLUMN "consent_recorded_by_user_id" text;--> statement-breakpoint
ALTER TABLE "paid_activity_participants" ADD COLUMN "consent_withdrawn_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "paid_activity_participants" ADD COLUMN "consent_withdrawal_channel" text;--> statement-breakpoint
CREATE UNIQUE INDEX "paid_activity_participants_waitlist_key" ON "paid_activity_participants" USING btree ("institution_id","activity_id","waitlist_position") WHERE "paid_activity_participants"."waitlist_position" is not null and "paid_activity_participants"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "paid_activity_participants_student_key" ON "paid_activity_participants" USING btree ("institution_id","activity_id","student_id") WHERE "paid_activity_participants"."status" <> 'cancelled' and "paid_activity_participants"."archived_at" is null;--> statement-breakpoint
ALTER TABLE "paid_activities" ADD CONSTRAINT "paid_activities_permission_form_check" CHECK ("paid_activities"."permission_form_id" is null or "paid_activities"."requires_consent");--> statement-breakpoint
ALTER TABLE "paid_activity_participants" ADD CONSTRAINT "paid_activity_participants_invoice_check" CHECK (("paid_activity_participants"."status" <> 'active' or "paid_activity_participants"."invoice_id" is not null)
        and ("paid_activity_participants"."status" not in ('waitlisted', 'awaiting_consent') or "paid_activity_participants"."invoice_id" is null));--> statement-breakpoint
ALTER TABLE "paid_activity_participants" ADD CONSTRAINT "paid_activity_participants_waitlist_check" CHECK (("paid_activity_participants"."status" <> 'waitlisted' or "paid_activity_participants"."waitlist_position" is not null)
        and ("paid_activity_participants"."waitlist_position" is null or "paid_activity_participants"."waitlist_position" > 0));--> statement-breakpoint
ALTER TABLE "paid_activity_participants" ADD CONSTRAINT "paid_activity_participants_consent_status_check" CHECK ("paid_activity_participants"."consent_status" in ('not_required', 'pending', 'granted', 'withdrawn'));--> statement-breakpoint
ALTER TABLE "paid_activity_participants" ADD CONSTRAINT "paid_activity_participants_consent_channel_check" CHECK ("paid_activity_participants"."consent_channel" in ('permission_form', 'paper', 'phone', 'in_person') and "paid_activity_participants"."consent_withdrawal_channel" in ('permission_form', 'paper', 'phone', 'in_person'));--> statement-breakpoint
ALTER TABLE "paid_activity_participants" ADD CONSTRAINT "paid_activity_participants_consent_check" CHECK (("paid_activity_participants"."consent_channel" is null) = ("paid_activity_participants"."consent_at" is null)
        and ("paid_activity_participants"."consent_at" is null) = ("paid_activity_participants"."consent_recorded_by_user_id" is null)
        and ("paid_activity_participants"."consent_status" <> 'granted' or "paid_activity_participants"."consent_at" is not null)
        and ("paid_activity_participants"."consent_status" = 'withdrawn') = ("paid_activity_participants"."consent_withdrawn_at" is not null)
        and ("paid_activity_participants"."consent_withdrawn_at" is null) = ("paid_activity_participants"."consent_withdrawal_channel" is null)
        and ("paid_activity_participants"."status" <> 'awaiting_consent' or "paid_activity_participants"."consent_status" = 'pending')
        and ("paid_activity_participants"."consent_status" <> 'withdrawn' or "paid_activity_participants"."status" = 'cancelled'));--> statement-breakpoint
ALTER TABLE "paid_activity_participants" ADD CONSTRAINT "paid_activity_participants_status_check" CHECK ("paid_activity_participants"."status" in ('active', 'awaiting_consent', 'waitlisted', 'cancelled'));--> statement-breakpoint
ALTER TABLE "paid_activity_participants" ADD CONSTRAINT "paid_activity_participants_cancel_kind_check" CHECK ("paid_activity_participants"."cancel_kind" in ('participant', 'activity', 'consent'));--> statement-breakpoint
COMMENT ON COLUMN "paid_activities"."requires_consent" IS 'Katılım veli izni ister mi (DOM-FIN-112, K-370): izinsiz asil izin bekliyor olur, yerini tutar, taksiti izinle açılır. Kurulurken seçilir, sonradan değişmez.';--> statement-breakpoint
COMMENT ON COLUMN "paid_activities"."permission_form_id" IS 'İznin okunacağı dijital izin formu (records permissionForms kimliği, IST-067); yabancı anahtar değildir. Yalnız veli izni isteyen etkinlikte dolar; formdaki onay ve ret eşitlemeyle katılıma yansır (K-370).';--> statement-breakpoint
COMMENT ON CONSTRAINT "paid_activities_permission_form_check" ON "paid_activities" IS 'İzin formu yalnız veli izni isteyen etkinliğe bağlanır (K-370).';--> statement-breakpoint
COMMENT ON COLUMN "paid_activity_participants"."invoice_id" IS 'Katılımın açtığı sözleşmesiz taksit (invoices.id, fee_kind activity). Yedek ve izin bekleyen katılımda boştur; yedekten asile geçişte ya da izin gelince açılır (K-369, K-370).';--> statement-breakpoint
COMMENT ON COLUMN "paid_activity_participants"."status" IS 'Durum: active (asil, taksiti açık), awaiting_consent (asil, yer tutar, veli izni bekleniyor, taksit yok), waitlisted (yedek, yer ve taksit yok) ya da cancelled. Kontenjanı active ve awaiting_consent doldurur (DOM-FIN-112).';--> statement-breakpoint
COMMENT ON COLUMN "paid_activity_participants"."cancel_kind" IS 'İptal türü: participant (katılımcı iptali, iade kuralı uygulanır), activity (kurum etkinliği iptal etti, tam iade) ya da consent (veli izni geri çekildi ya da formda reddedildi; katılımcı iptali gibi K-302 kuralı, K-370).';--> statement-breakpoint
COMMENT ON COLUMN "paid_activity_participants"."waitlist_position" IS 'Yedek sıra numarası (K-369): kontenjan doluyken yazılan katılıma etkinlikte artan numara verilir, yeniden kullanılmaz; yer açılınca en küçük numaralı yedek asile geçer. Asile geçince numara kalır (iz).';--> statement-breakpoint
COMMENT ON COLUMN "paid_activity_participants"."promoted_at" IS 'Yedekten asile geçiş anı (UTC); hiç yedek olmamış ya da geçmemiş katılımda boş.';--> statement-breakpoint
COMMENT ON COLUMN "paid_activity_participants"."consent_status" IS 'Veli izni (K-370): not_required (etkinlik istemiyor), pending (bekleniyor), granted (alındı) ya da withdrawn (geri çekildi ya da reddedildi; katılım iptal).';--> statement-breakpoint
COMMENT ON COLUMN "paid_activity_participants"."consent_channel" IS 'İznin geldiği kanal: permission_form (dijital izin formu, IST-067), paper (kâğıt dilekçe), phone (telefon) ya da in_person (yüz yüze).';--> statement-breakpoint
COMMENT ON COLUMN "paid_activity_participants"."consent_grantor_name" IS 'Kişisel veri (K): personelin girdiği izinde izni veren velinin ya da yetişkin öğrencinin adı; dijital formda boş (karar satırı formdadır). Loglanmaz, CSV ve PDF listesine yazılmaz.';--> statement-breakpoint
COMMENT ON COLUMN "paid_activity_participants"."consent_at" IS 'İznin kaydedildiği an (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "paid_activity_participants"."consent_recorded_by_user_id" IS 'Kişisel veri (K): izni kaydeden ya da formdan eşitleyen personelin kullanıcı kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "paid_activity_participants"."consent_withdrawn_at" IS 'İznin geri çekildiği ya da reddedildiği an (UTC); katılım aynı işlemde iptal edilir.';--> statement-breakpoint
COMMENT ON COLUMN "paid_activity_participants"."consent_withdrawal_channel" IS 'Geri çekmenin geldiği kanal (consent_channel değerleri); formdaki ret permission_form.';--> statement-breakpoint
COMMENT ON CONSTRAINT "paid_activity_participants_invoice_check" ON "paid_activity_participants" IS 'Asil katılımın taksiti vardır; yedek ve izin bekleyen katılımın taksiti yoktur (K-369, K-370).';--> statement-breakpoint
COMMENT ON CONSTRAINT "paid_activity_participants_waitlist_check" ON "paid_activity_participants" IS 'Yedek katılım pozitif sıra numarası taşır (K-369).';--> statement-breakpoint
COMMENT ON CONSTRAINT "paid_activity_participants_consent_check" ON "paid_activity_participants" IS 'İzin alanları birlikte dolar; izin bekleyen asil pending, geri çekilen izin iptal edilmiş katılımda olur (K-370).';--> statement-breakpoint
COMMENT ON INDEX "paid_activity_participants_waitlist_key" IS 'Yedek sıra numarası etkinlikte tekildir (K-369).';--> statement-breakpoint
COMMENT ON INDEX "paid_activity_participants_student_key" IS 'Öğrencinin bir etkinlikte tek iptal edilmemiş (asil, izin bekleyen ya da yedek) katılımı olur (K-301, K-369).';
