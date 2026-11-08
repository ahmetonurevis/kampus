CREATE TABLE "corporate_customer_employees" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"student_id" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"notice_confirmed_at" timestamp with time zone NOT NULL,
	"notice_confirmed_by_user_id" text NOT NULL,
	"ended_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "corporate_customer_employees_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "corporate_customer_employees_period_check" CHECK ("corporate_customer_employees"."ends_on" is null or "corporate_customer_employees"."ends_on" >= "corporate_customer_employees"."starts_on"),
	CONSTRAINT "corporate_customer_employees_ended_check" CHECK (("corporate_customer_employees"."ends_on" is null) = ("corporate_customer_employees"."ended_by_user_id" is null))
);
--> statement-breakpoint
CREATE TABLE "corporate_customers" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"name" text NOT NULL,
	"tax_number" text NOT NULL,
	"tax_office" text NOT NULL,
	"billing_address" text NOT NULL,
	"contact_name" text,
	"contact_email" text,
	"contact_phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "corporate_customers_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "corporate_customers_tax_number_check" CHECK ("corporate_customers"."tax_number" ~ '^[0-9]{10,11}$')
);
--> statement-breakpoint
CREATE TABLE "corporate_invoice_lines" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"corporate_invoice_id" uuid NOT NULL,
	"invoice_id" text NOT NULL,
	"student_id" text NOT NULL,
	"root_contract_id" text,
	"installment" integer NOT NULL,
	"fee_kind" text,
	"due_date" date NOT NULL,
	"amount_cents" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "corporate_invoice_lines_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "corporate_invoice_lines_amount_check" CHECK ("corporate_invoice_lines"."amount_cents" > 0),
	CONSTRAINT "corporate_invoice_lines_installment_check" CHECK ("corporate_invoice_lines"."installment" > 0),
	CONSTRAINT "corporate_invoice_lines_fee_kind_check" CHECK ("corporate_invoice_lines"."fee_kind" in ('tuition', 'breakfast', 'meal', 'transport', 'dormitory', 'stationery', 'uniform', 'tutoring'))
);
--> statement-breakpoint
CREATE TABLE "corporate_invoices" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"number" text NOT NULL,
	"number_year" integer NOT NULL,
	"number_sequence" integer NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"customer_name" text NOT NULL,
	"tax_number" text NOT NULL,
	"tax_office" text NOT NULL,
	"billing_address" text NOT NULL,
	"total_cents" bigint NOT NULL,
	"line_count" integer NOT NULL,
	"currency" text DEFAULT 'TRY' NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"issued_by_user_id" text NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_user_id" text,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "corporate_invoices_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "corporate_invoices_total_check" CHECK ("corporate_invoices"."total_cents" > 0),
	CONSTRAINT "corporate_invoices_line_count_check" CHECK ("corporate_invoices"."line_count" > 0),
	CONSTRAINT "corporate_invoices_currency_check" CHECK ("corporate_invoices"."currency" = 'TRY'),
	CONSTRAINT "corporate_invoices_period_check" CHECK ("corporate_invoices"."period_to" >= "corporate_invoices"."period_from"),
	CONSTRAINT "corporate_invoices_sequence_check" CHECK ("corporate_invoices"."number_sequence" > 0),
	CONSTRAINT "corporate_invoices_cancel_check" CHECK ((("corporate_invoices"."cancelled_at" is null) = ("corporate_invoices"."cancelled_by_user_id" is null)) and (("corporate_invoices"."cancelled_at" is null) = ("corporate_invoices"."cancel_reason" is null)))
);
--> statement-breakpoint
ALTER TABLE "corporate_customer_employees" ADD CONSTRAINT "corporate_customer_employees_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_customer_employees" ADD CONSTRAINT "corporate_customer_employees_customer_fkey" FOREIGN KEY ("institution_id","customer_id") REFERENCES "public"."corporate_customers"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_customers" ADD CONSTRAINT "corporate_customers_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_invoice_lines" ADD CONSTRAINT "corporate_invoice_lines_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_invoice_lines" ADD CONSTRAINT "corporate_invoice_lines_invoice_fkey" FOREIGN KEY ("institution_id","corporate_invoice_id") REFERENCES "public"."corporate_invoices"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_invoices" ADD CONSTRAINT "corporate_invoices_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_invoices" ADD CONSTRAINT "corporate_invoices_customer_fkey" FOREIGN KEY ("institution_id","customer_id") REFERENCES "public"."corporate_customers"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "corporate_customer_employees_active_key" ON "corporate_customer_employees" USING btree ("institution_id","student_id") WHERE "corporate_customer_employees"."ends_on" is null and "corporate_customer_employees"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "corporate_customer_employees_customer_idx" ON "corporate_customer_employees" USING btree ("institution_id","customer_id");--> statement-breakpoint
CREATE INDEX "corporate_customer_employees_student_idx" ON "corporate_customer_employees" USING btree ("institution_id","student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "corporate_customers_tax_number_key" ON "corporate_customers" USING btree ("institution_id","tax_number") WHERE "corporate_customers"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "corporate_invoice_lines_invoice_key" ON "corporate_invoice_lines" USING btree ("institution_id","invoice_id") WHERE "corporate_invoice_lines"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "corporate_invoice_lines_chain_key" ON "corporate_invoice_lines" USING btree ("institution_id","root_contract_id","installment") WHERE "corporate_invoice_lines"."archived_at" is null and "corporate_invoice_lines"."root_contract_id" is not null;--> statement-breakpoint
CREATE INDEX "corporate_invoice_lines_corporate_invoice_idx" ON "corporate_invoice_lines" USING btree ("institution_id","corporate_invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "corporate_invoices_number_key" ON "corporate_invoices" USING btree ("institution_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "corporate_invoices_sequence_key" ON "corporate_invoices" USING btree ("institution_id","number_year","number_sequence");--> statement-breakpoint
CREATE INDEX "corporate_invoices_customer_idx" ON "corporate_invoices" USING btree ("institution_id","customer_id");--> statement-breakpoint
-- Elle eklendi (kolon açıklamaları; drizzle-kit üretmez, yeniden üretimde bu blok korunur).
COMMENT ON TABLE "corporate_customers" IS 'Kurumsal müşteri, şirket (DOM-FIN-060, IST-089). Yalnız dil okulunda. Kesilmiş toplu fatura şirket bilgisinin kopyasını taşır; bu satırın düzeltmesi geçmiş faturayı değiştirmez. Silme arşivdir.';--> statement-breakpoint
COMMENT ON COLUMN "corporate_customers"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "corporate_customers"."id" IS 'Şirket kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "corporate_customers"."name" IS 'Şirket unvanı; fatura başlığı.';--> statement-breakpoint
COMMENT ON COLUMN "corporate_customers"."tax_number" IS '10 haneli VKN ya da şahıs şirketinde 11 haneli TCKN (kişisel veri); kontrol hanesi core isValidTaxNumber ile denetlenir. Etkin müşteriler arasında tekil.';--> statement-breakpoint
COMMENT ON COLUMN "corporate_customers"."tax_office" IS 'Vergi dairesi.';--> statement-breakpoint
COMMENT ON COLUMN "corporate_customers"."billing_address" IS 'Fatura adresi.';--> statement-breakpoint
COMMENT ON COLUMN "corporate_customers"."contact_name" IS 'Şirketteki iletişim kişisi (kişisel veri); isteğe bağlı. Bu kişinin Kampüs girişi yoktur.';--> statement-breakpoint
COMMENT ON COLUMN "corporate_customers"."contact_email" IS 'İletişim e-postası (kişisel veri); isteğe bağlı, loglanmaz.';--> statement-breakpoint
COMMENT ON COLUMN "corporate_customers"."contact_phone" IS 'İletişim telefonu, 0 ile başlayan 11 hane (kişisel veri); isteğe bağlı, loglanmaz.';--> statement-breakpoint
COMMENT ON COLUMN "corporate_customers"."created_at" IS 'Kayıt anı.';--> statement-breakpoint
COMMENT ON COLUMN "corporate_customers"."updated_at" IS 'Son değişiklik anı.';--> statement-breakpoint
COMMENT ON COLUMN "corporate_customers"."archived_at" IS 'Arşiv anı; etkin çalışanı olan şirket arşivlenemez (corporate_customer_has_employees).';--> statement-breakpoint
COMMENT ON COLUMN "corporate_customers"."version" IS 'İyimser kilit sürümü (If-Match).';--> statement-breakpoint
COMMENT ON TABLE "corporate_customer_employees" IS 'Kursiyerin şirket bağı (DOM-FIN-060, DOM-DIL-093). Sözleşmenin ödeyicisini değiştirmez (K-45); toplu fatura bağın günleri içinde vadesi gelen taksitleri seçer. Kursiyerin tek etkin bağı olur; bitirilen bağ silinmez.';--> statement-breakpoint
COMMENT ON COLUMN "corporate_customer_employees"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "corporate_customer_employees"."id" IS 'Bağ kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "corporate_customer_employees"."customer_id" IS 'Bağlı şirket (corporate_customers).';--> statement-breakpoint
COMMENT ON COLUMN "corporate_customer_employees"."student_id" IS 'Kursiyer; records kimliği, yabancı anahtar değil.';--> statement-breakpoint
COMMENT ON COLUMN "corporate_customer_employees"."starts_on" IS 'Bağın ilk günü (dahil); yeni bağ önceki bağın bitişinden sonra başlar.';--> statement-breakpoint
COMMENT ON COLUMN "corporate_customer_employees"."ends_on" IS 'Bağın son günü (dahil); etkin bağda boş. Bağı biten kursiyer katılım özetine girmez (K-49).';--> statement-breakpoint
COMMENT ON COLUMN "corporate_customer_employees"."notice_confirmed_at" IS 'Kursiyere işveren raporu aydınlatmasının yapıldığının onaylandığı an (DOM-DIL-093, H-25).';--> statement-breakpoint
COMMENT ON COLUMN "corporate_customer_employees"."notice_confirmed_by_user_id" IS 'Aydınlatmayı onaylayıp bağı kuran görevli.';--> statement-breakpoint
COMMENT ON COLUMN "corporate_customer_employees"."ended_by_user_id" IS 'Bağı bitiren görevli; ends_on ile birlikte dolar.';--> statement-breakpoint
COMMENT ON COLUMN "corporate_customer_employees"."created_at" IS 'Kayıt anı.';--> statement-breakpoint
COMMENT ON COLUMN "corporate_customer_employees"."updated_at" IS 'Son değişiklik anı.';--> statement-breakpoint
COMMENT ON COLUMN "corporate_customer_employees"."archived_at" IS 'Arşiv anı; bugün kullanılmaz, bağ bitişle kapanır.';--> statement-breakpoint
COMMENT ON COLUMN "corporate_customer_employees"."version" IS 'İyimser kilit sürümü (If-Match).';--> statement-breakpoint
COMMENT ON TABLE "corporate_invoices" IS 'Şirkete toplu fatura (DOM-FIN-060). Kurum içi toplu dökümdür, vergi belgesi değildir (M-13 doğrulanmalı). Şirket bilgisi, toplam ve satır sayısı kesildiği anın kopyası.';--> statement-breakpoint
COMMENT ON COLUMN "corporate_invoices"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "corporate_invoices"."id" IS 'Toplu fatura kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "corporate_invoices"."customer_id" IS 'Faturalanan şirket (corporate_customers).';--> statement-breakpoint
COMMENT ON COLUMN "corporate_invoices"."number" IS 'Fatura numarası KF-<yıl>-<sıra> (K-53); kurumda tekil.';--> statement-breakpoint
COMMENT ON COLUMN "corporate_invoices"."number_year" IS 'Numaranın takvim yılı (Europe/Istanbul, kesim anı).';--> statement-breakpoint
COMMENT ON COLUMN "corporate_invoices"."number_sequence" IS 'Yıl içindeki ardışık sıra; iptal edilen numara boşta kalır, yeniden kullanılmaz.';--> statement-breakpoint
COMMENT ON COLUMN "corporate_invoices"."period_from" IS 'Dönem başlangıcı (dahil); taksit vade günüyle seçilir.';--> statement-breakpoint
COMMENT ON COLUMN "corporate_invoices"."period_to" IS 'Dönem bitişi (dahil); dönem en çok bir yıl.';--> statement-breakpoint
COMMENT ON COLUMN "corporate_invoices"."customer_name" IS 'Kesim anındaki şirket unvanı (kopya).';--> statement-breakpoint
COMMENT ON COLUMN "corporate_invoices"."tax_number" IS 'Kesim anındaki vergi numarası (kopya; şahıs şirketinde kişisel veri).';--> statement-breakpoint
COMMENT ON COLUMN "corporate_invoices"."tax_office" IS 'Kesim anındaki vergi dairesi (kopya).';--> statement-breakpoint
COMMENT ON COLUMN "corporate_invoices"."billing_address" IS 'Kesim anındaki fatura adresi (kopya).';--> statement-breakpoint
COMMENT ON COLUMN "corporate_invoices"."total_cents" IS 'Satır tutarları toplamı, kuruş; kesimde sabitlenir.';--> statement-breakpoint
COMMENT ON COLUMN "corporate_invoices"."line_count" IS 'Satır sayısı; kesimde sabitlenir.';--> statement-breakpoint
COMMENT ON COLUMN "corporate_invoices"."currency" IS 'Para birimi; yalnız TRY (DOM-FIN-001).';--> statement-breakpoint
COMMENT ON COLUMN "corporate_invoices"."issued_at" IS 'Kesim anı.';--> statement-breakpoint
COMMENT ON COLUMN "corporate_invoices"."issued_by_user_id" IS 'Faturayı kesen görevli (yönetici ya da ön büro).';--> statement-breakpoint
COMMENT ON COLUMN "corporate_invoices"."cancelled_at" IS 'İptal anı; iptal satırları arşivler, taksitler yeniden faturalanabilir.';--> statement-breakpoint
COMMENT ON COLUMN "corporate_invoices"."cancelled_by_user_id" IS 'İptal eden yönetici.';--> statement-breakpoint
COMMENT ON COLUMN "corporate_invoices"."cancel_reason" IS 'İptal gerekçesi, 5–500 karakter; loglanmaz.';--> statement-breakpoint
COMMENT ON COLUMN "corporate_invoices"."created_at" IS 'Kayıt anı.';--> statement-breakpoint
COMMENT ON COLUMN "corporate_invoices"."updated_at" IS 'Son değişiklik anı.';--> statement-breakpoint
COMMENT ON COLUMN "corporate_invoices"."archived_at" IS 'Arşiv anı; bugün kullanılmaz, iptal cancelled_at ile izlenir.';--> statement-breakpoint
COMMENT ON COLUMN "corporate_invoices"."version" IS 'İyimser kilit sürümü (If-Match).';--> statement-breakpoint
COMMENT ON TABLE "corporate_invoice_lines" IS 'Toplu fatura satırı: taksitin kesim anındaki kopyası. Bir taksit en çok bir geçerli faturada (invoice_key); ek protokolle yerine gelen taksit aynı zincir ve numarayla da engellenir (chain_key, K-52).';--> statement-breakpoint
COMMENT ON COLUMN "corporate_invoice_lines"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "corporate_invoice_lines"."id" IS 'Satır kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "corporate_invoice_lines"."corporate_invoice_id" IS 'Toplu fatura (corporate_invoices).';--> statement-breakpoint
COMMENT ON COLUMN "corporate_invoice_lines"."invoice_id" IS 'Faturalanan taksit; records ve invoices kimliği, yabancı anahtar değil.';--> statement-breakpoint
COMMENT ON COLUMN "corporate_invoice_lines"."student_id" IS 'Taksitin kursiyeri; records kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "corporate_invoice_lines"."root_contract_id" IS 'Taksitin sözleşme zinciri kökü; sözleşmesiz taksitte boş.';--> statement-breakpoint
COMMENT ON COLUMN "corporate_invoice_lines"."installment" IS 'Taksit numarası.';--> statement-breakpoint
COMMENT ON COLUMN "corporate_invoice_lines"."fee_kind" IS 'Kalem türü (FEE_ITEM_KINDS); boşsa eski kayıttır ve öğrenim sayılır.';--> statement-breakpoint
COMMENT ON COLUMN "corporate_invoice_lines"."due_date" IS 'Taksitin vade günü (kopya).';--> statement-breakpoint
COMMENT ON COLUMN "corporate_invoice_lines"."amount_cents" IS 'Taksit tutarı, kuruş (kopya); ödeme durumu saklanmaz, taksitten hesaplanır.';--> statement-breakpoint
COMMENT ON COLUMN "corporate_invoice_lines"."created_at" IS 'Kayıt anı.';--> statement-breakpoint
COMMENT ON COLUMN "corporate_invoice_lines"."updated_at" IS 'Son değişiklik anı.';--> statement-breakpoint
COMMENT ON COLUMN "corporate_invoice_lines"."archived_at" IS 'Fatura iptaliyle dolar; taksit serbest kalır.';--> statement-breakpoint
COMMENT ON COLUMN "corporate_invoice_lines"."version" IS 'Kayıt sürümü.';
