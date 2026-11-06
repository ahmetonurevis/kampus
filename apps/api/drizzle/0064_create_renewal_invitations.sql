CREATE TABLE "renewal_invitations" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"student_id" text NOT NULL,
	"academic_year" integer NOT NULL,
	"invited_by_user_id" text NOT NULL,
	"response" text,
	"response_note" text,
	"responded_by_user_id" text,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "renewal_invitations_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "renewal_invitations_response_check" CHECK ("renewal_invitations"."response" is null or "renewal_invitations"."response" in ('will_renew', 'will_not_renew')),
	CONSTRAINT "renewal_invitations_answer_check" CHECK (("renewal_invitations"."response" is null) = ("renewal_invitations"."responded_at" is null) and ("renewal_invitations"."response" is null) = ("renewal_invitations"."responded_by_user_id" is null) and ("renewal_invitations"."response_note" is null or "renewal_invitations"."response" is not null)),
	CONSTRAINT "renewal_invitations_note_check" CHECK ("renewal_invitations"."response_note" is null or char_length("renewal_invitations"."response_note") <= 280)
);
--> statement-breakpoint
ALTER TABLE "renewal_invitations" ADD CONSTRAINT "renewal_invitations_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "renewal_invitations_student_year_key" ON "renewal_invitations" USING btree ("institution_id","student_id","academic_year") WHERE "renewal_invitations"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "renewal_invitations_year_idx" ON "renewal_invitations" USING btree ("institution_id","academic_year");--> statement-breakpoint
COMMENT ON TABLE "renewal_invitations" IS 'Yenileme daveti (K-10, DOM-KAY-027, IST-100). Velinin yanıtı niyet beyanıdır; sözleşme, taksit ve sınıf yazmaz. Durum saklanmaz: yanıt ve öğrencinin o yılki yenileme kaydından türer. Öğrenci ve yıl başına tek etkin satır.';--> statement-breakpoint
COMMENT ON COLUMN "renewal_invitations"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "renewal_invitations"."id" IS 'Davet kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "renewal_invitations"."student_id" IS 'Öğrenci kaydı (records, students).';--> statement-breakpoint
COMMENT ON COLUMN "renewal_invitations"."academic_year" IS 'Davetin hedef eğitim yılının başlangıç yılı.';--> statement-breakpoint
COMMENT ON COLUMN "renewal_invitations"."invited_by_user_id" IS 'Daveti açan yönetici ya da ön büro kullanıcısı.';--> statement-breakpoint
COMMENT ON COLUMN "renewal_invitations"."response" IS 'Ödeyici velinin son yanıtı: will_renew ya da will_not_renew; boşsa yanıt verilmemiştir.';--> statement-breakpoint
COMMENT ON COLUMN "renewal_invitations"."response_note" IS 'Velinin isteğe bağlı kısa notu, en çok 280 karakter; kişisel veri, loglanmaz.';--> statement-breakpoint
COMMENT ON COLUMN "renewal_invitations"."responded_by_user_id" IS 'Son yanıtı veren veli kullanıcısı.';--> statement-breakpoint
COMMENT ON COLUMN "renewal_invitations"."responded_at" IS 'Son yanıtın anı; plan yapılana kadar değişebilir.';--> statement-breakpoint
COMMENT ON COLUMN "renewal_invitations"."created_at" IS 'Oluşturulma anı.';--> statement-breakpoint
COMMENT ON COLUMN "renewal_invitations"."updated_at" IS 'Son değişiklik anı.';--> statement-breakpoint
COMMENT ON COLUMN "renewal_invitations"."archived_at" IS 'Arşivlenme anı; boşsa etkindir.';--> statement-breakpoint
COMMENT ON COLUMN "renewal_invitations"."version" IS 'İyimser kilit sürümü (If-Match).';