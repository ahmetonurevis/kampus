CREATE TABLE "lost_item_reports" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"student_id" text NOT NULL,
	"description" text NOT NULL,
	"category" text,
	"lost_on" date NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"matched_item_id" uuid,
	"matched_at" timestamp with time zone,
	"returned_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"closed_by_user_id" text,
	"reported_by_user_id" text NOT NULL,
	"reporter_role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "lost_item_reports_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "lost_item_reports_status_check" CHECK ("lost_item_reports"."status" in ('open', 'matched', 'returned', 'closed')),
	CONSTRAINT "lost_item_reports_category_check" CHECK ("lost_item_reports"."category" is null or "lost_item_reports"."category" in ('clothing', 'electronics', 'stationery', 'valuable', 'other')),
	CONSTRAINT "lost_item_reports_description_check" CHECK (char_length("lost_item_reports"."description") between 2 and 300),
	CONSTRAINT "lost_item_reports_role_check" CHECK ("lost_item_reports"."reporter_role" in ('veli', 'ogrenci')),
	CONSTRAINT "lost_item_reports_match_check" CHECK (("lost_item_reports"."status" in ('matched', 'returned')) = ("lost_item_reports"."matched_item_id" is not null) and ("lost_item_reports"."matched_item_id" is null) = ("lost_item_reports"."matched_at" is null) and ("lost_item_reports"."status" = 'returned') = ("lost_item_reports"."returned_at" is not null) and ("lost_item_reports"."status" = 'closed') = ("lost_item_reports"."closed_at" is not null) and ("lost_item_reports"."closed_at" is null) = ("lost_item_reports"."closed_by_user_id" is null))
);
--> statement-breakpoint
CREATE TABLE "lost_item_settings" (
	"institution_id" text PRIMARY KEY NOT NULL,
	"retention_days" integer DEFAULT 30 NOT NULL,
	"family_gallery_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "lost_item_settings_retention_check" CHECK ("lost_item_settings"."retention_days" between 7 and 365)
);
--> statement-breakpoint
CREATE TABLE "lost_items" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"found_location" text NOT NULL,
	"found_on" date NOT NULL,
	"finder_membership_id" text,
	"storage_location" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"recipient_type" text,
	"recipient_student_id" text,
	"recipient_guardian_link_id" text,
	"recipient_name" text,
	"handed_over_at" timestamp with time zone,
	"handed_over_by_membership_id" text,
	"disposed_at" timestamp with time zone,
	"disposal_reason" text,
	"disposed_by_membership_id" text,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "lost_items_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "lost_items_category_check" CHECK ("lost_items"."category" in ('clothing', 'electronics', 'stationery', 'valuable', 'other')),
	CONSTRAINT "lost_items_status_check" CHECK ("lost_items"."status" in ('pending', 'handed_over', 'donated', 'destroyed')),
	CONSTRAINT "lost_items_description_check" CHECK (char_length("lost_items"."description") between 2 and 300),
	CONSTRAINT "lost_items_location_check" CHECK (char_length("lost_items"."found_location") between 1 and 120 and char_length("lost_items"."storage_location") between 1 and 120),
	CONSTRAINT "lost_items_handover_check" CHECK (("lost_items"."status" = 'handed_over') = ("lost_items"."handed_over_at" is not null) and ("lost_items"."handed_over_at" is null) = ("lost_items"."recipient_type" is null) and ("lost_items"."handed_over_at" is null) = ("lost_items"."handed_over_by_membership_id" is null) and ("lost_items"."handed_over_at" is null) = ("lost_items"."recipient_name" is null)),
	CONSTRAINT "lost_items_recipient_check" CHECK ("lost_items"."recipient_type" is null or ("lost_items"."recipient_type" in ('student', 'guardian', 'other') and ("lost_items"."recipient_type" = 'other') = ("lost_items"."recipient_student_id" is null) and ("lost_items"."recipient_type" = 'guardian') = ("lost_items"."recipient_guardian_link_id" is not null) and char_length("lost_items"."recipient_name") between 1 and 120)),
	CONSTRAINT "lost_items_disposal_check" CHECK (("lost_items"."status" in ('donated', 'destroyed')) = ("lost_items"."disposed_at" is not null) and ("lost_items"."disposed_at" is null) = ("lost_items"."disposal_reason" is null) and ("lost_items"."disposed_at" is null) = ("lost_items"."disposed_by_membership_id" is null) and ("lost_items"."disposal_reason" is null or char_length("lost_items"."disposal_reason") between 2 and 300))
);
--> statement-breakpoint
ALTER TABLE "lost_item_reports" ADD CONSTRAINT "lost_item_reports_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lost_item_reports" ADD CONSTRAINT "lost_item_reports_item_fkey" FOREIGN KEY ("institution_id","matched_item_id") REFERENCES "public"."lost_items"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lost_item_settings" ADD CONSTRAINT "lost_item_settings_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lost_items" ADD CONSTRAINT "lost_items_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lost_items" ADD CONSTRAINT "lost_items_finder_membership_fkey" FOREIGN KEY ("institution_id","finder_membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lost_items" ADD CONSTRAINT "lost_items_handed_over_by_fkey" FOREIGN KEY ("institution_id","handed_over_by_membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lost_items" ADD CONSTRAINT "lost_items_disposed_by_fkey" FOREIGN KEY ("institution_id","disposed_by_membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lost_item_reports_status_idx" ON "lost_item_reports" USING btree ("institution_id","status","lost_on");--> statement-breakpoint
CREATE INDEX "lost_item_reports_student_idx" ON "lost_item_reports" USING btree ("institution_id","student_id");--> statement-breakpoint
CREATE INDEX "lost_item_reports_item_idx" ON "lost_item_reports" USING btree ("institution_id","matched_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lost_item_reports_matched_item_key" ON "lost_item_reports" USING btree ("institution_id","matched_item_id") WHERE "lost_item_reports"."status" = 'matched';--> statement-breakpoint
CREATE INDEX "lost_items_status_found_idx" ON "lost_items" USING btree ("institution_id","status","found_on");--> statement-breakpoint
CREATE INDEX "lost_items_finder_idx" ON "lost_items" USING btree ("institution_id","finder_membership_id");--> statement-breakpoint
CREATE INDEX "lost_items_handed_over_by_idx" ON "lost_items" USING btree ("institution_id","handed_over_by_membership_id");--> statement-breakpoint
CREATE INDEX "lost_items_disposed_by_idx" ON "lost_items" USING btree ("institution_id","disposed_by_membership_id");--> statement-breakpoint
COMMENT ON TABLE "lost_items" IS 'Bulunan eşya (DOM-FIN-145, ON-171, K-490…K-492): tanım, kategori, bulunduğu yer ve gün, saklama yeri, durum, teslim ve bağış/imha kaydı. Fotoğraflar files satırlarıdır (attached_type = lost_item). Bekleyen dışındaki satır değişmez; satır silinmez.';
--> statement-breakpoint
COMMENT ON TABLE "lost_item_reports" IS 'Kayıp bildirimi (DOM-FIN-145, ON-171, K-491): veli çocuğu, öğrenci kendisi için açar; ön büro bulunan eşyayla eşler, eşya teslim edilince returned olur.';
--> statement-breakpoint
COMMENT ON TABLE "lost_item_settings" IS 'Kayıp eşya ayarı (DOM-FIN-145, K-491, K-492): saklama süresi ve aile galerisi.';
--> statement-breakpoint
COMMENT ON COLUMN "lost_items"."institution_id" IS 'Kurum.';
--> statement-breakpoint
COMMENT ON COLUMN "lost_items"."id" IS 'Eşya kaydı kimliği (UUID); fotoğraf dosyalarının attached_id değeri.';
--> statement-breakpoint
COMMENT ON COLUMN "lost_items"."description" IS 'Eşyanın tanımı (2–300; serbest metin, kişisel veri içerebilir). Aile galerisinde gösterilmez.';
--> statement-breakpoint
COMMENT ON COLUMN "lost_items"."category" IS 'Kategori: clothing giysi, electronics elektronik, stationery kırtasiye, valuable değerli eşya, other diğer.';
--> statement-breakpoint
COMMENT ON COLUMN "lost_items"."found_location" IS 'Eşyanın bulunduğu yer (1–120).';
--> statement-breakpoint
COMMENT ON COLUMN "lost_items"."found_on" IS 'Bulunduğu gün (Europe/Istanbul); saklama süresinin başlangıcı. Bugünden sonra ve 90 günden eski olamaz (uygulama).';
--> statement-breakpoint
COMMENT ON COLUMN "lost_items"."finder_membership_id" IS 'Bulan ya da eşyayı teslim alan personelin kurum üyeliği (isteğe bağlı; memberships FK, restrict).';
--> statement-breakpoint
COMMENT ON COLUMN "lost_items"."storage_location" IS 'Eşyanın saklandığı yer (1–120).';
--> statement-breakpoint
COMMENT ON COLUMN "lost_items"."status" IS 'Durum: pending bekliyor, handed_over teslim edildi, donated bağışlandı, destroyed imha edildi. pending dışındaki kayıt değişmez.';
--> statement-breakpoint
COMMENT ON COLUMN "lost_items"."recipient_type" IS 'Teslim alan: student öğrenci, guardian öğrencinin velisi, other adıyla başka kişi; yalnız teslimde dolu.';
--> statement-breakpoint
COMMENT ON COLUMN "lost_items"."recipient_student_id" IS 'Eşyanın sahibi öğrenci (records students kimliği); student ve guardian tesliminde dolu.';
--> statement-breakpoint
COMMENT ON COLUMN "lost_items"."recipient_guardian_link_id" IS 'Teslim alan velinin öğrenciyle bağı (student_guardians kimliği); yalnız guardian.';
--> statement-breakpoint
COMMENT ON COLUMN "lost_items"."recipient_name" IS 'Teslim alanın adı (teslim anındaki kopya, kişisel veri); other tesliminde girilen ad.';
--> statement-breakpoint
COMMENT ON COLUMN "lost_items"."handed_over_at" IS 'Teslim anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "lost_items"."handed_over_by_membership_id" IS 'Teslim eden personelin kurum üyeliği (memberships FK, restrict).';
--> statement-breakpoint
COMMENT ON COLUMN "lost_items"."disposed_at" IS 'Bağış ya da imha anı (UTC); saklama süresi dolan eşyada yöneticinin toplu işlemi.';
--> statement-breakpoint
COMMENT ON COLUMN "lost_items"."disposal_reason" IS 'Bağış/imha gerekçesi (2–300, serbest metin); denetime ve loga yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "lost_items"."disposed_by_membership_id" IS 'Bağış/imhayı yapan yöneticinin kurum üyeliği (memberships FK, restrict).';
--> statement-breakpoint
COMMENT ON COLUMN "lost_items"."created_by_user_id" IS 'Kaydı açan kullanıcı.';
--> statement-breakpoint
COMMENT ON COLUMN "lost_items"."created_at" IS 'Oluşturulma anı.';
--> statement-breakpoint
COMMENT ON COLUMN "lost_items"."updated_at" IS 'Son güncelleme anı.';
--> statement-breakpoint
COMMENT ON COLUMN "lost_items"."archived_at" IS 'Arşiv anı (kullanılmıyor; satır silinmez).';
--> statement-breakpoint
COMMENT ON COLUMN "lost_items"."version" IS 'İyimser kilit sürümü (If-Match).';
--> statement-breakpoint
COMMENT ON COLUMN "lost_item_reports"."institution_id" IS 'Kurum.';
--> statement-breakpoint
COMMENT ON COLUMN "lost_item_reports"."id" IS 'Kayıp bildirimi kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "lost_item_reports"."student_id" IS 'Eşyası kaybolan öğrenci (records students kimliği); veli kendi çocuğu, öğrenci kendisi için açar.';
--> statement-breakpoint
COMMENT ON COLUMN "lost_item_reports"."description" IS 'Kaybolan eşyanın tanımı (2–300; serbest metin).';
--> statement-breakpoint
COMMENT ON COLUMN "lost_item_reports"."category" IS 'Kategori (isteğe bağlı; lost_items.category değerleri).';
--> statement-breakpoint
COMMENT ON COLUMN "lost_item_reports"."lost_on" IS 'Kaybolduğu gün (Europe/Istanbul).';
--> statement-breakpoint
COMMENT ON COLUMN "lost_item_reports"."status" IS 'Durum: open aranıyor, matched bulunan eşyayla eşlendi, returned eşya teslim edildi, closed kapatıldı.';
--> statement-breakpoint
COMMENT ON COLUMN "lost_item_reports"."matched_item_id" IS 'Eşlenen bulunan eşya (lost_items FK, restrict); matched ve returned durumunda dolu. Bir eşya en çok bir matched bildirimde.';
--> statement-breakpoint
COMMENT ON COLUMN "lost_item_reports"."matched_at" IS 'Eşleme anı.';
--> statement-breakpoint
COMMENT ON COLUMN "lost_item_reports"."returned_at" IS 'Eşlenen eşyanın teslim anı.';
--> statement-breakpoint
COMMENT ON COLUMN "lost_item_reports"."closed_at" IS 'Kapatma anı (bildiren vazgeçti ya da ön büro bulunamadı dedi).';
--> statement-breakpoint
COMMENT ON COLUMN "lost_item_reports"."closed_by_user_id" IS 'Bildirimi kapatan kullanıcı.';
--> statement-breakpoint
COMMENT ON COLUMN "lost_item_reports"."reported_by_user_id" IS 'Bildirimi açan kullanıcı (veli ya da öğrenci).';
--> statement-breakpoint
COMMENT ON COLUMN "lost_item_reports"."reporter_role" IS 'Bildirenin rolü: veli ya da ogrenci.';
--> statement-breakpoint
COMMENT ON COLUMN "lost_item_reports"."created_at" IS 'Oluşturulma anı.';
--> statement-breakpoint
COMMENT ON COLUMN "lost_item_reports"."updated_at" IS 'Son güncelleme anı.';
--> statement-breakpoint
COMMENT ON COLUMN "lost_item_reports"."archived_at" IS 'Arşiv anı (kullanılmıyor).';
--> statement-breakpoint
COMMENT ON COLUMN "lost_item_reports"."version" IS 'İyimser kilit sürümü (If-Match).';
--> statement-breakpoint
COMMENT ON COLUMN "lost_item_settings"."institution_id" IS 'Kurum (kurum başına bir satır; satır yoksa varsayılan).';
--> statement-breakpoint
COMMENT ON COLUMN "lost_item_settings"."retention_days" IS 'Saklama süresi (gün, 7–365; varsayılan 30); bulunma gününden sayılır.';
--> statement-breakpoint
COMMENT ON COLUMN "lost_item_settings"."family_gallery_enabled" IS 'Veli ve öğrenci bekleyen eşyaların kategori, gün ve fotoğrafını görür mü (varsayılan açık; K-491).';
--> statement-breakpoint
COMMENT ON COLUMN "lost_item_settings"."created_at" IS 'Oluşturulma anı.';
--> statement-breakpoint
COMMENT ON COLUMN "lost_item_settings"."updated_at" IS 'Son güncelleme anı.';
--> statement-breakpoint
COMMENT ON COLUMN "lost_item_settings"."archived_at" IS 'Arşiv anı (kullanılmıyor).';
--> statement-breakpoint
COMMENT ON COLUMN "lost_item_settings"."version" IS 'Ayar sürümü (If-Match; hiç kaydedilmediyse 1).';
