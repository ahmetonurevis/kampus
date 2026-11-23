CREATE TABLE "lesson_hour_suggestions" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"month_start" date NOT NULL,
	"membership_id" text NOT NULL,
	"lesson_hours_id" uuid NOT NULL,
	"suggested_hours" integer NOT NULL,
	"previous_hours" integer,
	"hours" integer NOT NULL,
	"reason" text,
	"weekly_load" integer NOT NULL,
	"weekly_cap" integer NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "lesson_hour_suggestions_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "lesson_hour_suggestions_month_check" CHECK (extract(day from "lesson_hour_suggestions"."month_start") = 1),
	CONSTRAINT "lesson_hour_suggestions_hours_check" CHECK ("lesson_hour_suggestions"."suggested_hours" between 0 and 400
        and "lesson_hour_suggestions"."hours" between 1 and 400
        and ("lesson_hour_suggestions"."previous_hours" is null
          or "lesson_hour_suggestions"."previous_hours" between 1 and 400)
        and ("lesson_hour_suggestions"."previous_hours" is null or "lesson_hour_suggestions"."previous_hours" <> "lesson_hour_suggestions"."hours")),
	CONSTRAINT "lesson_hour_suggestions_reason_check" CHECK (("lesson_hour_suggestions"."hours" = "lesson_hour_suggestions"."suggested_hours" or "lesson_hour_suggestions"."reason" is not null)
        and ("lesson_hour_suggestions"."reason" is null or char_length("lesson_hour_suggestions"."reason")
          between 5 and 500)),
	CONSTRAINT "lesson_hour_suggestions_params_check" CHECK ("lesson_hour_suggestions"."weekly_load" between 0 and 40
        and "lesson_hour_suggestions"."weekly_cap" between 1 and 60
        and "lesson_hour_suggestions"."weekly_cap" >= "lesson_hour_suggestions"."weekly_load")
);
--> statement-breakpoint
ALTER TABLE "lesson_hour_suggestions" ADD CONSTRAINT "lesson_hour_suggestions_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_hour_suggestions" ADD CONSTRAINT "lesson_hour_suggestions_membership_fkey" FOREIGN KEY ("institution_id","membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_hour_suggestions" ADD CONSTRAINT "lesson_hour_suggestions_lesson_hours_fkey" FOREIGN KEY ("institution_id","lesson_hours_id") REFERENCES "public"."payroll_lesson_hours"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lesson_hour_suggestions_month_idx" ON "lesson_hour_suggestions" USING btree ("institution_id","month_start","membership_id");--> statement-breakpoint
CREATE INDEX "lesson_hour_suggestions_membership_idx" ON "lesson_hour_suggestions" USING btree ("institution_id","membership_id");--> statement-breakpoint
CREATE INDEX "lesson_hour_suggestions_lesson_hours_idx" ON "lesson_hour_suggestions" USING btree ("institution_id","lesson_hours_id");
--> statement-breakpoint
-- Aktarım satırı değişmez (DOM-FIN-165, K-552): `kampus_reject_immutable_change()` (migration 0013).
CREATE TRIGGER "lesson_hour_suggestions_immutable_trigger" BEFORE UPDATE OR DELETE ON "lesson_hour_suggestions" FOR EACH ROW EXECUTE FUNCTION "kampus_reject_immutable_change"();
--> statement-breakpoint
CREATE TRIGGER "lesson_hour_suggestions_truncate_trigger" BEFORE TRUNCATE ON "lesson_hour_suggestions" FOR EACH STATEMENT EXECUTE FUNCTION "kampus_reject_immutable_change"();
--> statement-breakpoint
COMMENT ON TABLE "lesson_hour_suggestions" IS 'Programdan ek ders önerisinin aktarımı (DOM-FIN-165, ON-195, K-550…K-552). Öneri saklanmaz, her okumada ders programı, okul takvimi tatilleri, izinler ve yoklamadan hesaplanır; yalnız yöneticinin öneriyi ayın elle girilen ek ders saatine (payroll_lesson_hours, lesson_type extra) aktardığı an saklanır. Öneriden farklı saat gerekçe ister. Satır değişmez (tetikleyici); aynı ay ve personel için her aktarım yeni satırdır. Müdür onaylı ya da bordro dönemi kilitli ayda aktarım yapılmaz (K-410).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_hour_suggestions"."institution_id" IS 'Kurum.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_hour_suggestions"."id" IS 'Aktarım kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_hour_suggestions"."month_start" IS 'Aktarılan ayın ilk günü; payroll_lesson_hours.month_start ile aynı ay.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_hour_suggestions"."membership_id" IS 'Öğretmenin kurum üyeliği (memberships); silinmez (restrict).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_hour_suggestions"."lesson_hours_id" IS 'Aktarımın yazdığı ya da düzelttiği ek ders saati kaydı (payroll_lesson_hours, restrict).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_hour_suggestions"."suggested_hours" IS 'Aktarım anında programdan hesaplanan ek ders saati (0–400); ekranda görülen öneriyle aynı olmak zorundadır.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_hour_suggestions"."previous_hours" IS 'Aktarımdan önce elle girilmiş saat; kayıt yoksa boş (aktarım kaydı açtı). Yazılan saatten farklıdır.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_hour_suggestions"."hours" IS 'Elle girişe yazılan saat (1–400): öneri ya da yöneticinin düzelttiği saat.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_hour_suggestions"."reason" IS 'Öneriden farklı saatin gerekçesi (5–500 karakter); saat öneriye eşitse isteğe bağlı. Denetim kaydına yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_hour_suggestions"."weekly_load" IS 'Hesapta kullanılan maaş karşılığı haftalık ders saati (0–40; varsayılan 15, K-551).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_hour_suggestions"."weekly_cap" IS 'Hesapta kullanılan, maaş karşılığı dahil haftalık ders üst sınırı (1–60, weekly_load ve üstü; varsayılan 30, K-551).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_hour_suggestions"."created_by_user_id" IS 'Aktarımı yapan yönetici.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_hour_suggestions"."created_at" IS 'Aktarım anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_hour_suggestions"."updated_at" IS 'Son değişiklik anı (UTC); satır değişmediği için aktarım anıdır.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_hour_suggestions"."archived_at" IS 'Arşiv anı; kullanılmaz (satır değişmez), kurum tablosu zorunlu kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_hour_suggestions"."version" IS 'Sürüm; satır değişmediği için 1 kalır.';
