CREATE TABLE "meal_allergy_checks" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"student_id" text NOT NULL,
	"service_date" date NOT NULL,
	"meal_kind" text NOT NULL,
	"menu_id" uuid NOT NULL,
	"acknowledged_by_membership_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "meal_allergy_checks_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "meal_allergy_checks_meal_kind_check" CHECK ("meal_allergy_checks"."meal_kind" in ('breakfast', 'lunch', 'snack'))
);
--> statement-breakpoint
ALTER TABLE "meal_allergy_checks" ADD CONSTRAINT "meal_allergy_checks_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_allergy_checks" ADD CONSTRAINT "meal_allergy_checks_menu_fkey" FOREIGN KEY ("institution_id","menu_id") REFERENCES "public"."meal_menus"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_allergy_checks" ADD CONSTRAINT "meal_allergy_checks_acknowledged_by_fkey" FOREIGN KEY ("institution_id","acknowledged_by_membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "meal_allergy_checks_student_meal_key" ON "meal_allergy_checks" USING btree ("institution_id","student_id","service_date","meal_kind");--> statement-breakpoint
CREATE INDEX "meal_allergy_checks_menu_idx" ON "meal_allergy_checks" USING btree ("institution_id","menu_id");--> statement-breakpoint
CREATE INDEX "meal_allergy_checks_acknowledged_by_idx" ON "meal_allergy_checks" USING btree ("institution_id","acknowledged_by_membership_id");--> statement-breakpoint
CREATE TRIGGER "meal_allergy_checks_immutable_trigger" BEFORE UPDATE OR DELETE ON "meal_allergy_checks" FOR EACH ROW EXECUTE FUNCTION "kampus_reject_immutable_change"();
--> statement-breakpoint
CREATE TRIGGER "meal_allergy_checks_truncate_trigger" BEFORE TRUNCATE ON "meal_allergy_checks" FOR EACH STATEMENT EXECUTE FUNCTION "kampus_reject_immutable_change"();
--> statement-breakpoint
COMMENT ON TABLE "meal_allergy_checks" IS 'Yemekhane alerji uyarısının görevli onayı (DOM-FIN-162, ON-151, K-543): "uyarı görüldü, alternatif verildi" işareti. Öğrenci × servis günü × öğün başına bir satır; yalnız bugünün öğününde ve öğrencinin o öğünde uyarısı varken yazılır. Uyarının içeriği (alerjen, şiddet) saklanmaz, her okumada sağlık profilinden ve yayımlanmış menüden yeniden hesaplanır. Satır yalnız eklenir (kampus_reject_immutable_change).';
--> statement-breakpoint
COMMENT ON COLUMN "meal_allergy_checks"."institution_id" IS 'Kurum; birincil anahtarın ve her indeksin ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "meal_allergy_checks"."id" IS 'İşaret kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "meal_allergy_checks"."student_id" IS 'Öğrenci (records students kimliği; yabancı anahtar yok). Satırın varlığı öğrencinin o öğünde alerji uyarısı olduğunu gösterir; içerik tutulmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "meal_allergy_checks"."service_date" IS 'Servis günü (Europe/Istanbul takvim günü); yazıldığı gün.';
--> statement-breakpoint
COMMENT ON COLUMN "meal_allergy_checks"."meal_kind" IS 'Öğün: breakfast (kahvaltı), lunch (öğle), snack (ikindi ara öğünü).';
--> statement-breakpoint
COMMENT ON COLUMN "meal_allergy_checks"."menu_id" IS 'İşaret anında kontrol edilen yayımlanmış menü (meal_menus).';
--> statement-breakpoint
COMMENT ON COLUMN "meal_allergy_checks"."acknowledged_by_membership_id" IS 'İşareti koyan görevlinin kurum üyeliği (memberships); saat created_at kolonundadır.';
--> statement-breakpoint
COMMENT ON COLUMN "meal_allergy_checks"."created_at" IS 'İşaret anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "meal_allergy_checks"."updated_at" IS 'Son değişiklik anı (UTC); satır değişmediğinden oluşturma anına eşittir.';
--> statement-breakpoint
COMMENT ON COLUMN "meal_allergy_checks"."archived_at" IS 'Arşiv anı; satır değişmez, kullanılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "meal_allergy_checks"."version" IS 'İyimser kilit sürümü; satır değişmediğinden 1.';
