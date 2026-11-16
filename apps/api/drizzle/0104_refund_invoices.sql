CREATE TABLE "refund_invoices" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"withdrawal_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"original_invoice_number" text NOT NULL,
	"original_invoice_date" date NOT NULL,
	"original_invoice_type" text NOT NULL,
	"original_total_cents" bigint NOT NULL,
	"vat_rate_basis_points" integer NOT NULL,
	"amount_cents" bigint NOT NULL,
	"net_cents" bigint NOT NULL,
	"vat_cents" bigint NOT NULL,
	"currency" text DEFAULT 'TRY' NOT NULL,
	"note" text,
	"document_number" text,
	"completed_date" date,
	"created_by_user_id" text NOT NULL,
	"ready_at" timestamp with time zone,
	"ready_by_user_id" text,
	"completed_at" timestamp with time zone,
	"completed_by_user_id" text,
	"discard_reason" text,
	"discarded_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "refund_invoices_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "refund_invoices_kind_check" CHECK ("refund_invoices"."kind" in ('cancellation', 'return_invoice')),
	CONSTRAINT "refund_invoices_status_check" CHECK ("refund_invoices"."status" in ('draft', 'ready', 'sent', 'cancelled')),
	CONSTRAINT "refund_invoices_original_type_check" CHECK ("refund_invoices"."original_invoice_type" in ('e_archive', 'e_invoice')),
	CONSTRAINT "refund_invoices_vat_rate_check" CHECK ("refund_invoices"."vat_rate_basis_points" in (0, 100, 1000, 2000)),
	CONSTRAINT "refund_invoices_currency_check" CHECK ("refund_invoices"."currency" = 'TRY'),
	CONSTRAINT "refund_invoices_amounts_check" CHECK ("refund_invoices"."original_total_cents" > 0 and "refund_invoices"."amount_cents" > 0 and "refund_invoices"."amount_cents" <= "refund_invoices"."original_total_cents" and "refund_invoices"."net_cents" >= 0 and "refund_invoices"."vat_cents" >= 0 and "refund_invoices"."net_cents" + "refund_invoices"."vat_cents" = "refund_invoices"."amount_cents"),
	CONSTRAINT "refund_invoices_kind_status_check" CHECK (("refund_invoices"."kind" = 'return_invoice' and "refund_invoices"."status" <> 'cancelled') or ("refund_invoices"."kind" = 'cancellation' and "refund_invoices"."status" <> 'sent')),
	CONSTRAINT "refund_invoices_completed_check" CHECK (("refund_invoices"."status" in ('sent', 'cancelled')) = ("refund_invoices"."completed_date" is not null)),
	CONSTRAINT "refund_invoices_document_number_check" CHECK (("refund_invoices"."document_number" is not null) = ("refund_invoices"."status" = 'sent')),
	CONSTRAINT "refund_invoices_discard_check" CHECK (("refund_invoices"."discard_reason" is null) = ("refund_invoices"."archived_at" is null) and ("refund_invoices"."archived_at" is null or "refund_invoices"."status" in ('draft', 'ready')))
);
--> statement-breakpoint
ALTER TABLE "refund_invoices" ADD CONSTRAINT "refund_invoices_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_invoices" ADD CONSTRAINT "refund_invoices_withdrawal_fkey" FOREIGN KEY ("institution_id","withdrawal_id") REFERENCES "public"."student_withdrawals"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "refund_invoices_withdrawal_key" ON "refund_invoices" USING btree ("institution_id","withdrawal_id") WHERE "refund_invoices"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "refund_invoices_document_number_key" ON "refund_invoices" USING btree ("institution_id","document_number") WHERE "refund_invoices"."document_number" is not null;--> statement-breakpoint
CREATE INDEX "refund_invoices_withdrawal_idx" ON "refund_invoices" USING btree ("institution_id","withdrawal_id");--> statement-breakpoint
CREATE INDEX "refund_invoices_status_idx" ON "refund_invoices" USING btree ("institution_id","status");--> statement-breakpoint
COMMENT ON TABLE "refund_invoices" IS 'İade faturası ve iptal isteği (DOM-FIN-096, ON-266, K-292…K-295): ödenmiş ayrılış iadesine (student_withdrawals) bağlı tek belge. Asıl fatura Kampüs dışında (entegratör ya da muhasebe programı) kesildiği için numarası, tarihi, türü, KDV dahil tutarı ve KDV oranı elle girilir. Asıl fatura iptal penceresindeyse (e-Arşiv 7, e-Fatura 8 gün; doğrulanmalı, H-35, M-32) ve iade faturanın tamamıysa iptal isteği, değilse iade faturası hazırlanır. Durum: taslak → gönderime hazır → gönderildi (iade faturası) ya da iptal edildi (iptal isteği); entegratör bağlantısı yokken belge hazırda kalır, CSV ile dışa aktarılır ve sonuç elle işlenir. Aynı iadeye arşivlenmemiş ikinci belge açılmaz; vazgeçilen belge gerekçesiyle arşivlenir; sonucu işlenmiş belge değişmez.';--> statement-breakpoint
COMMENT ON COLUMN "refund_invoices"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "refund_invoices"."id" IS 'Belge kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "refund_invoices"."withdrawal_id" IS 'Belgenin dayandığı ödenmiş ayrılış iadesi (student_withdrawals); iade başına arşivlenmemiş tek belge.';--> statement-breakpoint
COMMENT ON COLUMN "refund_invoices"."kind" IS 'Belge türü: cancellation (asıl faturanın iptal isteği; yalnız tam iadede ve iptal penceresinde) ya da return_invoice (asıl faturaya bağlı iade faturası).';--> statement-breakpoint
COMMENT ON COLUMN "refund_invoices"."status" IS 'Durum: draft (taslak), ready (gönderime hazır), sent (iade faturası gönderildi), cancelled (asıl fatura iptal edildi). sent yalnız iade faturasında, cancelled yalnız iptal isteğinde.';--> statement-breakpoint
COMMENT ON COLUMN "refund_invoices"."original_invoice_number" IS 'Asıl faturanın GİB numarası: 3 karakter seri, 4 hane yıl, 9 hane sıra; yıl fatura tarihinin yılıdır.';--> statement-breakpoint
COMMENT ON COLUMN "refund_invoices"."original_invoice_date" IS 'Asıl faturanın tarihi; iptal penceresi bu günden sayılır. Bugünden ve iadenin ödendiği günden sonra olamaz.';--> statement-breakpoint
COMMENT ON COLUMN "refund_invoices"."original_invoice_type" IS 'Asıl faturanın türü: e_archive (e-Arşiv, iptal penceresi 7 gün) ya da e_invoice (e-Fatura, alıcı itiraz süresi 8 gün); süreler doğrulanmalı.';--> statement-breakpoint
COMMENT ON COLUMN "refund_invoices"."original_total_cents" IS 'Asıl faturanın KDV dahil tutarı, kuruş; belge tutarı bunu aşamaz, iptal isteği yalnız buna eşit tutarda açılır.';--> statement-breakpoint
COMMENT ON COLUMN "refund_invoices"."vat_rate_basis_points" IS 'Asıl faturanın KDV oranı, on binde birlik (0, 100, 1000, 2000 = %0, %1, %10, %20); belge aynı oranla ayrılır.';--> statement-breakpoint
COMMENT ON COLUMN "refund_invoices"."amount_cents" IS 'Belge tutarı (KDV dahil), kuruş; iade tutarını ve asıl fatura tutarını aşamaz. Kısmi iade olabilir.';--> statement-breakpoint
COMMENT ON COLUMN "refund_invoices"."net_cents" IS 'Belgenin KDV hariç tutarı, kuruş: tutar / (1 + oran), kuruşa en yakın; taslak anında sabitlenir.';--> statement-breakpoint
COMMENT ON COLUMN "refund_invoices"."vat_cents" IS 'Belgenin KDV tutarı, kuruş: tutar eksi KDV hariç tutar; taslak anında sabitlenir.';--> statement-breakpoint
COMMENT ON COLUMN "refund_invoices"."currency" IS 'Para birimi; yalnız TRY.';--> statement-breakpoint
COMMENT ON COLUMN "refund_invoices"."note" IS 'Muhasebe notu (en çok 500 karakter); kişisel veri yazılmamalıdır, loglanmaz.';--> statement-breakpoint
COMMENT ON COLUMN "refund_invoices"."document_number" IS 'Entegratörde kesilen iade faturasının GİB numarası; yalnız gönderildi durumunda dolu, kurumda tekil.';--> statement-breakpoint
COMMENT ON COLUMN "refund_invoices"."completed_date" IS 'Sonucun işlendiği gün: iade faturasının kesildiği ya da asıl faturanın iptal edildiği gün; gönderildi ve iptal edildi durumunda dolu.';--> statement-breakpoint
COMMENT ON COLUMN "refund_invoices"."created_by_user_id" IS 'Taslağı hazırlayan kullanıcı.';--> statement-breakpoint
COMMENT ON COLUMN "refund_invoices"."ready_at" IS 'Gönderime hazır işaretlenme zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "refund_invoices"."ready_by_user_id" IS 'Belgeyi gönderime hazır işaretleyen kullanıcı.';--> statement-breakpoint
COMMENT ON COLUMN "refund_invoices"."completed_at" IS 'Sonucun sisteme işlendiği zaman (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "refund_invoices"."completed_by_user_id" IS 'Sonucu işleyen kullanıcı.';--> statement-breakpoint
COMMENT ON COLUMN "refund_invoices"."discard_reason" IS 'Vazgeçme gerekçesi (5–500 karakter); yalnız arşivlenmiş (vazgeçilmiş) belgede dolu.';--> statement-breakpoint
COMMENT ON COLUMN "refund_invoices"."discarded_by_user_id" IS 'Belgeden vazgeçen kullanıcı.';--> statement-breakpoint
COMMENT ON COLUMN "refund_invoices"."created_at" IS 'Oluşturma zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "refund_invoices"."updated_at" IS 'Son değişiklik zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "refund_invoices"."archived_at" IS 'Vazgeçme (arşiv) zamanı; belge silinmez. Yalnız taslak ve hazır belge arşivlenir.';--> statement-breakpoint
COMMENT ON COLUMN "refund_invoices"."version" IS 'İyimser kilit sürümü; her güncellemede bir artar (If-Match).';
