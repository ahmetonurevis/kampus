CREATE TABLE "enrollment_freezes" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"student_id" text NOT NULL,
	"status" text NOT NULL,
	"reason" text NOT NULL,
	"start_date" date NOT NULL,
	"return_date" date NOT NULL,
	"ended_date" date,
	"mid_course" boolean DEFAULT false NOT NULL,
	"document_received" boolean DEFAULT false NOT NULL,
	"requested_by_user_id" text NOT NULL,
	"decided_by_user_id" text,
	"decided_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"needs_placement" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "enrollment_freezes_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "enrollment_freezes_status_check" CHECK ("enrollment_freezes"."status" in ('requested', 'approved', 'rejected', 'ended', 'cancelled')),
	CONSTRAINT "enrollment_freezes_reason_check" CHECK ("enrollment_freezes"."reason" in ('documented', 'military', 'relocation', 'work_school_schedule', 'other')),
	CONSTRAINT "enrollment_freezes_dates_check" CHECK ("enrollment_freezes"."return_date" > "enrollment_freezes"."start_date"),
	CONSTRAINT "enrollment_freezes_document_check" CHECK (not "enrollment_freezes"."mid_course" or "enrollment_freezes"."document_received"),
	CONSTRAINT "enrollment_freezes_decision_check" CHECK (("enrollment_freezes"."decided_at" is null) = ("enrollment_freezes"."decided_by_user_id" is null)
        and ("enrollment_freezes"."decided_at" is null) = ("enrollment_freezes"."status" in ('requested', 'cancelled'))),
	CONSTRAINT "enrollment_freezes_lifecycle_check" CHECK (("enrollment_freezes"."ended_date" is not null) = ("enrollment_freezes"."status" = 'ended')
        and ("enrollment_freezes"."started_at" is null or "enrollment_freezes"."status" in ('approved', 'ended')))
);
--> statement-breakpoint
ALTER TABLE "enrollment_freezes" ADD CONSTRAINT "enrollment_freezes_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "enrollment_freezes_open_key" ON "enrollment_freezes" USING btree ("institution_id","student_id") WHERE "enrollment_freezes"."status" in ('requested', 'approved') and "enrollment_freezes"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "enrollment_freezes_student_idx" ON "enrollment_freezes" USING btree ("institution_id","student_id");--> statement-breakpoint
CREATE INDEX "enrollment_freezes_created_idx" ON "enrollment_freezes" USING btree ("institution_id","created_at");--> statement-breakpoint
CREATE INDEX "enrollment_freezes_due_idx" ON "enrollment_freezes" USING btree ("institution_id","start_date") WHERE "enrollment_freezes"."status" = 'approved' and "enrollment_freezes"."started_at" is null;
--> statement-breakpoint
-- Elle eklendi (drizzle-kit COMMENT ON üretmez): tablo ve kolon açıklamaları.
COMMENT ON TABLE "enrollment_freezes" IS 'Dil okulunda kayıt dondurma (DOM-DIL-052, DOM-KAY-024, IST-084): talep, karar, etki ve dönüş tek satırdadır. Dondurma ayrılış değildir; kursiyerin tek açık kaydı olur, toplam süre 183 günü geçemez. Serbest metin kolonu yoktur (K-20). MEBBİS etkisi doğrulanmalı (H-24).';
--> statement-breakpoint
COMMENT ON COLUMN "enrollment_freezes"."institution_id" IS 'Kurum.';
--> statement-breakpoint
COMMENT ON COLUMN "enrollment_freezes"."id" IS 'Dondurma kaydı kimliği.';
--> statement-breakpoint
COMMENT ON COLUMN "enrollment_freezes"."student_id" IS 'Kursiyerin records kimliği (students koleksiyonu); yabancı anahtar değildir.';
--> statement-breakpoint
COMMENT ON COLUMN "enrollment_freezes"."status" IS 'Saklanan durum: requested, approved, rejected, ended, cancelled. Aşama (scheduled, frozen, overdue) saklanmaz, tarihlerden türetilir.';
--> statement-breakpoint
COMMENT ON COLUMN "enrollment_freezes"."reason" IS 'Neden kategorisi: documented (belgeli neden), military, relocation, work_school_schedule, other. Serbest metin neden tutulmaz; sağlık ayrı kategori değildir, belgeli neden altında kalır ve ayrıntısı hiçbir kolona yazılmaz (K-20, KVKK m.6).';
--> statement-breakpoint
COMMENT ON COLUMN "enrollment_freezes"."start_date" IS 'Dondurmanın başladığı gün (Europe/Istanbul günü).';
--> statement-breakpoint
COMMENT ON COLUMN "enrollment_freezes"."return_date" IS 'Planlanan dönüş; kursiyer kendiliğinden dönmez, başlangıçtan sonra olmalıdır.';
--> statement-breakpoint
COMMENT ON COLUMN "enrollment_freezes"."ended_date" IS 'Gerçek bitiş: dönüş ya da ayrılış günü; yalnız ended durumunda dolu.';
--> statement-breakpoint
COMMENT ON COLUMN "enrollment_freezes"."mid_course" IS 'Başlangıç kur ortasına denk geldi; belge beyanı zorunludur.';
--> statement-breakpoint
COMMENT ON COLUMN "enrollment_freezes"."document_received" IS 'Belge alındı beyanı; dosya içeriği ve belge tanımı tutulmaz (K-20).';
--> statement-breakpoint
COMMENT ON COLUMN "enrollment_freezes"."requested_by_user_id" IS 'Talebi açan kullanıcı (kursiyer, veli ya da personel).';
--> statement-breakpoint
COMMENT ON COLUMN "enrollment_freezes"."decided_by_user_id" IS 'Kararı veren yönetici; karar gerekçesi serbest metin olarak tutulmaz (K-20).';
--> statement-breakpoint
COMMENT ON COLUMN "enrollment_freezes"."decided_at" IS 'Karar anı.';
--> statement-breakpoint
COMMENT ON COLUMN "enrollment_freezes"."started_at" IS 'Etkinin doğduğu an; öğrencinin frozenAt bayrağıyla aynı işlemde yazılır.';
--> statement-breakpoint
COMMENT ON COLUMN "enrollment_freezes"."needs_placement" IS 'Dönüşte eski grup uygun değildi; kursiyer yeniden yerleştirilir.';
--> statement-breakpoint
COMMENT ON COLUMN "enrollment_freezes"."created_at" IS 'Oluşturulma anı.';
--> statement-breakpoint
COMMENT ON COLUMN "enrollment_freezes"."updated_at" IS 'Son güncelleme anı.';
--> statement-breakpoint
COMMENT ON COLUMN "enrollment_freezes"."archived_at" IS 'Arşivlenme anı; kayıt silinmez.';
--> statement-breakpoint
COMMENT ON COLUMN "enrollment_freezes"."version" IS 'İyimser kilit sürümü (If-Match).';
