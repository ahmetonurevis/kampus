CREATE TABLE "material_deliveries" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"set_id" uuid NOT NULL,
	"student_id" text NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"delivery_date" date NOT NULL,
	"recipient_kind" text NOT NULL,
	"guardian_id" uuid,
	"recipient_name" text,
	"signature_received" boolean NOT NULL,
	"signature_recorded_at" timestamp with time zone,
	"signature_recorded_by_user_id" text,
	"note" text,
	"created_by_user_id" text NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_user_id" text,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "material_deliveries_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "material_deliveries_recipient_kind_check" CHECK ("material_deliveries"."recipient_kind" in ('student', 'guardian', 'other')),
	CONSTRAINT "material_deliveries_recipient_check" CHECK (("material_deliveries"."recipient_kind" = 'student' and "material_deliveries"."guardian_id" is null and "material_deliveries"."recipient_name" is null)
        or ("material_deliveries"."recipient_kind" = 'guardian' and "material_deliveries"."guardian_id" is not null and "material_deliveries"."recipient_name" is not null)
        or ("material_deliveries"."recipient_kind" = 'other' and "material_deliveries"."guardian_id" is null and "material_deliveries"."recipient_name" is not null)),
	CONSTRAINT "material_deliveries_text_check" CHECK (("material_deliveries"."recipient_name" is null or char_length("material_deliveries"."recipient_name") between 1 and 120)
        and ("material_deliveries"."note" is null or char_length("material_deliveries"."note") <= 500)
        and ("material_deliveries"."cancel_reason" is null or char_length("material_deliveries"."cancel_reason") <= 500)),
	CONSTRAINT "material_deliveries_signature_check" CHECK (("material_deliveries"."signature_received" = ("material_deliveries"."signature_recorded_at" is not null))
        and (("material_deliveries"."signature_recorded_at" is null) = ("material_deliveries"."signature_recorded_by_user_id" is null))),
	CONSTRAINT "material_deliveries_cancel_check" CHECK ((("material_deliveries"."cancelled_at" is null) = ("material_deliveries"."cancelled_by_user_id" is null))
        and (("material_deliveries"."cancelled_at" is null) = ("material_deliveries"."cancel_reason" is null)))
);
--> statement-breakpoint
CREATE TABLE "material_delivery_items" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"delivery_id" uuid NOT NULL,
	"stock_item_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"stock_movement_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "material_delivery_items_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "material_delivery_items_quantity_check" CHECK ("material_delivery_items"."quantity" between 1 and 100 and "material_delivery_items"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "material_set_items" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"set_id" uuid NOT NULL,
	"stock_item_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "material_set_items_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "material_set_items_quantity_check" CHECK ("material_set_items"."quantity" between 1 and 100 and "material_set_items"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "material_sets" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"name" text NOT NULL,
	"academic_year" integer NOT NULL,
	"grade_level" integer,
	"course_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "material_sets_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "material_sets_text_check" CHECK (char_length("material_sets"."name") between 2 and 120),
	CONSTRAINT "material_sets_year_check" CHECK ("material_sets"."academic_year" between 2000 and 2100),
	CONSTRAINT "material_sets_target_check" CHECK (("material_sets"."grade_level" is null or "material_sets"."grade_level" between 5 and 12)
        and ("material_sets"."grade_level" is null or "material_sets"."course_id" is null))
);
--> statement-breakpoint
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_type_check";--> statement-breakpoint
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_source_check";--> statement-breakpoint
ALTER TABLE "material_deliveries" ADD CONSTRAINT "material_deliveries_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_deliveries" ADD CONSTRAINT "material_deliveries_set_fkey" FOREIGN KEY ("institution_id","set_id") REFERENCES "public"."material_sets"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_deliveries" ADD CONSTRAINT "material_deliveries_warehouse_fkey" FOREIGN KEY ("institution_id","warehouse_id") REFERENCES "public"."stock_warehouses"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_deliveries" ADD CONSTRAINT "material_deliveries_guardian_fkey" FOREIGN KEY ("institution_id","guardian_id") REFERENCES "public"."student_guardians"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_delivery_items" ADD CONSTRAINT "material_delivery_items_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_delivery_items" ADD CONSTRAINT "material_delivery_items_delivery_fkey" FOREIGN KEY ("institution_id","delivery_id") REFERENCES "public"."material_deliveries"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_delivery_items" ADD CONSTRAINT "material_delivery_items_stock_item_fkey" FOREIGN KEY ("institution_id","stock_item_id") REFERENCES "public"."stock_items"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_delivery_items" ADD CONSTRAINT "material_delivery_items_movement_fkey" FOREIGN KEY ("institution_id","stock_movement_id") REFERENCES "public"."stock_movements"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_set_items" ADD CONSTRAINT "material_set_items_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_set_items" ADD CONSTRAINT "material_set_items_set_fkey" FOREIGN KEY ("institution_id","set_id") REFERENCES "public"."material_sets"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_set_items" ADD CONSTRAINT "material_set_items_stock_item_fkey" FOREIGN KEY ("institution_id","stock_item_id") REFERENCES "public"."stock_items"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_sets" ADD CONSTRAINT "material_sets_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_sets" ADD CONSTRAINT "material_sets_course_fkey" FOREIGN KEY ("institution_id","course_id") REFERENCES "public"."courses"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "material_deliveries_set_student_key" ON "material_deliveries" USING btree ("institution_id","set_id","student_id") WHERE "material_deliveries"."cancelled_at" is null and "material_deliveries"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "material_deliveries_set_idx" ON "material_deliveries" USING btree ("institution_id","set_id");--> statement-breakpoint
CREATE INDEX "material_deliveries_student_idx" ON "material_deliveries" USING btree ("institution_id","student_id");--> statement-breakpoint
CREATE INDEX "material_deliveries_warehouse_idx" ON "material_deliveries" USING btree ("institution_id","warehouse_id");--> statement-breakpoint
CREATE INDEX "material_deliveries_guardian_idx" ON "material_deliveries" USING btree ("institution_id","guardian_id") WHERE "material_deliveries"."guardian_id" is not null;--> statement-breakpoint
CREATE INDEX "material_delivery_items_delivery_idx" ON "material_delivery_items" USING btree ("institution_id","delivery_id");--> statement-breakpoint
CREATE INDEX "material_delivery_items_stock_item_idx" ON "material_delivery_items" USING btree ("institution_id","stock_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "material_delivery_items_movement_key" ON "material_delivery_items" USING btree ("institution_id","stock_movement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "material_set_items_set_stock_item_key" ON "material_set_items" USING btree ("institution_id","set_id","stock_item_id") WHERE "material_set_items"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "material_set_items_set_idx" ON "material_set_items" USING btree ("institution_id","set_id");--> statement-breakpoint
CREATE INDEX "material_set_items_stock_item_idx" ON "material_set_items" USING btree ("institution_id","stock_item_id");--> statement-breakpoint
CREATE INDEX "material_sets_year_idx" ON "material_sets" USING btree ("institution_id","academic_year");--> statement-breakpoint
CREATE INDEX "material_sets_course_idx" ON "material_sets" USING btree ("institution_id","course_id") WHERE "material_sets"."course_id" is not null;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_type_check" CHECK ("stock_movements"."type" in ('in', 'out', 'transfer_in', 'transfer_out', 'receipt', 'delivery'));--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_source_check" CHECK (("stock_movements"."type" = 'in' and "stock_movements"."reason" is not null and "stock_movements"."reason" in ('opening', 'donation', 'count_surplus', 'returned', 'other') and "stock_movements"."transfer_id" is null and "stock_movements"."receipt_id" is null and "stock_movements"."receipt_item_id" is null)
        or ("stock_movements"."type" = 'out' and "stock_movements"."reason" is not null and "stock_movements"."reason" in ('usage', 'damage', 'loss', 'count_shortage', 'other') and "stock_movements"."transfer_id" is null and "stock_movements"."receipt_id" is null and "stock_movements"."receipt_item_id" is null)
        or ("stock_movements"."type" in ('transfer_in', 'transfer_out') and "stock_movements"."reason" is null and "stock_movements"."transfer_id" is not null and "stock_movements"."receipt_id" is null and "stock_movements"."receipt_item_id" is null)
        or ("stock_movements"."type" = 'receipt' and "stock_movements"."reason" is null and "stock_movements"."transfer_id" is null and "stock_movements"."receipt_id" is not null and "stock_movements"."receipt_item_id" is not null)
        or ("stock_movements"."type" = 'delivery' and "stock_movements"."reason" is null and "stock_movements"."transfer_id" is null and "stock_movements"."receipt_id" is null and "stock_movements"."receipt_item_id" is null));--> statement-breakpoint
COMMENT ON TABLE "material_sets" IS 'Kitap ve materyal seti (DOM-FIN-080, ON-232): bir eğitim yılında öğrencilere dağıtılan stok kartları ve adetleri. Hedef okulda sınıf düzeyi, dil okulunda kurdur; hedefsiz set kurumun bütün etkin öğrencilerine dağıtılır. Ad yıl içinde tekildir (core, Türkçe harf duyarsız). Set silinmez, is_active ile pasifleşir (K-208).';--> statement-breakpoint
COMMENT ON COLUMN "material_sets"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "material_sets"."id" IS 'Set kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "material_sets"."name" IS 'Set adı, 2–120 karakter; aynı eğitim yılında tekil.';--> statement-breakpoint
COMMENT ON COLUMN "material_sets"."academic_year" IS 'Eğitim yılının başladığı yıl (2026 → 2026–2027). Kitap ve kırtasiye ücret kalemi (invoices.fee_kind = stationery) bu yılda aranır (K-207). Teslimi başlamış setin yılı değişmez.';--> statement-breakpoint
COMMENT ON COLUMN "material_sets"."grade_level" IS 'Okulda hedef sınıf düzeyi (5–12); boşsa sınıf düzeyi hedefi yok. course_id ile birlikte dolmaz. Teslimi başlamış setin hedefi değişmez.';--> statement-breakpoint
COMMENT ON COLUMN "material_sets"."course_id" IS 'Dil okulunda hedef kur (courses); kurdaki iptal edilmemiş grupların etkin kursiyerleri hedeftir. grade_level ile birlikte dolmaz.';--> statement-breakpoint
COMMENT ON COLUMN "material_sets"."is_active" IS 'Etkin mi; pasif sete teslim yazılmaz.';--> statement-breakpoint
COMMENT ON COLUMN "material_sets"."created_at" IS 'Oluşturma zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "material_sets"."updated_at" IS 'Son değişiklik zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "material_sets"."archived_at" IS 'Arşiv zamanı; bugün set arşivlenmez, pasifleşir.';--> statement-breakpoint
COMMENT ON COLUMN "material_sets"."version" IS 'İyimser kilit sürümü (If-Match; set düzeltmesi).';--> statement-breakpoint
COMMENT ON TABLE "material_set_items" IS 'Materyal setinin kalemi (DOM-FIN-080): stok kartı ve öğrenci başına adet. Kalemler düzeltilince eski satırlar arşivlenir, yenileri yazılır; önceki teslimler kendi kalemlerini material_delivery_items içinde korur (K-208).';--> statement-breakpoint
COMMENT ON COLUMN "material_set_items"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "material_set_items"."id" IS 'Kalem kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "material_set_items"."set_id" IS 'Set (material_sets).';--> statement-breakpoint
COMMENT ON COLUMN "material_set_items"."stock_item_id" IS 'Stok kartı (stock_items); sette arşivlenmemiş kalemler arasında bir kez yer alır.';--> statement-breakpoint
COMMENT ON COLUMN "material_set_items"."quantity" IS 'Öğrenci başına adet, kartın biriminde, 1–100.';--> statement-breakpoint
COMMENT ON COLUMN "material_set_items"."position" IS 'Kalemin setteki sırası (0''dan); liste ve teslim bu sırayla.';--> statement-breakpoint
COMMENT ON COLUMN "material_set_items"."created_at" IS 'Oluşturma zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "material_set_items"."updated_at" IS 'Son değişiklik zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "material_set_items"."archived_at" IS 'Kalem setten çıkarıldığında (set kalemleri yeniden yazıldığında) dolar.';--> statement-breakpoint
COMMENT ON COLUMN "material_set_items"."version" IS 'Satır sürümü; kalem düzeltilmez, yeniden yazılır.';--> statement-breakpoint
COMMENT ON TABLE "material_deliveries" IS 'Materyal seti teslimi (DOM-FIN-080): öğrenciye setin teslimi, teslim alan, teslim günü ve kâğıt imza işareti (dijital imza yok). Teslim seçilen depodan kalemler kadar delivery stok çıkışı yazar; stok yetmezse yazılmaz (K-181). Aynı öğrenciye aynı setin iptal edilmemiş tek teslimi olur (material_deliveries_set_student_key). Silinmez; yönetici gerekçeyle iptal eder, stok çıkışları da iptal edilir (K-209). Ödenmemiş materyal ücreti teslimi engellemez (K-207).';--> statement-breakpoint
COMMENT ON COLUMN "material_deliveries"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "material_deliveries"."id" IS 'Teslim kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "material_deliveries"."set_id" IS 'Teslim edilen set (material_sets).';--> statement-breakpoint
COMMENT ON COLUMN "material_deliveries"."student_id" IS 'Öğrenci: records tablosunda students koleksiyonundaki kaydın kimliği (yabancı anahtar değil). Kişisel veri; adı yalnız yönetici ve ön büroya gösterilir.';--> statement-breakpoint
COMMENT ON COLUMN "material_deliveries"."warehouse_id" IS 'Çıkışın yazıldığı depo (stock_warehouses).';--> statement-breakpoint
COMMENT ON COLUMN "material_deliveries"."delivery_date" IS 'Teslim günü (Europe/Istanbul); bugünden sonra olamaz. Stok çıkışlarının hareket günüdür.';--> statement-breakpoint
COMMENT ON COLUMN "material_deliveries"."recipient_kind" IS 'Teslim alan: student (öğrencinin kendisi), guardian (kayıtlı veli), other (adı yazılan kişi) (K-206).';--> statement-breakpoint
COMMENT ON COLUMN "material_deliveries"."guardian_id" IS 'Kayıtlı veli bağı (student_guardians); yalnız guardian türünde dolu. İletişim kısıtlı veli seçilemez (core).';--> statement-breakpoint
COMMENT ON COLUMN "material_deliveries"."recipient_name" IS 'Teslim alanın adı: kayıtlı velide teslim anındaki veli adı, başka kişide yazılan ad (1–120 karakter); öğrencide boş. Kişisel veri; loglanmaz, denetime yalnız alan adı yazılır.';--> statement-breakpoint
COMMENT ON COLUMN "material_deliveries"."signature_received" IS 'Kâğıt teslim imzası alındı mı. Sonradan işaretlenebilir, geri alınmaz (K-206).';--> statement-breakpoint
COMMENT ON COLUMN "material_deliveries"."signature_recorded_at" IS 'İmzanın alındığının işlendiği zaman; signature_received doğruysa dolu.';--> statement-breakpoint
COMMENT ON COLUMN "material_deliveries"."signature_recorded_by_user_id" IS 'İmzayı işleyen kullanıcı (yönetici ya da ön büro).';--> statement-breakpoint
COMMENT ON COLUMN "material_deliveries"."note" IS 'İsteğe bağlı açıklama, en çok 500 karakter.';--> statement-breakpoint
COMMENT ON COLUMN "material_deliveries"."created_by_user_id" IS 'Teslimi kaydeden kullanıcı (yönetici ya da ön büro, K-205).';--> statement-breakpoint
COMMENT ON COLUMN "material_deliveries"."cancelled_at" IS 'İptal zamanı; iptal edilen teslim listede teslim edilmemiş sayılır, öğrenciye set yeniden teslim edilebilir.';--> statement-breakpoint
COMMENT ON COLUMN "material_deliveries"."cancelled_by_user_id" IS 'Teslimi iptal eden yönetici.';--> statement-breakpoint
COMMENT ON COLUMN "material_deliveries"."cancel_reason" IS 'İptal gerekçesi, 5–500 karakter; stok çıkışlarının iptal gerekçesi de budur.';--> statement-breakpoint
COMMENT ON COLUMN "material_deliveries"."created_at" IS 'Oluşturma zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "material_deliveries"."updated_at" IS 'Son değişiklik zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "material_deliveries"."archived_at" IS 'Arşiv zamanı; bugün teslim arşivlenmez, iptal edilir.';--> statement-breakpoint
COMMENT ON COLUMN "material_deliveries"."version" IS 'İyimser kilit sürümü (If-Match; iptal ve imza işareti).';--> statement-breakpoint
COMMENT ON TABLE "material_delivery_items" IS 'Teslimin kalemi (DOM-FIN-080): teslim anındaki stok kartı, adet ve yazdığı stok çıkışı. Set kalemleri sonradan değişse de teslimin içeriği burada kalır (K-208).';--> statement-breakpoint
COMMENT ON COLUMN "material_delivery_items"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "material_delivery_items"."id" IS 'Teslim kalemi kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "material_delivery_items"."delivery_id" IS 'Teslim (material_deliveries).';--> statement-breakpoint
COMMENT ON COLUMN "material_delivery_items"."stock_item_id" IS 'Teslim edilen stok kartı (stock_items).';--> statement-breakpoint
COMMENT ON COLUMN "material_delivery_items"."quantity" IS 'Teslim edilen adet (setin o andaki adedi), 1–100.';--> statement-breakpoint
COMMENT ON COLUMN "material_delivery_items"."stock_movement_id" IS 'Bu kalemin delivery türündeki stok çıkışı (stock_movements); kalem başına bir hareket. Hareket yalnız teslim iptaliyle iptal edilir.';--> statement-breakpoint
COMMENT ON COLUMN "material_delivery_items"."position" IS 'Kalemin teslimdeki sırası (setteki sıra, 0''dan); yanıt bu sırayla.';--> statement-breakpoint
COMMENT ON COLUMN "material_delivery_items"."created_at" IS 'Oluşturma zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "material_delivery_items"."updated_at" IS 'Son değişiklik zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "material_delivery_items"."archived_at" IS 'Arşiv zamanı; teslim kalemi değişmez.';--> statement-breakpoint
COMMENT ON COLUMN "material_delivery_items"."version" IS 'Satır sürümü; teslim kalemi değişmez.';--> statement-breakpoint
COMMENT ON COLUMN "stock_movements"."type" IS 'Tür: in (elle giriş), out (çıkış), transfer_in ve transfer_out (depolar arası transferin iki bacağı), receipt (mal kabul girişi), delivery (materyal seti teslimi çıkışı, DOM-FIN-080; kaynağı material_delivery_items). in, transfer_in ve receipt miktarı artırır.';
