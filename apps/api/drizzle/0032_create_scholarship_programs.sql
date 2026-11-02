CREATE TABLE "scholarship_awards" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"student_id" text NOT NULL,
	"academic_year" integer NOT NULL,
	"amount_cents" bigint NOT NULL,
	"awarded_by_user_id" text NOT NULL,
	"mebbis_recorded_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "scholarship_awards_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "scholarship_awards_amount_check" CHECK ("scholarship_awards"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "scholarship_programs" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"academic_year" integer NOT NULL,
	"name" text NOT NULL,
	"conditions" text NOT NULL,
	"termination_conditions" text NOT NULL,
	"duration_note" text NOT NULL,
	"percent_basis_points" integer,
	"amount_cents" bigint,
	"capacity" integer NOT NULL,
	"notified_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "scholarship_programs_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "scholarship_programs_value_check" CHECK (("scholarship_programs"."percent_basis_points" is null) <> ("scholarship_programs"."amount_cents" is null)),
	CONSTRAINT "scholarship_programs_percent_check" CHECK ("scholarship_programs"."percent_basis_points" is null or "scholarship_programs"."percent_basis_points" between 1 and 10000),
	CONSTRAINT "scholarship_programs_amount_check" CHECK ("scholarship_programs"."amount_cents" is null or "scholarship_programs"."amount_cents" > 0),
	CONSTRAINT "scholarship_programs_capacity_check" CHECK ("scholarship_programs"."capacity" > 0)
);
--> statement-breakpoint
ALTER TABLE "scholarship_awards" ADD CONSTRAINT "scholarship_awards_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scholarship_awards" ADD CONSTRAINT "scholarship_awards_program_fkey" FOREIGN KEY ("institution_id","program_id") REFERENCES "public"."scholarship_programs"("institution_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scholarship_programs" ADD CONSTRAINT "scholarship_programs_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scholarship_awards_student_year_key" ON "scholarship_awards" USING btree ("institution_id","student_id","academic_year") WHERE "scholarship_awards"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "scholarship_awards_program_idx" ON "scholarship_awards" USING btree ("institution_id","program_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scholarship_programs_year_name_key" ON "scholarship_programs" USING btree ("institution_id","academic_year","name") WHERE "scholarship_programs"."archived_at" is null;--> statement-breakpoint
COMMENT ON TABLE "scholarship_programs" IS 'Eğitim yılı burs programı. İl millî eğitim müdürlüğüne bildirilmeden kullanılamaz (DOM-FIN-025). Burs indirim değildir, %50 tavanına girmez.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_programs"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_programs"."id" IS 'Program kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_programs"."academic_year" IS 'Eğitim yılının başlangıç yılı.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_programs"."name" IS 'Program adı; yıl içinde tekildir.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_programs"."conditions" IS 'Burs şartları.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_programs"."termination_conditions" IS 'Bursun kesilme koşulları.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_programs"."duration_note" IS 'Bursun süresi (ör. bir eğitim yılı).';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_programs"."percent_basis_points" IS 'Oran, on binde birlik; amount_cents ile birlikte dolmaz.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_programs"."amount_cents" IS 'Sabit tutar, kuruş; percent_basis_points ile birlikte dolmaz.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_programs"."capacity" IS 'Burslu sayısı üst sınırı.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_programs"."notified_date" IS 'İl millî eğitim müdürlüğüne bildirim günü; boşsa program kullanılamaz.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_programs"."created_at" IS 'Oluşturulma anı.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_programs"."updated_at" IS 'Son değişiklik anı.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_programs"."archived_at" IS 'Arşivlenme anı; boşsa etkindir.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_programs"."version" IS 'İyimser kilit sürümü (If-Match).';--> statement-breakpoint
COMMENT ON TABLE "scholarship_awards" IS 'Öğrenciye atanan burs. Kesin kayıtta sözleşmeyle aynı işlemde yazılır; öğrenci bir eğitim yılında en çok bir burs alır (DOM-FIN-025).';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_awards"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_awards"."id" IS 'Atama kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_awards"."program_id" IS 'Burs programı (scholarship_programs).';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_awards"."student_id" IS 'Öğrenci kaydı (records, students).';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_awards"."academic_year" IS 'Eğitim yılının başlangıç yılı.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_awards"."amount_cents" IS 'Atamada hesaplanan burs tutarı, kuruş; sonradan değişmez.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_awards"."awarded_by_user_id" IS 'Bursu onaylayan yönetici.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_awards"."mebbis_recorded_date" IS 'MEBBİS e işlendiği gün; boşsa işlenmemiştir.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_awards"."created_at" IS 'Oluşturulma anı.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_awards"."updated_at" IS 'Son değişiklik anı.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_awards"."archived_at" IS 'Arşivlenme anı; boşsa etkindir.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_awards"."version" IS 'İyimser kilit sürümü (If-Match).';
