CREATE TABLE "supplier_invoice_installments" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"due_date" date NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" text DEFAULT 'TRY' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "supplier_invoice_installments_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "supplier_invoice_installments_position_check" CHECK ("supplier_invoice_installments"."position" >= 0),
	CONSTRAINT "supplier_invoice_installments_amount_check" CHECK ("supplier_invoice_installments"."amount_cents" between 1 and 100000000000),
	CONSTRAINT "supplier_invoice_installments_currency_check" CHECK ("supplier_invoice_installments"."currency" = 'TRY')
);
--> statement-breakpoint
CREATE TABLE "supplier_invoices" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"invoice_number" text NOT NULL,
	"invoice_date" date NOT NULL,
	"net_cents" bigint NOT NULL,
	"vat_cents" bigint NOT NULL,
	"gross_cents" bigint NOT NULL,
	"amount_includes_vat" boolean NOT NULL,
	"currency" text DEFAULT 'TRY' NOT NULL,
	"purchase_order_id" uuid,
	"note" text,
	"created_by_user_id" text NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_user_id" text,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "supplier_invoices_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "supplier_invoices_number_check" CHECK (char_length("supplier_invoices"."invoice_number") between 1 and 50),
	CONSTRAINT "supplier_invoices_amount_check" CHECK ("supplier_invoices"."net_cents" >= 0 and "supplier_invoices"."vat_cents" >= 0
        and "supplier_invoices"."gross_cents" between 1 and 100000000000
        and "supplier_invoices"."gross_cents" = "supplier_invoices"."net_cents" + "supplier_invoices"."vat_cents"),
	CONSTRAINT "supplier_invoices_currency_check" CHECK ("supplier_invoices"."currency" = 'TRY'),
	CONSTRAINT "supplier_invoices_text_check" CHECK (("supplier_invoices"."note" is null or char_length("supplier_invoices"."note") <= 500)
        and ("supplier_invoices"."cancel_reason" is null or char_length("supplier_invoices"."cancel_reason") <= 500)),
	CONSTRAINT "supplier_invoices_cancel_check" CHECK ((("supplier_invoices"."cancelled_at" is null) = ("supplier_invoices"."cancelled_by_user_id" is null))
        and (("supplier_invoices"."cancelled_at" is null) = ("supplier_invoices"."cancel_reason" is null)))
);
--> statement-breakpoint
CREATE TABLE "supplier_payments" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"installment_id" uuid NOT NULL,
	"paid_date" date NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" text DEFAULT 'TRY' NOT NULL,
	"method" text NOT NULL,
	"bank_account_id" uuid,
	"description" text,
	"created_by_user_id" text NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_user_id" text,
	"cancel_reason" text,
	"instruction_exported_at" timestamp with time zone,
	"instruction_exported_by_user_id" text,
	"instruction_export_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "supplier_payments_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "supplier_payments_amount_check" CHECK ("supplier_payments"."amount_cents" between 1 and 100000000000),
	CONSTRAINT "supplier_payments_currency_check" CHECK ("supplier_payments"."currency" = 'TRY'),
	CONSTRAINT "supplier_payments_method_check" CHECK ("supplier_payments"."method" in ('transfer', 'eft', 'cash', 'cheque')),
	CONSTRAINT "supplier_payments_bank_account_check" CHECK (("supplier_payments"."method" = 'cash') = ("supplier_payments"."bank_account_id" is null)),
	CONSTRAINT "supplier_payments_text_check" CHECK (("supplier_payments"."description" is null or char_length("supplier_payments"."description") <= 140)
        and ("supplier_payments"."cancel_reason" is null or char_length("supplier_payments"."cancel_reason") <= 500)),
	CONSTRAINT "supplier_payments_lifecycle_check" CHECK ((("supplier_payments"."cancelled_at" is null) = ("supplier_payments"."cancelled_by_user_id" is null))
        and (("supplier_payments"."cancelled_at" is null) = ("supplier_payments"."cancel_reason" is null))
        and (("supplier_payments"."instruction_exported_at" is null) = ("supplier_payments"."instruction_exported_by_user_id" is null))
        and (("supplier_payments"."instruction_exported_at" is null) = ("supplier_payments"."instruction_export_count" = 0)))
);
--> statement-breakpoint
ALTER TABLE "supplier_invoice_installments" ADD CONSTRAINT "supplier_invoice_installments_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice_installments" ADD CONSTRAINT "supplier_invoice_installments_invoice_fkey" FOREIGN KEY ("institution_id","invoice_id") REFERENCES "public"."supplier_invoices"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_supplier_fkey" FOREIGN KEY ("institution_id","supplier_id") REFERENCES "public"."suppliers"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_purchase_order_fkey" FOREIGN KEY ("institution_id","purchase_order_id") REFERENCES "public"."purchase_orders"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_supplier_fkey" FOREIGN KEY ("institution_id","supplier_id") REFERENCES "public"."suppliers"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_invoice_fkey" FOREIGN KEY ("institution_id","invoice_id") REFERENCES "public"."supplier_invoices"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_installment_fkey" FOREIGN KEY ("institution_id","installment_id") REFERENCES "public"."supplier_invoice_installments"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_bank_account_fkey" FOREIGN KEY ("institution_id","bank_account_id") REFERENCES "public"."bank_accounts"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_invoice_installments_position_key" ON "supplier_invoice_installments" USING btree ("institution_id","invoice_id","position") WHERE "supplier_invoice_installments"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "supplier_invoice_installments_invoice_idx" ON "supplier_invoice_installments" USING btree ("institution_id","invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_invoices_number_key" ON "supplier_invoices" USING btree ("institution_id","supplier_id","invoice_number") WHERE "supplier_invoices"."cancelled_at" is null and "supplier_invoices"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "supplier_invoices_supplier_idx" ON "supplier_invoices" USING btree ("institution_id","supplier_id");--> statement-breakpoint
CREATE INDEX "supplier_invoices_purchase_order_idx" ON "supplier_invoices" USING btree ("institution_id","purchase_order_id");--> statement-breakpoint
CREATE INDEX "supplier_invoices_date_idx" ON "supplier_invoices" USING btree ("institution_id","invoice_date");--> statement-breakpoint
CREATE INDEX "supplier_payments_supplier_idx" ON "supplier_payments" USING btree ("institution_id","supplier_id");--> statement-breakpoint
CREATE INDEX "supplier_payments_invoice_idx" ON "supplier_payments" USING btree ("institution_id","invoice_id");--> statement-breakpoint
CREATE INDEX "supplier_payments_installment_idx" ON "supplier_payments" USING btree ("institution_id","installment_id");--> statement-breakpoint
CREATE INDEX "supplier_payments_bank_account_idx" ON "supplier_payments" USING btree ("institution_id","bank_account_id");--> statement-breakpoint
CREATE INDEX "supplier_payments_paid_date_idx" ON "supplier_payments" USING btree ("institution_id","paid_date");--> statement-breakpoint
COMMENT ON TABLE "supplier_invoices" IS 'Tedarikçi faturası (DOM-FIN-076, ON-143): tedarikçi carisinin borç kaydı. Kampüs muhasebe defteri tutmaz (IST-142); cari yönetim takibidir, resmi kayıt muhasebe programındadır. Net, KDV ve KDV dahil tutar belgenin kopyasıdır; ödenen ve kalan ödemelerden hesaplanır. Silinmez, gerekçeyle iptal edilir; ödemesi olan fatura iptal edilmez.';--> statement-breakpoint
COMMENT ON COLUMN "supplier_invoices"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "supplier_invoices"."id" IS 'Fatura kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "supplier_invoices"."supplier_id" IS 'Tedarikçi (suppliers); pasif tedarikçinin geç gelen faturası da girilir (K-160).';--> statement-breakpoint
COMMENT ON COLUMN "supplier_invoices"."invoice_number" IS 'Fatura numarası; boşluksuz ve büyük harfle saklanır, aynı tedarikçinin iptal edilmemiş faturaları arasında tekil (K-161).';--> statement-breakpoint
COMMENT ON COLUMN "supplier_invoices"."invoice_date" IS 'Fatura tarihi (YYYY-MM-DD); bugünden sonra olamaz. Ekstrede fatura bu güne yazılır.';--> statement-breakpoint
COMMENT ON COLUMN "supplier_invoices"."net_cents" IS 'KDV hariç tutar, kuruş.';--> statement-breakpoint
COMMENT ON COLUMN "supplier_invoices"."vat_cents" IS 'KDV tutarı, kuruş; faturadaki gibi girilir, oran tutulmaz.';--> statement-breakpoint
COMMENT ON COLUMN "supplier_invoices"."gross_cents" IS 'KDV dahil tutar, kuruş; net + KDV. Ödeme planının toplamıdır.';--> statement-breakpoint
COMMENT ON COLUMN "supplier_invoices"."amount_includes_vat" IS 'Tutarın girişte KDV dahil mi hariç mi yazıldığı; yalnız giriş biçimini gösterir.';--> statement-breakpoint
COMMENT ON COLUMN "supplier_invoices"."currency" IS 'Para birimi; yalnız TRY.';--> statement-breakpoint
COMMENT ON COLUMN "supplier_invoices"."purchase_order_id" IS 'İsteğe bağlı satın alma siparişi (purchase_orders; DOM-FIN-073); aynı tedarikçinin gönderilmiş siparişi. Etkin faturaların toplamı sipariş tutarını aşarsa açık onay istenir (K-162).';--> statement-breakpoint
COMMENT ON COLUMN "supplier_invoices"."note" IS 'İsteğe bağlı not, en çok 500 karakter.';--> statement-breakpoint
COMMENT ON COLUMN "supplier_invoices"."created_by_user_id" IS 'Faturayı giren yönetici.';--> statement-breakpoint
COMMENT ON COLUMN "supplier_invoices"."cancelled_at" IS 'İptal zamanı; iptal ekstrede iptal gününe ters hareket olarak yazılır.';--> statement-breakpoint
COMMENT ON COLUMN "supplier_invoices"."cancelled_by_user_id" IS 'İptal eden yönetici.';--> statement-breakpoint
COMMENT ON COLUMN "supplier_invoices"."cancel_reason" IS 'İptal gerekçesi, 5–500 karakter.';--> statement-breakpoint
COMMENT ON COLUMN "supplier_invoices"."created_at" IS 'Oluşturma zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "supplier_invoices"."updated_at" IS 'Son değişiklik zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "supplier_invoices"."archived_at" IS 'Arşiv zamanı; bugün kullanılmaz (fatura iptal edilir).';--> statement-breakpoint
COMMENT ON COLUMN "supplier_invoices"."version" IS 'İyimser kilit sürümü (If-Match).';--> statement-breakpoint
COMMENT ON TABLE "supplier_invoice_installments" IS 'Tedarikçi faturasının ödeme planı taksiti (DOM-FIN-076): vade ve tutar. Etkin taksitlerin toplamı faturanın KDV dahil tutarıdır; plan yalnız ödemesiz faturada yeniden yazılır, eski taksitler arşivlenir.';--> statement-breakpoint
COMMENT ON COLUMN "supplier_invoice_installments"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "supplier_invoice_installments"."id" IS 'Taksit kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "supplier_invoice_installments"."invoice_id" IS 'Fatura (supplier_invoices).';--> statement-breakpoint
COMMENT ON COLUMN "supplier_invoice_installments"."position" IS 'Plandaki sıra (vade sırası, 0’dan başlar); etkin taksitler arasında tekil.';--> statement-breakpoint
COMMENT ON COLUMN "supplier_invoice_installments"."due_date" IS 'Vade günü (YYYY-MM-DD); fatura tarihinden önce olamaz. Vade günü geçince kalan vadesi geçmiş sayılır.';--> statement-breakpoint
COMMENT ON COLUMN "supplier_invoice_installments"."amount_cents" IS 'Taksit tutarı, kuruş; sıfırdan büyük.';--> statement-breakpoint
COMMENT ON COLUMN "supplier_invoice_installments"."currency" IS 'Para birimi; yalnız TRY.';--> statement-breakpoint
COMMENT ON COLUMN "supplier_invoice_installments"."created_at" IS 'Oluşturma zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "supplier_invoice_installments"."updated_at" IS 'Son değişiklik zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "supplier_invoice_installments"."archived_at" IS 'Plan yeniden yazılınca eski taksitin arşivlenme zamanı.';--> statement-breakpoint
COMMENT ON COLUMN "supplier_invoice_installments"."version" IS 'İyimser kilit sürümü.';--> statement-breakpoint
COMMENT ON TABLE "supplier_payments" IS 'Tedarikçi ödemesi (DOM-FIN-076): bir taksite yazılır, kısmi olabilir; taksitin kalanını aşamaz (kurum kilidi altında denetlenir). Nakit dışı ödeme kurumun bildirilmiş banka hesabından çıkar (DOM-FIN-032); kapatılmış güne nakit ödeme yazılmaz (DOM-FIN-036, K-166). Silinmez, gerekçeyle iptal edilir. Havale ve EFT ödemeleri genel talimat dosyasına alınır (K-164).';--> statement-breakpoint
COMMENT ON COLUMN "supplier_payments"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "supplier_payments"."id" IS 'Ödeme kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "supplier_payments"."supplier_id" IS 'Tedarikçi (suppliers); faturanın tedarikçisi.';--> statement-breakpoint
COMMENT ON COLUMN "supplier_payments"."invoice_id" IS 'Fatura (supplier_invoices).';--> statement-breakpoint
COMMENT ON COLUMN "supplier_payments"."installment_id" IS 'Ödemenin yazıldığı taksit (supplier_invoice_installments).';--> statement-breakpoint
COMMENT ON COLUMN "supplier_payments"."paid_date" IS 'Ödeme günü (YYYY-MM-DD, Europe/Istanbul); bugünden sonra ve fatura tarihinden önce olamaz.';--> statement-breakpoint
COMMENT ON COLUMN "supplier_payments"."amount_cents" IS 'Ödenen tutar, kuruş; sıfırdan büyük.';--> statement-breakpoint
COMMENT ON COLUMN "supplier_payments"."currency" IS 'Para birimi; yalnız TRY.';--> statement-breakpoint
COMMENT ON COLUMN "supplier_payments"."method" IS 'Yöntem: transfer (havale), eft, cash (nakit), cheque (çek).';--> statement-breakpoint
COMMENT ON COLUMN "supplier_payments"."bank_account_id" IS 'Ödemenin çıktığı kurum banka hesabı (bank_accounts); nakitte boş, öteki yöntemlerde zorunlu.';--> statement-breakpoint
COMMENT ON COLUMN "supplier_payments"."description" IS 'Banka açıklaması, en çok 140 karakter; boşsa talimat dosyasına "Fatura <no> ödemesi" yazılır.';--> statement-breakpoint
COMMENT ON COLUMN "supplier_payments"."created_by_user_id" IS 'Ödemeyi giren yönetici.';--> statement-breakpoint
COMMENT ON COLUMN "supplier_payments"."cancelled_at" IS 'İptal zamanı; iptal ekstrede iptal gününe ters hareket olarak yazılır.';--> statement-breakpoint
COMMENT ON COLUMN "supplier_payments"."cancelled_by_user_id" IS 'İptal eden yönetici.';--> statement-breakpoint
COMMENT ON COLUMN "supplier_payments"."cancel_reason" IS 'İptal gerekçesi, 5–500 karakter.';--> statement-breakpoint
COMMENT ON COLUMN "supplier_payments"."instruction_exported_at" IS 'Ödemenin talimat dosyasına ilk alındığı zaman; doluysa yeniden alma açık onay ister (K-165).';--> statement-breakpoint
COMMENT ON COLUMN "supplier_payments"."instruction_exported_by_user_id" IS 'Talimat dosyasını ilk alan yönetici.';--> statement-breakpoint
COMMENT ON COLUMN "supplier_payments"."instruction_export_count" IS 'Talimat dosyasına kaç kez alındığı; 0 alınmadı demektir.';--> statement-breakpoint
COMMENT ON COLUMN "supplier_payments"."created_at" IS 'Oluşturma zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "supplier_payments"."updated_at" IS 'Son değişiklik zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "supplier_payments"."archived_at" IS 'Arşiv zamanı; bugün kullanılmaz (ödeme iptal edilir).';--> statement-breakpoint
COMMENT ON COLUMN "supplier_payments"."version" IS 'İyimser kilit sürümü (If-Match).';