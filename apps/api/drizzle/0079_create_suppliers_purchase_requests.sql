CREATE TABLE "purchase_request_items" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit" text NOT NULL,
	"estimated_unit_price_cents" bigint NOT NULL,
	"currency" text DEFAULT 'TRY' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "purchase_request_items_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "purchase_request_items_position_check" CHECK ("purchase_request_items"."position" >= 0),
	CONSTRAINT "purchase_request_items_name_check" CHECK (char_length("purchase_request_items"."name") between 2 and 200),
	CONSTRAINT "purchase_request_items_quantity_check" CHECK ("purchase_request_items"."quantity" between 1 and 1000000),
	CONSTRAINT "purchase_request_items_unit_check" CHECK ("purchase_request_items"."unit" in ('piece', 'pack', 'box', 'kilogram', 'liter', 'meter', 'hour', 'day', 'month', 'service')),
	CONSTRAINT "purchase_request_items_price_check" CHECK ("purchase_request_items"."estimated_unit_price_cents" between 1 and 100000000000),
	CONSTRAINT "purchase_request_items_currency_check" CHECK ("purchase_request_items"."currency" = 'TRY')
);
--> statement-breakpoint
CREATE TABLE "purchase_requests" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"cost_center_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"budget_item_id" uuid NOT NULL,
	"supplier_id" uuid,
	"justification" text NOT NULL,
	"requested_by_user_id" text NOT NULL,
	"submitted_at" timestamp with time zone,
	"submitted_by_user_id" text,
	"decided_at" timestamp with time zone,
	"decided_by_user_id" text,
	"decision_note" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_user_id" text,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "purchase_requests_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "purchase_requests_sequence_check" CHECK ("purchase_requests"."sequence" >= 1),
	CONSTRAINT "purchase_requests_status_check" CHECK ("purchase_requests"."status" in ('draft', 'submitted', 'approved', 'rejected', 'cancelled')),
	CONSTRAINT "purchase_requests_justification_check" CHECK (char_length("purchase_requests"."justification") between 10 and 2000),
	CONSTRAINT "purchase_requests_reason_check" CHECK (("purchase_requests"."decision_note" is null or char_length("purchase_requests"."decision_note") <= 500)
        and ("purchase_requests"."cancel_reason" is null or char_length("purchase_requests"."cancel_reason") <= 500)),
	CONSTRAINT "purchase_requests_lifecycle_check" CHECK (("purchase_requests"."status" = 'draft' and "purchase_requests"."submitted_at" is null and "purchase_requests"."decided_at" is null and "purchase_requests"."cancelled_at" is null)
        or ("purchase_requests"."status" = 'submitted' and "purchase_requests"."submitted_at" is not null and "purchase_requests"."decided_at" is null and "purchase_requests"."cancelled_at" is null)
        or ("purchase_requests"."status" = 'approved' and "purchase_requests"."submitted_at" is not null and "purchase_requests"."decided_at" is not null and "purchase_requests"."decided_by_user_id" is not null and "purchase_requests"."cancelled_at" is null)
        or ("purchase_requests"."status" = 'rejected' and "purchase_requests"."submitted_at" is not null and "purchase_requests"."decided_at" is not null and "purchase_requests"."decided_by_user_id" is not null and "purchase_requests"."decision_note" is not null and "purchase_requests"."cancelled_at" is null)
        or ("purchase_requests"."status" = 'cancelled' and "purchase_requests"."decided_at" is null and "purchase_requests"."cancelled_at" is not null and "purchase_requests"."cancelled_by_user_id" is not null and "purchase_requests"."cancel_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"tax_number" text NOT NULL,
	"tax_office" text NOT NULL,
	"categories" text[] NOT NULL,
	"contact_name" text,
	"contact_phone" text,
	"contact_email" text,
	"address" text,
	"iban" text,
	"documents" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "suppliers_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "suppliers_name_check" CHECK (char_length("suppliers"."name") between 2 and 200),
	CONSTRAINT "suppliers_type_check" CHECK ("suppliers"."type" in ('company', 'individual')),
	CONSTRAINT "suppliers_tax_number_check" CHECK (("suppliers"."type" = 'company' and "suppliers"."tax_number" ~ '^[0-9]{10}$')
        or ("suppliers"."type" = 'individual' and "suppliers"."tax_number" ~ '^[1-9][0-9]{10}$')),
	CONSTRAINT "suppliers_tax_office_check" CHECK (char_length("suppliers"."tax_office") between 2 and 100),
	CONSTRAINT "suppliers_categories_check" CHECK (cardinality("suppliers"."categories") >= 1 and "suppliers"."categories" <@ array['stationery', 'cleaning', 'food', 'it', 'maintenance', 'furniture', 'educational', 'services', 'transport', 'other']::text[]),
	CONSTRAINT "suppliers_address_check" CHECK ("suppliers"."address" is null or char_length("suppliers"."address") <= 500),
	CONSTRAINT "suppliers_iban_check" CHECK ("suppliers"."iban" is null or "suppliers"."iban" ~ '^TR[0-9]{24}$'),
	CONSTRAINT "suppliers_documents_check" CHECK (jsonb_typeof("suppliers"."documents") = 'array' and jsonb_array_length("suppliers"."documents") <= 20)
);
--> statement-breakpoint
ALTER TABLE "purchase_request_items" ADD CONSTRAINT "purchase_request_items_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_request_items" ADD CONSTRAINT "purchase_request_items_request_fkey" FOREIGN KEY ("institution_id","request_id") REFERENCES "public"."purchase_requests"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_cost_center_fkey" FOREIGN KEY ("institution_id","cost_center_id") REFERENCES "public"."cost_centers"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_period_fkey" FOREIGN KEY ("institution_id","period_id") REFERENCES "public"."budget_periods"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_budget_item_fkey" FOREIGN KEY ("institution_id","budget_item_id") REFERENCES "public"."budget_items"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_supplier_fkey" FOREIGN KEY ("institution_id","supplier_id") REFERENCES "public"."suppliers"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_request_items_position_key" ON "purchase_request_items" USING btree ("institution_id","request_id","position") WHERE "purchase_request_items"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "purchase_request_items_request_idx" ON "purchase_request_items" USING btree ("institution_id","request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_requests_sequence_key" ON "purchase_requests" USING btree ("institution_id","sequence");--> statement-breakpoint
CREATE INDEX "purchase_requests_status_idx" ON "purchase_requests" USING btree ("institution_id","status");--> statement-breakpoint
CREATE INDEX "purchase_requests_cost_center_idx" ON "purchase_requests" USING btree ("institution_id","cost_center_id");--> statement-breakpoint
CREATE INDEX "purchase_requests_period_idx" ON "purchase_requests" USING btree ("institution_id","period_id","budget_item_id");--> statement-breakpoint
CREATE INDEX "purchase_requests_budget_item_idx" ON "purchase_requests" USING btree ("institution_id","budget_item_id");--> statement-breakpoint
CREATE INDEX "purchase_requests_supplier_idx" ON "purchase_requests" USING btree ("institution_id","supplier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_tax_number_key" ON "suppliers" USING btree ("institution_id","tax_number") WHERE "suppliers"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "suppliers_active_name_idx" ON "suppliers" USING btree ("institution_id","is_active","name");--> statement-breakpoint
COMMENT ON TABLE "suppliers" IS 'Tedarikçi (DOM-FIN-070, ON-221): şirket (VKN) ya da şahıs (TCKN). Vergi numarası kurumda tekil; silinmez, is_active ile pasifleşir. Şahıs tedarikçinin TCKN, iletişim, adres ve IBAN alanları kişisel veridir (listede maskeli, loglanmaz; H-28).';--> statement-breakpoint
COMMENT ON COLUMN "suppliers"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "suppliers"."id" IS 'Tedarikçi kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "suppliers"."name" IS 'Unvan ya da ad soyad, 2–200 karakter.';--> statement-breakpoint
COMMENT ON COLUMN "suppliers"."type" IS 'Tür: company (şirket, tüzel kişi) ya da individual (şahıs, gerçek kişi).';--> statement-breakpoint
COMMENT ON COLUMN "suppliers"."tax_number" IS 'Vergi numarası: şirkette 10 haneli VKN, şahısta 11 haneli TCKN (kişisel veri); kontrol haneleri coreda denetlenir. Kurumda tekil (pasif dahil).';--> statement-breakpoint
COMMENT ON COLUMN "suppliers"."tax_office" IS 'Vergi dairesi, 2–100 karakter.';--> statement-breakpoint
COMMENT ON COLUMN "suppliers"."categories" IS 'Satın alma kategorileri (sabit küme, K-125); en az bir.';--> statement-breakpoint
COMMENT ON COLUMN "suppliers"."contact_name" IS 'Yetkili kişinin adı (kişisel veri); isteğe bağlı.';--> statement-breakpoint
COMMENT ON COLUMN "suppliers"."contact_phone" IS 'Yetkili telefonu 0XXXXXXXXXX (kişisel veri); isteğe bağlı.';--> statement-breakpoint
COMMENT ON COLUMN "suppliers"."contact_email" IS 'Yetkili e-postası (kişisel veri); isteğe bağlı.';--> statement-breakpoint
COMMENT ON COLUMN "suppliers"."address" IS 'Adres, en çok 500 karakter; şahıs tedarikçide kişisel veri.';--> statement-breakpoint
COMMENT ON COLUMN "suppliers"."iban" IS 'Ödeme IBANı, TR ve 24 rakam, mod-97 coreda denetlenir; listede maskeli.';--> statement-breakpoint
COMMENT ON COLUMN "suppliers"."documents" IS 'Belge listesi (K-127): {name, expiryDate, note} dizisi, en çok 20; dosya içermez.';--> statement-breakpoint
COMMENT ON COLUMN "suppliers"."is_active" IS 'Etkin mi; pasif tedarikçi satın alma talebinde önerilemez.';--> statement-breakpoint
COMMENT ON COLUMN "suppliers"."created_at" IS 'Kayıt anı.';--> statement-breakpoint
COMMENT ON COLUMN "suppliers"."updated_at" IS 'Son değişiklik anı.';--> statement-breakpoint
COMMENT ON COLUMN "suppliers"."archived_at" IS 'Arşiv anı; bugün kullanılmaz, tedarikçi silinmez pasifleşir.';--> statement-breakpoint
COMMENT ON COLUMN "suppliers"."version" IS 'İyimser kilit sürümü (If-Match).';--> statement-breakpoint
COMMENT ON TABLE "purchase_requests" IS 'Satın alma talebi (DOM-FIN-071, ON-222): talep eden maliyet merkezi, bütçe dönemi ve gider kalemi. Durum taslak → gönderildi → onaylandı/reddedildi; taslak ve gönderilmiş talep iptal edilir. Tutar kalemlerden hesaplanır, saklanmaz.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_requests"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_requests"."id" IS 'Talep kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_requests"."sequence" IS 'Kurum içi sıra numarası (ST-0001 olarak gösterilir); kurum kilidi altında verilir, tekil.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_requests"."status" IS 'Durum: draft, submitted, approved, rejected, cancelled. Yalnız taslak düzeltilir.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_requests"."cost_center_id" IS 'Talep eden birim (cost_centers); etkin olmalıdır.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_requests"."period_id" IS 'Bütçe dönemi (budget_periods); gönderim ve onay açık dönem ister.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_requests"."budget_item_id" IS 'Gider kalemi (budget_items, tür expense); bütçe kalanı bu kalemin satırından hesaplanır (K-131).';--> statement-breakpoint
COMMENT ON COLUMN "purchase_requests"."supplier_id" IS 'İsteğe bağlı önerilen tedarikçi (suppliers); etkin olmalıdır.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_requests"."justification" IS 'Gerekçe, 10–2000 karakter serbest metin; loglanmaz.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_requests"."requested_by_user_id" IS 'Talebi açan kullanıcı; ön büro yalnız kendi talebini değiştirir (K-128).';--> statement-breakpoint
COMMENT ON COLUMN "purchase_requests"."submitted_at" IS 'Gönderim anı.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_requests"."submitted_by_user_id" IS 'Gönderen kullanıcı.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_requests"."decided_at" IS 'Onay ya da ret anı.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_requests"."decided_by_user_id" IS 'Karar veren yönetici (K-129).';--> statement-breakpoint
COMMENT ON COLUMN "purchase_requests"."decision_note" IS 'Onay notu (isteğe bağlı) ya da ret gerekçesi (zorunlu), en çok 500 karakter.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_requests"."cancelled_at" IS 'İptal anı.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_requests"."cancelled_by_user_id" IS 'İptal eden kullanıcı.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_requests"."cancel_reason" IS 'İptal gerekçesi, en çok 500 karakter.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_requests"."created_at" IS 'Kayıt anı.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_requests"."updated_at" IS 'Son değişiklik anı.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_requests"."archived_at" IS 'Arşiv anı; bugün kullanılmaz, talep silinmez iptal edilir.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_requests"."version" IS 'İyimser kilit sürümü (If-Match).';--> statement-breakpoint
COMMENT ON TABLE "purchase_request_items" IS 'Satın alma talebi kalemi (DOM-FIN-071): ad, tam sayı miktar, birim, tahmini birim fiyat. Taslak düzeltilince eski kalemler arşivlenir; etkin kalemler position ile sıralanır.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_request_items"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_request_items"."id" IS 'Kalem kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_request_items"."request_id" IS 'Talep (purchase_requests).';--> statement-breakpoint
COMMENT ON COLUMN "purchase_request_items"."position" IS 'Talep içindeki sıra (0dan); etkin kalemlerde tekil.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_request_items"."name" IS 'Kalem adı, 2–200 karakter.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_request_items"."quantity" IS 'Miktar, 1–1.000.000 tam sayı (K-130).';--> statement-breakpoint
COMMENT ON COLUMN "purchase_request_items"."unit" IS 'Birim: piece, pack, box, kilogram, liter, meter, hour, day, month, service.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_request_items"."estimated_unit_price_cents" IS 'Tahmini birim fiyat, kuruş, KDV dahil (K-130); 1 kuruş ile 1 milyar TL arası.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_request_items"."currency" IS 'Para birimi; yalnız TRY (DOM-FIN-001).';--> statement-breakpoint
COMMENT ON COLUMN "purchase_request_items"."created_at" IS 'Kayıt anı.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_request_items"."updated_at" IS 'Son değişiklik anı.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_request_items"."archived_at" IS 'Kalemin taslak düzeltmesiyle yerini yeni kaleme bıraktığı an.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_request_items"."version" IS 'İyimser kilit sürümü (If-Match).';
