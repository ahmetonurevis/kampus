CREATE TABLE "department_meeting_templates" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"board" text NOT NULL,
	"name" text NOT NULL,
	"items" jsonb NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "department_meeting_templates_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "department_meeting_templates_board_check" CHECK ("department_meeting_templates"."board" in ('department', 'teachers', 'class')),
	CONSTRAINT "department_meeting_templates_name_check" CHECK (char_length("department_meeting_templates"."name") between 2 and 120),
	CONSTRAINT "department_meeting_templates_items_check" CHECK (jsonb_typeof("department_meeting_templates"."items") = 'array'
        and jsonb_array_length("department_meeting_templates"."items") between 1 and 30)
);
--> statement-breakpoint
ALTER TABLE "department_meetings" DROP CONSTRAINT "department_meetings_text_check";--> statement-breakpoint
ALTER TABLE "department_meetings" ALTER COLUMN "subject_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "department_meetings" ALTER COLUMN "subject_name" DROP NOT NULL;--> statement-breakpoint
-- Mevcut tutanaklar zümre toplantısıdır (K-460); varsayılan yalnız dolum içindir, sonra kalkar.
-- Sütun ekleme satırları güncellemez, kesinleşmiş tutanak tetikleyicisi çalışmaz.
ALTER TABLE "department_meetings" ADD COLUMN "board" text DEFAULT 'department' NOT NULL;--> statement-breakpoint
ALTER TABLE "department_meetings" ALTER COLUMN "board" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "department_meetings" ADD COLUMN "class_id" text;--> statement-breakpoint
ALTER TABLE "department_meetings" ADD COLUMN "class_collection" text GENERATED ALWAYS AS ('classes') STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "department_meetings" ADD COLUMN "class_name" text;--> statement-breakpoint
ALTER TABLE "department_meetings" ADD COLUMN "agenda_template_id" uuid;--> statement-breakpoint
ALTER TABLE "department_meeting_templates" ADD CONSTRAINT "department_meeting_templates_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "department_meeting_templates_name_key" ON "department_meeting_templates" USING btree ("institution_id","board","name") WHERE "department_meeting_templates"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "department_meeting_templates_board_idx" ON "department_meeting_templates" USING btree ("institution_id","board");--> statement-breakpoint
ALTER TABLE "department_meetings" ADD CONSTRAINT "department_meetings_class_fkey" FOREIGN KEY ("institution_id","class_collection","class_id") REFERENCES "public"."records"("institution_id","collection","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_meetings" ADD CONSTRAINT "department_meetings_template_fkey" FOREIGN KEY ("institution_id","agenda_template_id") REFERENCES "public"."department_meeting_templates"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "department_meetings_board_idx" ON "department_meetings" USING btree ("institution_id","board","meeting_date");--> statement-breakpoint
CREATE INDEX "department_meetings_class_idx" ON "department_meetings" USING btree ("institution_id","class_id");--> statement-breakpoint
CREATE INDEX "department_meetings_template_idx" ON "department_meetings" USING btree ("institution_id","agenda_template_id");--> statement-breakpoint
ALTER TABLE "department_meetings" ADD CONSTRAINT "department_meetings_board_check" CHECK ("department_meetings"."board" in ('department', 'teachers', 'class'));--> statement-breakpoint
ALTER TABLE "department_meetings" ADD CONSTRAINT "department_meetings_board_target_check" CHECK (("department_meetings"."board" = 'department' and "department_meetings"."subject_id" is not null and "department_meetings"."subject_name" is not null
          and "department_meetings"."class_id" is null and "department_meetings"."class_name" is null)
        or ("department_meetings"."board" = 'class' and "department_meetings"."class_id" is not null and "department_meetings"."class_name" is not null
          and "department_meetings"."subject_id" is null and "department_meetings"."subject_name" is null)
        or ("department_meetings"."board" = 'teachers' and "department_meetings"."subject_id" is null and "department_meetings"."subject_name" is null
          and "department_meetings"."class_id" is null and "department_meetings"."class_name" is null));--> statement-breakpoint
ALTER TABLE "department_meetings" ADD CONSTRAINT "department_meetings_text_check" CHECK (("department_meetings"."subject_id" is null or char_length("department_meetings"."subject_id") between 1 and 60)
        and ("department_meetings"."subject_name" is null or char_length("department_meetings"."subject_name") between 1 and 120)
        and char_length("department_meetings"."location") between 2 and 200
        and ("department_meetings"."class_id" is null or char_length("department_meetings"."class_id") between 1 and 100)
        and ("department_meetings"."class_name" is null or char_length("department_meetings"."class_name") between 1 and 120));--> statement-breakpoint
COMMENT ON TABLE "department_meetings" IS 'Kurul ve zümre toplantısı tutanağı (DOM-FIN-132, DOM-FIN-135, ON-217, ON-218, K-451…K-453, K-460…K-462): zümre toplantısı (ders), öğretmenler kurulu ya da şube öğretmenler kurulu (sınıf); dönem başı, dönem sonu ya da ara toplantı; gündem, başkan, yer ve gün. İmza günüyle kesinleşir; kesinleşen satır değişmez (tetikleyici). Satır silinmez. Yalnız yönetici okur ve yazar.';
--> statement-breakpoint
COMMENT ON COLUMN "department_meetings"."board" IS 'Kurul türü: department (zümre toplantısı; ders zorunlu), teachers (öğretmenler kurulu; ders ve sınıf yok), class (şube öğretmenler kurulu; sınıf zorunlu). ON-218 öncesi kayıtlar department.';
--> statement-breakpoint
COMMENT ON COLUMN "department_meetings"."subject_id" IS 'Zümrenin dersi, yalnız zümre toplantısında (zorunlu): kurumun ders kaydı (subjects) ya da öğretmen kaydının dersi; kurumda ders yoksa müfredat ders kimliği. Diğer kurul türlerinde boş.';
--> statement-breakpoint
COMMENT ON COLUMN "department_meetings"."subject_name" IS 'Ders adının toplantı anındaki kopyası (en çok 120); yalnız zümre toplantısında.';
--> statement-breakpoint
COMMENT ON COLUMN "department_meetings"."class_id" IS 'Şube öğretmenler kurulunun sınıfı (records classes, aynı kurum); yalnız şube kurulunda ve orada zorunlu. Arşivli sınıf yeni toplantıya seçilemez, tutanakta kalır.';
--> statement-breakpoint
COMMENT ON COLUMN "department_meetings"."class_collection" IS 'Yabancı anahtarın koleksiyon parçası; hep ''classes'' (üretilmiş).';
--> statement-breakpoint
COMMENT ON COLUMN "department_meetings"."class_name" IS 'Sınıf adının toplantı anındaki kopyası (en çok 120; tutanak belgesi sınıf adı sonradan değişse de aynı kalır); yalnız şube kurulunda.';
--> statement-breakpoint
COMMENT ON COLUMN "department_meetings"."agenda_template_id" IS 'Gündemin kopyalandığı kurum şablonu (department_meeting_templates, aynı kurum, aynı kurul türü); yalnız izdir, gündem toplantıda saklanır ve şablon değişince değişmez. İsteğe bağlı.';
--> statement-breakpoint
COMMENT ON COLUMN "department_meetings"."kind" IS 'Toplantı zamanı, her kurul türünde: term_start (dönem başı), term_end (dönem sonu), interim (ara toplantı).';
--> statement-breakpoint
COMMENT ON TABLE "department_meeting_templates" IS 'Kurul ve zümre toplantısının gündem şablonu (DOM-FIN-135, ON-218, K-461): kurul türü başına kurumun adlı şablonları ve sıralı maddeleri. Toplantı açılırken gündem kopyalanır, sonra toplantıda düzenlenir. Silinmez, arşivlenir. Yalnız yönetici okur ve yazar.';
--> statement-breakpoint
COMMENT ON COLUMN "department_meeting_templates"."institution_id" IS 'Kurum; birincil anahtarın ve her indeksin ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "department_meeting_templates"."id" IS 'Şablon kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "department_meeting_templates"."board" IS 'Kurul türü: department (zümre toplantısı), teachers (öğretmenler kurulu), class (şube öğretmenler kurulu). Şablon açıldıktan sonra değişmez.';
--> statement-breakpoint
COMMENT ON COLUMN "department_meeting_templates"."name" IS 'Şablon adı (2–120); kurul türünde etkin şablonlar arasında tekil.';
--> statement-breakpoint
COMMENT ON COLUMN "department_meeting_templates"."items" IS 'Gündem maddeleri, görüşülme sırasıyla (jsonb dizi 1–30: title 2–300).';
--> statement-breakpoint
COMMENT ON COLUMN "department_meeting_templates"."created_by_user_id" IS 'Şablonu açan yönetici kullanıcı.';
--> statement-breakpoint
COMMENT ON COLUMN "department_meeting_templates"."created_at" IS 'Oluşturulma anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "department_meeting_templates"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "department_meeting_templates"."archived_at" IS 'Arşivlenme anı; arşivli şablon yeni toplantıya bağlanmaz ve değiştirilmez, bağlı toplantıda kalır.';
--> statement-breakpoint
COMMENT ON COLUMN "department_meeting_templates"."version" IS 'İyimser kilit sürümü (If-Match).';
