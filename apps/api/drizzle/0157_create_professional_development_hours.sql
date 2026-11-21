CREATE TABLE "professional_development_targets" (
	"institution_id" text NOT NULL,
	"academic_year" integer NOT NULL,
	"target_minutes" integer NOT NULL,
	"applies_to_roles" jsonb NOT NULL,
	"updated_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "professional_development_targets_pkey" PRIMARY KEY("institution_id","academic_year"),
	CONSTRAINT "professional_development_targets_year_check" CHECK ("professional_development_targets"."academic_year" between 2000 and 2100),
	CONSTRAINT "professional_development_targets_minutes_check" CHECK ("professional_development_targets"."target_minutes" between 60 and 30000 and "professional_development_targets"."target_minutes" % 60 = 0),
	CONSTRAINT "professional_development_targets_roles_check" CHECK (jsonb_typeof("professional_development_targets"."applies_to_roles") = 'array' and jsonb_array_length("professional_development_targets"."applies_to_roles") between 1 and 3)
);
--> statement-breakpoint
ALTER TABLE "professional_development_enrollments" ADD COLUMN "document_file_id" uuid;--> statement-breakpoint
ALTER TABLE "professional_development_enrollments" ADD COLUMN "certificate_document_id" uuid;--> statement-breakpoint
ALTER TABLE "professional_development_enrollments" ADD COLUMN "development_goal_id" uuid;--> statement-breakpoint
ALTER TABLE "professional_development_targets" ADD CONSTRAINT "professional_development_targets_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_development_enrollments" ADD CONSTRAINT "professional_development_enrollments_document_file_fkey" FOREIGN KEY ("institution_id","document_file_id") REFERENCES "public"."files"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_development_enrollments" ADD CONSTRAINT "professional_development_enrollments_certificate_fkey" FOREIGN KEY ("institution_id","certificate_document_id") REFERENCES "public"."staff_documents"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_development_enrollments" ADD CONSTRAINT "professional_development_enrollments_goal_fkey" FOREIGN KEY ("institution_id","development_goal_id") REFERENCES "public"."staff_development_goals"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "professional_development_enrollments_document_file_key" ON "professional_development_enrollments" USING btree ("institution_id","document_file_id") WHERE "professional_development_enrollments"."document_file_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "professional_development_enrollments_certificate_key" ON "professional_development_enrollments" USING btree ("institution_id","certificate_document_id") WHERE "professional_development_enrollments"."certificate_document_id" is not null;--> statement-breakpoint
CREATE INDEX "professional_development_enrollments_goal_idx" ON "professional_development_enrollments" USING btree ("institution_id","development_goal_id");--> statement-breakpoint
ALTER TABLE "professional_development_enrollments" ADD CONSTRAINT "professional_development_enrollments_documents_check" CHECK ("professional_development_enrollments"."status" = 'attended' or ("professional_development_enrollments"."document_file_id" is null and "professional_development_enrollments"."certificate_document_id" is null));--> statement-breakpoint
COMMENT ON TABLE "professional_development_targets" IS 'Öğretim yılı başına mesleki gelişim hedef saati (DOM-FIN-144, ON-215, K-487): kurum ayarı. Satırı olmayan yılda hedef tanımsızdır; özet yalnız tamamlanan saati gösterir. Tamamlanan saat saklanmaz, katıldı işaretli atamaların katılım dakikasından hesaplanır. Yalnız yönetici okur ve yazar; hedef kaldırılınca satır silinir.';
--> statement-breakpoint
COMMENT ON COLUMN "professional_development_targets"."institution_id" IS 'Kurum; birincil anahtarın ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "professional_development_targets"."academic_year" IS 'Öğretim yılının başlangıç yılı (2026 → 2026–2027; 2000–2100). Aralık kurumun kayıtlı öğretim yılından, yoksa 1 Eylül – 31 Ağustos.';
--> statement-breakpoint
COMMENT ON COLUMN "professional_development_targets"."target_minutes" IS 'Hedef süre, dakika; tam saat (60 katı), 1–500 saat.';
--> statement-breakpoint
COMMENT ON COLUMN "professional_development_targets"."applies_to_roles" IS 'Hedefin uygulandığı personel rolleri (yonetici, ogretmen, onburo; 1–3, varsayılan ogretmen). Diğer roller özette hedefsiz görünür.';
--> statement-breakpoint
COMMENT ON COLUMN "professional_development_targets"."updated_by_user_id" IS 'Hedefi son yazan yönetici (platform kullanıcısı).';
--> statement-breakpoint
COMMENT ON COLUMN "professional_development_targets"."created_at" IS 'Hedefin ilk yazıldığı an (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "professional_development_targets"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "professional_development_targets"."archived_at" IS 'Kullanılmaz (ortak kolon); hedef kaldırılınca satır silinir.';
--> statement-breakpoint
COMMENT ON COLUMN "professional_development_targets"."version" IS 'İyimser kilit sürümü; her yazmada artar.';
--> statement-breakpoint
COMMENT ON COLUMN "professional_development_enrollments"."document_file_id" IS 'Katılım belgesi (DOM-FIN-144, K-488): platform dosyası (amaç document, bağ türü professional_development_enrollment; PDF, en çok 10 MB). Yalnız katıldı durumunda; yeni belge eskisinin yerine geçer, eski dosyanın bağı kalkar. Açılışı denetimde; özlük imhasında (personnel_file) dosya imhaya işaretlenir.';
--> statement-breakpoint
COMMENT ON COLUMN "professional_development_enrollments"."certificate_document_id" IS 'Sertifika bağı (K-488): aynı personelin certificate türündeki özlük belgesi (staff_documents, DOM-FIN-113). İkinci sertifika tablosu yoktur; bir sertifika tek katılıma bağlanır. Yalnız katıldı durumunda; bağ kaldırılınca özlük belgesi kalır.';
--> statement-breakpoint
COMMENT ON COLUMN "professional_development_enrollments"."development_goal_id" IS 'Katkı verdiği gelişim hedefi (K-489; staff_development_goals, DOM-FIN-133): aynı personelin açık ya da süren hedefi; isteğe bağlı. Hedef sonra kapansa da bağ kalır.';
