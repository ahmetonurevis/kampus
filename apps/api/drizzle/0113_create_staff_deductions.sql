CREATE TABLE "staff_advances" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"membership_id" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" text DEFAULT 'TRY' NOT NULL,
	"given_date" date NOT NULL,
	"payment_method" text NOT NULL,
	"installment_count" integer NOT NULL,
	"first_month" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"closed_date" date,
	"closed_from_month" text,
	"close_method" text,
	"closed_by_user_id" text,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"cancelled_by_user_id" text,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "staff_advances_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "staff_advances_amount_check" CHECK ("staff_advances"."amount_cents" between "staff_advances"."installment_count" and 100000000
        and "staff_advances"."currency" = 'TRY'),
	CONSTRAINT "staff_advances_installment_check" CHECK ("staff_advances"."installment_count" between 1 and 24
        and "staff_advances"."first_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "staff_advances_payment_method_check" CHECK ("staff_advances"."payment_method" in ('cash', 'bank_transfer')),
	CONSTRAINT "staff_advances_status_check" CHECK ("staff_advances"."status" in ('active', 'closed', 'cancelled')),
	CONSTRAINT "staff_advances_close_check" CHECK (("staff_advances"."status" = 'closed') = ("staff_advances"."closed_date" is not null)
        and ("staff_advances"."status" = 'closed') = ("staff_advances"."closed_from_month" is not null)
        and ("staff_advances"."status" = 'closed') = ("staff_advances"."close_method" is not null)
        and ("staff_advances"."status" = 'closed') = ("staff_advances"."closed_by_user_id" is not null)
        and ("staff_advances"."closed_from_month" is null or "staff_advances"."closed_from_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
        and ("staff_advances"."close_method" is null or "staff_advances"."close_method" in ('cash', 'bank_transfer'))),
	CONSTRAINT "staff_advances_cancel_check" CHECK (("staff_advances"."status" = 'cancelled') = ("staff_advances"."cancelled_at" is not null)
        and ("staff_advances"."status" = 'cancelled') = ("staff_advances"."cancel_reason" is not null)
        and ("staff_advances"."status" = 'cancelled') = ("staff_advances"."cancelled_by_user_id" is not null)
        and ("staff_advances"."cancel_reason" is null or char_length("staff_advances"."cancel_reason")
          between 5 and 500))
);
--> statement-breakpoint
CREATE TABLE "staff_garnishments" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"membership_id" text NOT NULL,
	"office" text NOT NULL,
	"file_number" text NOT NULL,
	"claim_cents" bigint NOT NULL,
	"remaining_cents" bigint NOT NULL,
	"currency" text DEFAULT 'TRY' NOT NULL,
	"rate_basis_points" integer NOT NULL,
	"is_alimony" boolean DEFAULT false NOT NULL,
	"received_date" date NOT NULL,
	"sequence" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"closed_date" date,
	"close_reason" text,
	"closed_by_user_id" text,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "staff_garnishments_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "staff_garnishments_text_check" CHECK (char_length("staff_garnishments"."office") between 3 and 120
        and char_length("staff_garnishments"."file_number") between 3 and 40),
	CONSTRAINT "staff_garnishments_amount_check" CHECK ("staff_garnishments"."claim_cents" > 0 and "staff_garnishments"."remaining_cents" between 0 and "staff_garnishments"."claim_cents"
        and "staff_garnishments"."currency" = 'TRY'
        and "staff_garnishments"."rate_basis_points" between 1 and 10000 and "staff_garnishments"."sequence" > 0),
	CONSTRAINT "staff_garnishments_status_check" CHECK ("staff_garnishments"."status" in ('active', 'closed')),
	CONSTRAINT "staff_garnishments_close_check" CHECK (("staff_garnishments"."status" = 'closed') = ("staff_garnishments"."closed_date" is not null)
        and ("staff_garnishments"."status" = 'closed') = ("staff_garnishments"."close_reason" is not null)
        and ("staff_garnishments"."status" = 'closed') = ("staff_garnishments"."closed_by_user_id" is not null)
        and ("staff_garnishments"."closed_date" is null or "staff_garnishments"."closed_date" >= "staff_garnishments"."received_date")
        and ("staff_garnishments"."close_reason" is null or "staff_garnishments"."close_reason" in ('paid_off', 'lifted', 'other')))
);
--> statement-breakpoint
CREATE TABLE "staff_pension_enrollments" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"membership_id" text NOT NULL,
	"rate_basis_points" integer NOT NULL,
	"start_date" date NOT NULL,
	"pauses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"opt_out_date" date,
	"opted_out_by_user_id" text,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "staff_pension_enrollments_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "staff_pension_enrollments_rate_check" CHECK ("staff_pension_enrollments"."rate_basis_points" between 300 and 10000),
	CONSTRAINT "staff_pension_enrollments_pauses_check" CHECK (jsonb_typeof("staff_pension_enrollments"."pauses") = 'array'),
	CONSTRAINT "staff_pension_enrollments_opt_out_check" CHECK (("staff_pension_enrollments"."opt_out_date" is null) = ("staff_pension_enrollments"."opted_out_by_user_id" is null)
        and ("staff_pension_enrollments"."opt_out_date" is null or "staff_pension_enrollments"."opt_out_date" >= "staff_pension_enrollments"."start_date"))
);
--> statement-breakpoint
ALTER TABLE "staff_advances" ADD CONSTRAINT "staff_advances_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_advances" ADD CONSTRAINT "staff_advances_membership_fkey" FOREIGN KEY ("institution_id","membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_garnishments" ADD CONSTRAINT "staff_garnishments_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_garnishments" ADD CONSTRAINT "staff_garnishments_membership_fkey" FOREIGN KEY ("institution_id","membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_pension_enrollments" ADD CONSTRAINT "staff_pension_enrollments_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_pension_enrollments" ADD CONSTRAINT "staff_pension_enrollments_membership_fkey" FOREIGN KEY ("institution_id","membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_advances_membership_idx" ON "staff_advances" USING btree ("institution_id","membership_id","given_date");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_garnishments_file_key" ON "staff_garnishments" USING btree ("institution_id","membership_id","office","file_number") WHERE "staff_garnishments"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_garnishments_sequence_key" ON "staff_garnishments" USING btree ("institution_id","membership_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_pension_enrollments_open_key" ON "staff_pension_enrollments" USING btree ("institution_id","membership_id") WHERE "staff_pension_enrollments"."opt_out_date" is null and "staff_pension_enrollments"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "staff_pension_enrollments_membership_idx" ON "staff_pension_enrollments" USING btree ("institution_id","membership_id");--> statement-breakpoint
COMMENT ON TABLE "staff_advances" IS 'Personel avansı (DOM-FIN-101, ON-199, K-312): kurum personeline (yönetici, öğretmen, ön büro üyeliği) verilen ücret avansı ve aylık mahsup koşulları. Taksit planı saklanmaz; tutar taksit sayısına eşit kuruşla bölünür, yuvarlama farkı son taksite eklenir ve ilk aydan başlayarak aylara yayılır. Bordro hesabı (ON-198) ayın taksitini buradan okur. Kayıt silinmez: erken kapama ve gerekçeli iptal birer kez yazılır. Yalnız yönetici okur ve yazar.';--> statement-breakpoint
COMMENT ON TABLE "staff_garnishments" IS 'İcra (maaş haczi) kesintisi (DOM-FIN-101, ON-199, K-313): icra dairesinin personel hakkındaki müzekkeresi. Kesinti net ücret × oran, kalan alacakla sınırlı; nafaka hacizleri önce, ötekiler tebliğ gününe göre (aynı gün sequence) sırayla ve aynı anda yalnız sıradaki biri kesilir. Sıra saklanmaz, okumada hesaplanır. Hassas kişisel veridir: yalnız yönetici okur, her okuma audit_log''a alan adlarıyla yazılır, değerler loglanmaz. Silinmez, kapanışla biter.';--> statement-breakpoint
COMMENT ON TABLE "staff_pension_enrollments" IS 'Bireysel emeklilik otomatik katılım kaydı (DOM-FIN-101, ON-199, K-314): çalışan katkı oranı, başlangıç, ara vermeler ve cayma ya da ayrılma günü. Yalnız kayıttır; katkı emeklilik şirketine buradan aktarılmaz. Personelin tek açık (ayrılmamış) katılımı olur. Kesinti tutarı bordroda BES matrahı × oran olarak hesaplanır.';--> statement-breakpoint
COMMENT ON COLUMN "staff_advances"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "staff_advances"."id" IS 'Avans kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "staff_advances"."membership_id" IS 'Avans alan personelin kurum üyeliği (memberships); personel kaydı Oğuzhan''ın alanındadır, üyelik silinirse avans korunur (restrict).';--> statement-breakpoint
COMMENT ON COLUMN "staff_advances"."amount_cents" IS 'Avans tutarı, kuruş; taksit sayısından az, 1.000.000 TL''den çok olamaz.';--> statement-breakpoint
COMMENT ON COLUMN "staff_advances"."currency" IS 'Para birimi; yalnız TRY.';--> statement-breakpoint
COMMENT ON COLUMN "staff_advances"."given_date" IS 'Avansın verildiği gün; bugünden sonra olamaz.';--> statement-breakpoint
COMMENT ON COLUMN "staff_advances"."payment_method" IS 'Avansın ödendiği yöntem: cash (nakit), bank_transfer (banka havalesi). Kasa ve banka kaydına bugün bağlanmaz.';--> statement-breakpoint
COMMENT ON COLUMN "staff_advances"."installment_count" IS 'Kaç ayda mahsup edileceği, 1–24.';--> statement-breakpoint
COMMENT ON COLUMN "staff_advances"."first_month" IS 'Mahsubun başladığı ay (YYYY-MM); veriliş ayından önce, 12 aydan sonra olamaz.';--> statement-breakpoint
COMMENT ON COLUMN "staff_advances"."status" IS 'active (mahsup sürüyor), closed (erken kapandı), cancelled (iptal; hiçbir taksit kesilmez). Son taksitin geçmesi durumu değiştirmez, bitiş plandan hesaplanır.';--> statement-breakpoint
COMMENT ON COLUMN "staff_advances"."closed_date" IS 'Erken kapamada kalan tutarın geri alındığı gün; yalnız closed durumunda dolu.';--> statement-breakpoint
COMMENT ON COLUMN "staff_advances"."closed_from_month" IS 'Erken kapamada kesilmeyecek ilk taksit ayı (YYYY-MM); bu ve sonraki taksitler personelin ödediği kalandır (saklanmaz, plandan hesaplanır).';--> statement-breakpoint
COMMENT ON COLUMN "staff_advances"."close_method" IS 'Kalanın geri alındığı yöntem: cash, bank_transfer.';--> statement-breakpoint
COMMENT ON COLUMN "staff_advances"."closed_by_user_id" IS 'Erken kapamayı işleyen yönetici (Better Auth kimliği).';--> statement-breakpoint
COMMENT ON COLUMN "staff_advances"."cancelled_at" IS 'İptal zamanı (UTC); yalnız cancelled durumunda dolu.';--> statement-breakpoint
COMMENT ON COLUMN "staff_advances"."cancel_reason" IS 'İptal gerekçesi, 5–500 karakter serbest metin; denetim kaydına ve loga yazılmaz.';--> statement-breakpoint
COMMENT ON COLUMN "staff_advances"."cancelled_by_user_id" IS 'İptali yapan yönetici.';--> statement-breakpoint
COMMENT ON COLUMN "staff_advances"."created_by_user_id" IS 'Avansı kaydeden yönetici.';--> statement-breakpoint
COMMENT ON COLUMN "staff_advances"."created_at" IS 'Oluşturma zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "staff_advances"."updated_at" IS 'Son değişiklik zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "staff_advances"."archived_at" IS 'Arşiv zamanı; avans silinmez, alan veri sahibi talebi ve imha için ayrılmıştır.';--> statement-breakpoint
COMMENT ON COLUMN "staff_advances"."version" IS 'İyimser kilit sürümü; her güncellemede bir artar (If-Match).';--> statement-breakpoint
COMMENT ON COLUMN "staff_garnishments"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "staff_garnishments"."id" IS 'İcra kesintisi kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "staff_garnishments"."membership_id" IS 'Hakkında müzekkere gelen personelin kurum üyeliği (memberships, restrict).';--> statement-breakpoint
COMMENT ON COLUMN "staff_garnishments"."office" IS 'İcra dairesi adı (3–120 karakter). Hassas; yalnız yöneticiye döner, loglanmaz.';--> statement-breakpoint
COMMENT ON COLUMN "staff_garnishments"."file_number" IS 'İcra dosya numarası (3–40 karakter, ör. 2026/1234). Aynı personele aynı daire ve dosya iki kez yazılmaz.';--> statement-breakpoint
COMMENT ON COLUMN "staff_garnishments"."claim_cents" IS 'Müzekkeredeki alacak tutarı, kuruş; değişmez.';--> statement-breakpoint
COMMENT ON COLUMN "staff_garnishments"."remaining_cents" IS 'Kalan alacak, kuruş; kayıtta alacağa eşit, icra dairesinin bakiye yazısıyla ya da bordro kesintisiyle düşer, alacağı aşamaz. Kesinti bunu aşmaz.';--> statement-breakpoint
COMMENT ON COLUMN "staff_garnishments"."currency" IS 'Para birimi; yalnız TRY.';--> statement-breakpoint
COMMENT ON COLUMN "staff_garnishments"."rate_basis_points" IS 'Net ücretten kesilecek oran, onbinde (2500 = dörtte bir, İİK md. 83 varsayılanı; H-45).';--> statement-breakpoint
COMMENT ON COLUMN "staff_garnishments"."is_alimony" IS 'Nafaka alacağı mı; nafaka hacizleri sıradan önce ve öteki hacizlerle birlikte kesilir.';--> statement-breakpoint
COMMENT ON COLUMN "staff_garnishments"."received_date" IS 'Müzekkerenin kuruma tebliğ günü; kesinti bu günün ayından başlar, sıra bu güne göredir.';--> statement-breakpoint
COMMENT ON COLUMN "staff_garnishments"."sequence" IS 'Personelde kayıt sıra numarası (1, 2, …); aynı gün tebliğ edilen müzekkerelerde sırayı belirler, yeniden kullanılmaz.';--> statement-breakpoint
COMMENT ON COLUMN "staff_garnishments"."status" IS 'active (kesiliyor ya da sırada), closed (kapandı).';--> statement-breakpoint
COMMENT ON COLUMN "staff_garnishments"."closed_date" IS 'Kapanış günü; tebliğden önce olamaz. Bu günün ayından itibaren kesilmez.';--> statement-breakpoint
COMMENT ON COLUMN "staff_garnishments"."close_reason" IS 'Kapanış nedeni: paid_off (borç ödendi), lifted (haciz kaldırıldı), other.';--> statement-breakpoint
COMMENT ON COLUMN "staff_garnishments"."closed_by_user_id" IS 'Kapanışı işleyen yönetici.';--> statement-breakpoint
COMMENT ON COLUMN "staff_garnishments"."created_by_user_id" IS 'Müzekkereyi kaydeden yönetici.';--> statement-breakpoint
COMMENT ON COLUMN "staff_garnishments"."created_at" IS 'Oluşturma zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "staff_garnishments"."updated_at" IS 'Son değişiklik zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "staff_garnishments"."archived_at" IS 'Arşiv zamanı; icra kaydı silinmez, alan veri sahibi talebi ve imha için ayrılmıştır.';--> statement-breakpoint
COMMENT ON COLUMN "staff_garnishments"."version" IS 'İyimser kilit sürümü; her güncellemede bir artar (If-Match).';--> statement-breakpoint
COMMENT ON COLUMN "staff_pension_enrollments"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "staff_pension_enrollments"."id" IS 'Katılım kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "staff_pension_enrollments"."membership_id" IS 'Katılan personelin kurum üyeliği (memberships, restrict).';--> statement-breakpoint
COMMENT ON COLUMN "staff_pension_enrollments"."rate_basis_points" IS 'Çalışan katkı oranı, onbinde; en az ve varsayılan 300 (%3; H-46).';--> statement-breakpoint
COMMENT ON COLUMN "staff_pension_enrollments"."start_date" IS 'Sisteme dahil olma günü; kesinti bu günün ayından başlar.';--> statement-breakpoint
COMMENT ON COLUMN "staff_pension_enrollments"."pauses" IS 'Ara vermeler: [{fromMonth, toMonth}] (YYYY-MM, iki uç dahil) dizisi; her biri en çok 12 ay, çakışmaz. Bu aylarda kesinti yapılmaz.';--> statement-breakpoint
COMMENT ON COLUMN "staff_pension_enrollments"."opt_out_date" IS 'Cayma ya da ayrılma günü; bu günün ayından itibaren kesilmez. Katılımdan iki ay içindeyse cayma (katkı iade edilir), sonraysa ayrılma; tür saklanmaz, hesaplanır.';--> statement-breakpoint
COMMENT ON COLUMN "staff_pension_enrollments"."opted_out_by_user_id" IS 'Caymayı ya da ayrılmayı işleyen yönetici.';--> statement-breakpoint
COMMENT ON COLUMN "staff_pension_enrollments"."created_by_user_id" IS 'Katılımı kaydeden yönetici.';--> statement-breakpoint
COMMENT ON COLUMN "staff_pension_enrollments"."created_at" IS 'Oluşturma zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "staff_pension_enrollments"."updated_at" IS 'Son değişiklik zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "staff_pension_enrollments"."archived_at" IS 'Arşiv zamanı; katılım silinmez.';--> statement-breakpoint
COMMENT ON COLUMN "staff_pension_enrollments"."version" IS 'İyimser kilit sürümü; her güncellemede bir artar (If-Match).';
