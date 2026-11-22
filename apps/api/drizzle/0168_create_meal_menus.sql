CREATE TABLE "meal_menu_corrections" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"menu_id" uuid NOT NULL,
	"menu_date" date NOT NULL,
	"meal_kind" text NOT NULL,
	"reason" text NOT NULL,
	"corrected_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "meal_menu_corrections_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "meal_menu_corrections_meal_kind_check" CHECK ("meal_menu_corrections"."meal_kind" in ('breakfast', 'lunch', 'snack')),
	CONSTRAINT "meal_menu_corrections_reason_check" CHECK (char_length("meal_menu_corrections"."reason") between 10 and 500)
);
--> statement-breakpoint
CREATE TABLE "meal_menu_items" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"menu_id" uuid NOT NULL,
	"menu_date" date NOT NULL,
	"meal_kind" text NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"allergens" text[] DEFAULT '{}'::text[] NOT NULL,
	"energy_kcal" integer,
	"protein_dg" integer,
	"fat_dg" integer,
	"carbohydrate_dg" integer,
	"fiber_dg" integer,
	"salt_dg" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "meal_menu_items_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "meal_menu_items_meal_kind_check" CHECK ("meal_menu_items"."meal_kind" in ('breakfast', 'lunch', 'snack')),
	CONSTRAINT "meal_menu_items_position_check" CHECK ("meal_menu_items"."position" between 0 and 9),
	CONSTRAINT "meal_menu_items_name_check" CHECK (char_length("meal_menu_items"."name") between 2 and 120),
	CONSTRAINT "meal_menu_items_allergens_check" CHECK ("meal_menu_items"."allergens" <@ array['gluten', 'crustaceans', 'eggs', 'fish', 'peanuts', 'soybeans', 'milk', 'nuts', 'celery', 'mustard', 'sesame', 'sulphites', 'lupin', 'molluscs']::text[]),
	CONSTRAINT "meal_menu_items_nutrition_check" CHECK ((("meal_menu_items"."energy_kcal" is null) = ("meal_menu_items"."protein_dg" is null)
        and ("meal_menu_items"."energy_kcal" is null) = ("meal_menu_items"."fat_dg" is null)
        and ("meal_menu_items"."energy_kcal" is null) = ("meal_menu_items"."carbohydrate_dg" is null)
        and ("meal_menu_items"."energy_kcal" is not null or ("meal_menu_items"."fiber_dg" is null and "meal_menu_items"."salt_dg" is null)))
        and ("meal_menu_items"."energy_kcal" is null or "meal_menu_items"."energy_kcal" between 0 and 3000)
        and ("meal_menu_items"."protein_dg" is null or "meal_menu_items"."protein_dg" between 0 and 5000)
        and ("meal_menu_items"."fat_dg" is null or "meal_menu_items"."fat_dg" between 0 and 5000)
        and ("meal_menu_items"."carbohydrate_dg" is null or "meal_menu_items"."carbohydrate_dg" between 0 and 5000)
        and ("meal_menu_items"."fiber_dg" is null or "meal_menu_items"."fiber_dg" between 0 and 5000)
        and ("meal_menu_items"."salt_dg" is null or "meal_menu_items"."salt_dg" between 0 and 200))
);
--> statement-breakpoint
CREATE TABLE "meal_menu_settings" (
	"institution_id" text PRIMARY KEY NOT NULL,
	"meal_kinds" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "meal_menu_settings_meal_kinds_check" CHECK (cardinality("meal_menu_settings"."meal_kinds") >= 1 and "meal_menu_settings"."meal_kinds" <@ array['breakfast', 'lunch', 'snack']::text[])
);
--> statement-breakpoint
CREATE TABLE "meal_menus" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"branch_id" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"published_by_user_id" text,
	"copied_from_menu_id" uuid,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "meal_menus_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "meal_menus_status_check" CHECK ("meal_menus"."status" in ('draft', 'published')),
	CONSTRAINT "meal_menus_week_start_check" CHECK (extract(isodow from "meal_menus"."week_start") = 1),
	CONSTRAINT "meal_menus_published_check" CHECK (("meal_menus"."status" = 'published') = ("meal_menus"."published_at" is not null)
        and ("meal_menus"."published_at" is null) = ("meal_menus"."published_by_user_id" is null)),
	CONSTRAINT "meal_menus_archive_check" CHECK ("meal_menus"."archived_at" is null or "meal_menus"."status" = 'draft')
);
--> statement-breakpoint
ALTER TABLE "meal_menu_corrections" ADD CONSTRAINT "meal_menu_corrections_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_menu_corrections" ADD CONSTRAINT "meal_menu_corrections_menu_fkey" FOREIGN KEY ("institution_id","menu_id") REFERENCES "public"."meal_menus"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_menu_items" ADD CONSTRAINT "meal_menu_items_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_menu_items" ADD CONSTRAINT "meal_menu_items_menu_fkey" FOREIGN KEY ("institution_id","menu_id") REFERENCES "public"."meal_menus"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_menu_settings" ADD CONSTRAINT "meal_menu_settings_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_menus" ADD CONSTRAINT "meal_menus_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meal_menu_corrections_menu_idx" ON "meal_menu_corrections" USING btree ("institution_id","menu_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meal_menu_items_slot_key" ON "meal_menu_items" USING btree ("institution_id","menu_id","menu_date","meal_kind","position") WHERE "meal_menu_items"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "meal_menu_items_menu_idx" ON "meal_menu_items" USING btree ("institution_id","menu_id","menu_date");--> statement-breakpoint
CREATE UNIQUE INDEX "meal_menus_week_key" ON "meal_menus" USING btree ("institution_id","week_start",coalesce("branch_id", '')) WHERE "meal_menus"."archived_at" is null;--> statement-breakpoint
CREATE TRIGGER "meal_menu_corrections_immutable_trigger" BEFORE UPDATE OR DELETE ON "meal_menu_corrections" FOR EACH ROW EXECUTE FUNCTION "kampus_reject_immutable_change"();
--> statement-breakpoint
CREATE TRIGGER "meal_menu_corrections_truncate_trigger" BEFORE TRUNCATE ON "meal_menu_corrections" FOR EACH STATEMENT EXECUTE FUNCTION "kampus_reject_immutable_change"();
--> statement-breakpoint
COMMENT ON TABLE "meal_menus" IS 'Haftalık yemek menüsü (DOM-FIN-157, ON-090, ON-149, K-526, K-527): kurumun ya da bir kampüsün pazartesiyle başlayan haftası. Aynı hafta ve kampüs için tek etkin menü (kampüssüz menü bütün kampüslerindir; aile görünümünde kampüsün kendi menüsü öncelikli). Taslak yalnız yönetici ve ön büroda görünür; yayımlanan menü veli ve öğrenciye açılır. Yalnız taslak arşivlenir. Menü sağlık verisi değildir.';
--> statement-breakpoint
COMMENT ON COLUMN "meal_menus"."institution_id" IS 'Kurum; birincil anahtarın ve her indeksin ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "meal_menus"."id" IS 'Menü kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "meal_menus"."week_start" IS 'Haftanın pazartesisi (Europe/Istanbul takvim günü).';
--> statement-breakpoint
COMMENT ON COLUMN "meal_menus"."branch_id" IS 'Kampüs (records branches kimliği; yabancı anahtar yok); boşsa bütün kampüsler.';
--> statement-breakpoint
COMMENT ON COLUMN "meal_menus"."status" IS 'Durum: draft (taslak) ya da published (yayımlandı).';
--> statement-breakpoint
COMMENT ON COLUMN "meal_menus"."published_at" IS 'Son yayım anı (UTC); taslakta boş.';
--> statement-breakpoint
COMMENT ON COLUMN "meal_menus"."published_by_user_id" IS 'Son yayımlayan kullanıcı; taslakta boş.';
--> statement-breakpoint
COMMENT ON COLUMN "meal_menus"."copied_from_menu_id" IS 'Kalemleri kopyalanan kaynak menü (ör. önceki hafta); kopya değilse boş. İz içindir, yabancı anahtar yok.';
--> statement-breakpoint
COMMENT ON COLUMN "meal_menus"."created_by_user_id" IS 'Menüyü açan kullanıcı.';
--> statement-breakpoint
COMMENT ON COLUMN "meal_menus"."created_at" IS 'Oluşturulma anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "meal_menus"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "meal_menus"."archived_at" IS 'Arşiv anı; dolu satır okunmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "meal_menus"."version" IS 'İyimser kilit sürümü (If-Match); her yazmada 1 artar.';
--> statement-breakpoint
COMMENT ON TABLE "meal_menu_items" IS 'Menü kalemi (DOM-FIN-157, K-527, K-528): gün × öğün hücresindeki sıralı yemek; TGK Gıda Etiketleme ve Tüketicileri Bilgilendirme Yönetmeliği Ek-1 listesinden alerjen işaretleri ve isteğe bağlı porsiyon besin değeri (tamsayı; gramlar gramın onda biri). Hücre düzenlemesi eski kalemleri arşivler, yenilerini ekler; arşivli kalem geçmişin izidir. Günlük toplam saklanmaz, okumada hesaplanır.';
--> statement-breakpoint
COMMENT ON COLUMN "meal_menu_items"."institution_id" IS 'Kurum; birincil anahtarın ve her indeksin ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "meal_menu_items"."id" IS 'Kalem kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "meal_menu_items"."menu_id" IS 'Menü (meal_menus).';
--> statement-breakpoint
COMMENT ON COLUMN "meal_menu_items"."menu_date" IS 'Menü günü (Europe/Istanbul takvim günü); menünün haftasında.';
--> statement-breakpoint
COMMENT ON COLUMN "meal_menu_items"."meal_kind" IS 'Öğün: breakfast (kahvaltı), lunch (öğle), snack (ikindi ara öğünü).';
--> statement-breakpoint
COMMENT ON COLUMN "meal_menu_items"."position" IS 'Hücredeki sıra (0 tabanlı, en çok 10 kalem); etkin kalemlerde tekil.';
--> statement-breakpoint
COMMENT ON COLUMN "meal_menu_items"."name" IS 'Yemek adı (2–120 karakter).';
--> statement-breakpoint
COMMENT ON COLUMN "meal_menu_items"."allergens" IS 'İçerdiği alerjenler (14 anahtardan: gluten, crustaceans, eggs, fish, peanuts, soybeans, milk, nuts, celery, mustard, sesame, sulphites, lupin, molluscs); boş liste işaretli alerjen yok demektir.';
--> statement-breakpoint
COMMENT ON COLUMN "meal_menu_items"."energy_kcal" IS 'Porsiyon enerjisi (kcal, 0–3000); besin değeri girilmemişse boş.';
--> statement-breakpoint
COMMENT ON COLUMN "meal_menu_items"."protein_dg" IS 'Protein (gramın onda biri, 0–5000); enerjiyle birlikte dolu.';
--> statement-breakpoint
COMMENT ON COLUMN "meal_menu_items"."fat_dg" IS 'Yağ (gramın onda biri, 0–5000); enerjiyle birlikte dolu.';
--> statement-breakpoint
COMMENT ON COLUMN "meal_menu_items"."carbohydrate_dg" IS 'Karbonhidrat (gramın onda biri, 0–5000); enerjiyle birlikte dolu.';
--> statement-breakpoint
COMMENT ON COLUMN "meal_menu_items"."fiber_dg" IS 'Lif (gramın onda biri, 0–5000); bilinmiyorsa boş, besin değeri yoksa boş.';
--> statement-breakpoint
COMMENT ON COLUMN "meal_menu_items"."salt_dg" IS 'Tuz (gramın onda biri, 0–200); bilinmiyorsa boş, besin değeri yoksa boş.';
--> statement-breakpoint
COMMENT ON COLUMN "meal_menu_items"."created_at" IS 'Oluşturulma anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "meal_menu_items"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "meal_menu_items"."archived_at" IS 'Arşiv anı; dolu satır okunmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "meal_menu_items"."version" IS 'İyimser kilit sürümü (If-Match); her yazmada 1 artar.';
--> statement-breakpoint
COMMENT ON TABLE "meal_menu_corrections" IS 'Yayımlanmış menünün geçmiş gün düzeltmesi (DOM-FIN-157, K-527): yöneticinin gerekçeyle yeniden yazdığı gün × öğün hücresi; önceki kalemler meal_menu_items içinde arşivli kalır. Satır yalnız eklenir (kampus_reject_immutable_change).';
--> statement-breakpoint
COMMENT ON COLUMN "meal_menu_corrections"."institution_id" IS 'Kurum; birincil anahtarın ve her indeksin ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "meal_menu_corrections"."id" IS 'Düzeltme kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "meal_menu_corrections"."menu_id" IS 'Düzeltilen menü (meal_menus).';
--> statement-breakpoint
COMMENT ON COLUMN "meal_menu_corrections"."menu_date" IS 'Düzeltilen gün; düzeltme anında bugünden önce.';
--> statement-breakpoint
COMMENT ON COLUMN "meal_menu_corrections"."meal_kind" IS 'Düzeltilen öğün.';
--> statement-breakpoint
COMMENT ON COLUMN "meal_menu_corrections"."reason" IS 'Düzeltme gerekçesi (10–500 karakter). Serbest metin; loga ve denetim değerine yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "meal_menu_corrections"."corrected_by_user_id" IS 'Düzelten yönetici kullanıcısı.';
--> statement-breakpoint
COMMENT ON COLUMN "meal_menu_corrections"."created_at" IS 'Oluşturulma anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "meal_menu_corrections"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "meal_menu_corrections"."archived_at" IS 'Arşiv anı; dolu satır okunmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "meal_menu_corrections"."version" IS 'İyimser kilit sürümü (If-Match); her yazmada 1 artar.';
--> statement-breakpoint
COMMENT ON TABLE "meal_menu_settings" IS 'Kurumun yemek menüsü ayarı (DOM-FIN-157, K-526): kullanılan öğünler. Satır yoksa yalnız öğle yemeği açıktır; ilk kayıt satırı sürüm 2 ile açar. Kapanan öğünün mevcut kalemleri görünmeye devam eder, yeni kalem yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "meal_menu_settings"."institution_id" IS 'Kurum; birincil anahtarın ve her indeksin ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "meal_menu_settings"."meal_kinds" IS 'Açık öğünler (breakfast, lunch, snack; en az bir).';
--> statement-breakpoint
COMMENT ON COLUMN "meal_menu_settings"."created_at" IS 'Oluşturulma anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "meal_menu_settings"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "meal_menu_settings"."archived_at" IS 'Arşiv anı; dolu satır okunmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "meal_menu_settings"."version" IS 'İyimser kilit sürümü (If-Match); her yazmada 1 artar.';
