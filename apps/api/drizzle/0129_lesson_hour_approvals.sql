CREATE TABLE "lesson_hour_approvals" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"month" text NOT NULL,
	"status" text NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"submitted_by_user_id" text NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by_user_id" text,
	"approval_count" integer DEFAULT 0 NOT NULL,
	"reopened_at" timestamp with time zone,
	"reopened_by_user_id" text,
	"reopen_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "lesson_hour_approvals_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "lesson_hour_approvals_month_check" CHECK ("lesson_hour_approvals"."month" ~ '^20[2-9][0-9]-(0[1-9]|1[0-2])$'),
	CONSTRAINT "lesson_hour_approvals_status_check" CHECK ("lesson_hour_approvals"."status" in ('draft', 'teacher_review', 'approved')),
	CONSTRAINT "lesson_hour_approvals_approval_check" CHECK ("lesson_hour_approvals"."approval_count" >= 0
        and (("lesson_hour_approvals"."approved_at" is null) = ("lesson_hour_approvals"."approved_by_user_id" is null))
        and (("lesson_hour_approvals"."approved_at" is null) = ("lesson_hour_approvals"."approval_count" = 0))
        and ("lesson_hour_approvals"."status" <> 'approved' or "lesson_hour_approvals"."approved_at" is not null)),
	CONSTRAINT "lesson_hour_approvals_reopen_check" CHECK ((("lesson_hour_approvals"."reopened_at" is null) = ("lesson_hour_approvals"."reopened_by_user_id" is null))
        and (("lesson_hour_approvals"."reopened_at" is null) = ("lesson_hour_approvals"."reopen_reason" is null))
        and ("lesson_hour_approvals"."reopen_reason" is null or char_length("lesson_hour_approvals"."reopen_reason")
          between 5 and 500))
);
--> statement-breakpoint
CREATE TABLE "lesson_hour_confirmations" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"approval_id" uuid NOT NULL,
	"membership_id" text NOT NULL,
	"sequence" bigint NOT NULL,
	"outcome" text NOT NULL,
	"channel" text NOT NULL,
	"reason" text,
	"entries_hash" text NOT NULL,
	"recorded_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "lesson_hour_confirmations_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "lesson_hour_confirmations_outcome_check" CHECK ("lesson_hour_confirmations"."outcome" in ('confirmed', 'disputed')),
	CONSTRAINT "lesson_hour_confirmations_channel_check" CHECK ("lesson_hour_confirmations"."channel" in ('in_person', 'phone', 'email', 'message', 'signed_sheet')),
	CONSTRAINT "lesson_hour_confirmations_reason_check" CHECK (("lesson_hour_confirmations"."outcome" = 'disputed') = ("lesson_hour_confirmations"."reason" is not null)
        and ("lesson_hour_confirmations"."reason" is null or char_length("lesson_hour_confirmations"."reason")
          between 5 and 500)),
	CONSTRAINT "lesson_hour_confirmations_hash_check" CHECK ("lesson_hour_confirmations"."entries_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "lesson_hour_confirmations_sequence_check" CHECK ("lesson_hour_confirmations"."sequence" >= 1)
);
--> statement-breakpoint
ALTER TABLE "lesson_hour_approvals" ADD CONSTRAINT "lesson_hour_approvals_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_hour_confirmations" ADD CONSTRAINT "lesson_hour_confirmations_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_hour_confirmations" ADD CONSTRAINT "lesson_hour_confirmations_approval_fkey" FOREIGN KEY ("institution_id","approval_id") REFERENCES "public"."lesson_hour_approvals"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_hour_confirmations" ADD CONSTRAINT "lesson_hour_confirmations_membership_fkey" FOREIGN KEY ("institution_id","membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lesson_hour_approvals_month_key" ON "lesson_hour_approvals" USING btree ("institution_id","month") WHERE "lesson_hour_approvals"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "lesson_hour_confirmations_sequence_key" ON "lesson_hour_confirmations" USING btree ("institution_id","approval_id","sequence");--> statement-breakpoint
CREATE INDEX "lesson_hour_confirmations_membership_idx" ON "lesson_hour_confirmations" USING btree ("institution_id","membership_id");--> statement-breakpoint
-- Öğretmen yanıtı değişmez (DOM-FIN-120, K-409): `kampus_reject_immutable_change()` (migration 0013).
CREATE TRIGGER "lesson_hour_confirmations_immutable_trigger" BEFORE UPDATE OR DELETE ON "lesson_hour_confirmations" FOR EACH ROW EXECUTE FUNCTION "kampus_reject_immutable_change"();
--> statement-breakpoint
CREATE TRIGGER "lesson_hour_confirmations_truncate_trigger" BEFORE TRUNCATE ON "lesson_hour_confirmations" FOR EACH STATEMENT EXECUTE FUNCTION "kampus_reject_immutable_change"();
--> statement-breakpoint
COMMENT ON TABLE "lesson_hour_approvals" IS 'Ek ders çizelgesi onayı (DOM-FIN-120, ON-196, K-409…K-411): kurumun bir takvim ayının elle girilen ek ders saatlerinin (payroll_lesson_hours) onay durumu. Kaydı olmayan ay taslaktır; ilk gönderimde satır açılır. draft taslak (saat girilir), teacher_review öğretmen kontrolünde (yanıtlar lesson_hour_confirmations), approved müdür onaylı: o ayın ek ders saati yazılamaz (409 lesson_hours_locked) ve bordroya yalnız onaylı ayın saatleri girer. Onaylı ay yönetici tarafından gerekçeyle yeniden açılır ve taslağa döner. Kurumda ay başına tek kayıt.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_hour_approvals"."institution_id" IS 'Kurum.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_hour_approvals"."id" IS 'Çizelge kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_hour_approvals"."month" IS 'Çizelge ayı (YYYY-AA, 2020-01…2099-12); payroll_lesson_hours.month_start ile aynı ay.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_hour_approvals"."status" IS 'Durum: draft taslak, teacher_review öğretmen kontrolünde, approved müdür onaylı (kilitli). İtiraz ve yeniden açma draft yapar.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_hour_approvals"."submitted_at" IS 'Son öğretmen kontrolüne gönderme anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_hour_approvals"."submitted_by_user_id" IS 'Son gönderen kullanıcı (ön büro ya da yönetici).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_hour_approvals"."approved_at" IS 'Son müdür onayı anı (UTC); yeniden açmada kayıtta kalır. Hiç onaylanmamışsa boş.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_hour_approvals"."approved_by_user_id" IS 'Son onaylayan yönetici (müdür).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_hour_approvals"."approval_count" IS 'Kaçıncı müdür onayı (yeniden açıp onaylamada artar); hiç onaylanmamışsa 0.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_hour_approvals"."reopened_at" IS 'Son yeniden açma anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_hour_approvals"."reopened_by_user_id" IS 'Son yeniden açan yönetici.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_hour_approvals"."reopen_reason" IS 'Son yeniden açma gerekçesi (5–500 karakter); denetim kaydına yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_hour_approvals"."created_at" IS 'İlk gönderimde kaydın açıldığı an (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_hour_approvals"."updated_at" IS 'Son durum değişikliği anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_hour_approvals"."archived_at" IS 'Arşiv anı; bugün çizelge arşivlenmez, ay başına tekillik etkin kayıtlar arasındadır.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_hour_approvals"."version" IS 'İyimser kilit sürümü; her durum değişikliğinde artar.';
--> statement-breakpoint
COMMENT ON TABLE "lesson_hour_confirmations" IS 'Öğretmen yanıtı (DOM-FIN-120, ON-196, K-409): öğretmen kontrolündeki çizelgede personelin ek ders saatlerini teyidi ya da gerekçeli itirazı. Öğretmen ekranı olmadığı için ön büro ya da yönetici öğretmen adına alındığı kanalla işler. Yanıt personelin o anki saat kayıtlarının özetini taşır; kayıtlar sonradan değişirse teyit geçersizleşir. İtiraz çizelgeyi taslağa döndürür. Satır değişmez (kampus_reject_immutable_change); personelin durumu son sıradaki satırdır.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_hour_confirmations"."institution_id" IS 'Kurum.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_hour_confirmations"."id" IS 'Yanıt kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_hour_confirmations"."approval_id" IS 'Yanıtın verildiği çizelge (lesson_hour_approvals.id); restrict.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_hour_confirmations"."membership_id" IS 'Yanıt veren personelin kurum üyeliği (memberships.id); restrict. Personelin bu ay saat kaydı olmalıdır.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_hour_confirmations"."sequence" IS 'Çizelge içinde yanıt sırası (1''den, kurum kilidi altında artar); personelin durumu en büyük sıralı yanıttır.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_hour_confirmations"."outcome" IS 'Sonuç: confirmed teyit, disputed itiraz (çizelge taslağa döner).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_hour_confirmations"."channel" IS 'Yanıtın alındığı kanal: in_person yüz yüze, phone telefon, email e-posta, message mesaj, signed_sheet imzalı çizelge.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_hour_confirmations"."reason" IS 'İtiraz gerekçesi (5–500 karakter); yalnız itirazda dolu, teyitte boş. Denetim kaydına yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_hour_confirmations"."entries_hash" IS 'Yanıt anında personelin bu ayki saat kayıtlarının (kimlik ve sürüm, kimliğe göre sıralı) SHA-256 özeti; güncel özetle aynı değilse teyit geçersizdir.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_hour_confirmations"."recorded_by_user_id" IS 'Yanıtı öğretmen adına işleyen kullanıcı (ön büro ya da yönetici).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_hour_confirmations"."created_at" IS 'Yanıtın işlendiği an (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_hour_confirmations"."updated_at" IS 'Satır değişmediği için created_at ile aynıdır.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_hour_confirmations"."archived_at" IS 'Kullanılmaz; satır değişmez ve silinmez.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_hour_confirmations"."version" IS 'Her zaman 1; satır değişmez.';
