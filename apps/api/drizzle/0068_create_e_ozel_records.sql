CREATE TABLE "e_ozel_records" (
	"institution_id" text NOT NULL,
	"kind" text NOT NULL,
	"source_id" text NOT NULL,
	"recorded_at" timestamp with time zone,
	"recorded_by_user_id" text,
	"recorded_fingerprint" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "e_ozel_records_pkey" PRIMARY KEY("institution_id","kind","source_id"),
	CONSTRAINT "e_ozel_records_kind_check" CHECK ("e_ozel_records"."kind" in ('learner', 'attendance', 'course_end')),
	CONSTRAINT "e_ozel_records_mark_check" CHECK (("e_ozel_records"."recorded_at" is null) = ("e_ozel_records"."recorded_by_user_id" is null) and ("e_ozel_records"."recorded_at" is null) = ("e_ozel_records"."recorded_fingerprint" is null))
);
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "mebbis_fingerprint" text;--> statement-breakpoint
ALTER TABLE "e_ozel_records" ADD CONSTRAINT "e_ozel_records_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
COMMENT ON TABLE "e_ozel_records" IS 'e-Özel "işlendi" işareti (IST-085, DOM-KAY-015). Kursiyer, devamsızlık ve kurs sonu satırı için kaynak başına bir satır; satır yalnız işaretlenince açılır. Ücret işareti tahsilatın kendi kolonundadır (DOM-FIN-032).';--> statement-breakpoint
COMMENT ON COLUMN "e_ozel_records"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "e_ozel_records"."kind" IS 'Satır türü: learner, attendance, course_end.';--> statement-breakpoint
COMMENT ON COLUMN "e_ozel_records"."source_id" IS 'Kaynağın kimliği: kursiyer (öğrenci kaydı), yoklama satırı ya da kur kaydı. Kaynak başka alanın tablosu olabildiği için yabancı anahtar değildir.';--> statement-breakpoint
COMMENT ON COLUMN "e_ozel_records"."recorded_at" IS 'İşlendi olarak işaretlendiği an; düzeltme işaretinde yenilenir, geri alınınca boş.';--> statement-breakpoint
COMMENT ON COLUMN "e_ozel_records"."recorded_by_user_id" IS 'İşaretleyen personel; recorded_at ile birlikte dolu ya da boştur.';--> statement-breakpoint
COMMENT ON COLUMN "e_ozel_records"."recorded_fingerprint" IS 'İşaretlendiği anki kaynağın özeti (kurumla tuzlanmış kısaltılmış SHA-256). Kişisel değer girdi değildir. Şu anki özetle tutmazsa satır "e-Özel''de düzeltilmeli" görünür; recorded_at ile birlikte dolu ya da boştur.';--> statement-breakpoint
COMMENT ON COLUMN "e_ozel_records"."created_at" IS 'Satırın ilk işaretle açıldığı an.';--> statement-breakpoint
COMMENT ON COLUMN "e_ozel_records"."updated_at" IS 'Son değişiklik anı.';--> statement-breakpoint
COMMENT ON COLUMN "e_ozel_records"."archived_at" IS 'Arşivlenme anı; arşivli satır işaret sayılmaz.';--> statement-breakpoint
COMMENT ON COLUMN "e_ozel_records"."version" IS 'İyimser kilit sürümü; işareti olmayan satır 1 sayılır, ilk işaret 2 yazar.';--> statement-breakpoint
COMMENT ON COLUMN "payments"."mebbis_fingerprint" IS 'Tahsilat e-Özel listesinden işaretlendiği anki kaynağın özeti (IST-085). MEBBİS ucundan yazılan işarette boştur; o durumda yalnız iptal düzeltme gerektirir.';