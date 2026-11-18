CREATE TABLE "alumni_document_fees" (
	"institution_id" text NOT NULL,
	"document_type" text NOT NULL,
	"fee_cents" bigint NOT NULL,
	"currency" text DEFAULT 'TRY' NOT NULL,
	"updated_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "alumni_document_fees_pkey" PRIMARY KEY("institution_id","document_type"),
	CONSTRAINT "alumni_document_fees_document_type_check" CHECK ("alumni_document_fees"."document_type" in ('education_certificate', 'transcript', 'diploma_copy')),
	CONSTRAINT "alumni_document_fees_fee_check" CHECK ("alumni_document_fees"."fee_cents" between 0 and 1000000),
	CONSTRAINT "alumni_document_fees_currency_check" CHECK ("alumni_document_fees"."currency" = 'TRY')
);
--> statement-breakpoint
CREATE TABLE "alumni_document_requests" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"student_id" text NOT NULL,
	"document_type" text NOT NULL,
	"copies" integer NOT NULL,
	"channel" text NOT NULL,
	"requester_kind" text NOT NULL,
	"guardian_parent_id" text,
	"requester_name" text NOT NULL,
	"authorization_file_id" uuid,
	"delivery_method" text NOT NULL,
	"delivery_email" text,
	"delivery_address" text,
	"fee_cents" bigint NOT NULL,
	"currency" text DEFAULT 'TRY' NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"received_by_user_id" text NOT NULL,
	"preparing_at" timestamp with time zone,
	"preparing_by_user_id" text,
	"ready_at" timestamp with time zone,
	"ready_by_user_id" text,
	"document_year" integer,
	"document_sequence" integer,
	"document_content" jsonb,
	"manual_note" text,
	"diploma_file_id" uuid,
	"delivered_at" timestamp with time zone,
	"delivered_by_user_id" text,
	"identity_check_note" text,
	"payment_method" text,
	"paid_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"rejected_by_user_id" text,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "alumni_document_requests_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "alumni_document_requests_document_type_check" CHECK ("alumni_document_requests"."document_type" in ('education_certificate', 'transcript', 'diploma_copy')),
	CONSTRAINT "alumni_document_requests_copies_check" CHECK ("alumni_document_requests"."copies" between 1 and 10),
	CONSTRAINT "alumni_document_requests_channel_check" CHECK ("alumni_document_requests"."channel" in ('in_person', 'phone', 'email', 'petition')),
	CONSTRAINT "alumni_document_requests_requester_kind_check" CHECK ("alumni_document_requests"."requester_kind" in ('self', 'guardian', 'proxy')),
	CONSTRAINT "alumni_document_requests_delivery_method_check" CHECK ("alumni_document_requests"."delivery_method" in ('in_person', 'email', 'cargo')),
	CONSTRAINT "alumni_document_requests_status_check" CHECK ("alumni_document_requests"."status" in ('received', 'preparing', 'ready', 'delivered', 'rejected')),
	CONSTRAINT "alumni_document_requests_payment_method_check" CHECK ("alumni_document_requests"."payment_method" is null or "alumni_document_requests"."payment_method" in ('cash', 'card', 'transfer')),
	CONSTRAINT "alumni_document_requests_currency_check" CHECK ("alumni_document_requests"."currency" = 'TRY'),
	CONSTRAINT "alumni_document_requests_fee_check" CHECK ("alumni_document_requests"."fee_cents" between 0 and 10000000),
	CONSTRAINT "alumni_document_requests_requester_check" CHECK (("alumni_document_requests"."requester_kind" = 'guardian') = ("alumni_document_requests"."guardian_parent_id" is not null)
        and ("alumni_document_requests"."requester_kind" <> 'proxy' or "alumni_document_requests"."authorization_file_id" is not null)
        and ("alumni_document_requests"."requester_kind" <> 'self' or "alumni_document_requests"."authorization_file_id" is null)),
	CONSTRAINT "alumni_document_requests_delivery_check" CHECK (("alumni_document_requests"."delivery_method" = 'email') = ("alumni_document_requests"."delivery_email" is not null)
        and ("alumni_document_requests"."delivery_method" = 'cargo') = ("alumni_document_requests"."delivery_address" is not null)),
	CONSTRAINT "alumni_document_requests_text_check" CHECK (char_length("alumni_document_requests"."requester_name") between 1 and 120
        and ("alumni_document_requests"."delivery_email" is null or char_length("alumni_document_requests"."delivery_email") <= 254)
        and ("alumni_document_requests"."delivery_address" is null or char_length("alumni_document_requests"."delivery_address") <= 500)
        and ("alumni_document_requests"."manual_note" is null or char_length("alumni_document_requests"."manual_note") <= 1000)
        and ("alumni_document_requests"."identity_check_note" is null or char_length("alumni_document_requests"."identity_check_note") between 5 and 500)
        and ("alumni_document_requests"."rejection_reason" is null or char_length("alumni_document_requests"."rejection_reason") between 5 and 500)),
	CONSTRAINT "alumni_document_requests_document_check" CHECK (("alumni_document_requests"."ready_at" is null) = ("alumni_document_requests"."document_sequence" is null)
        and ("alumni_document_requests"."document_year" is null) = ("alumni_document_requests"."document_sequence" is null)
        and ("alumni_document_requests"."document_sequence" is null or "alumni_document_requests"."document_sequence" >= 1)
        and ("alumni_document_requests"."ready_at" is null or ("alumni_document_requests"."document_type" = 'diploma_copy') = ("alumni_document_requests"."diploma_file_id" is not null))
        and ("alumni_document_requests"."ready_at" is null or ("alumni_document_requests"."document_type" = 'diploma_copy') = ("alumni_document_requests"."document_content" is null))),
	CONSTRAINT "alumni_document_requests_lifecycle_check" CHECK (("alumni_document_requests"."status" = 'received' and "alumni_document_requests"."preparing_at" is null and "alumni_document_requests"."ready_at" is null and "alumni_document_requests"."delivered_at" is null and "alumni_document_requests"."rejected_at" is null)
        or ("alumni_document_requests"."status" = 'preparing' and "alumni_document_requests"."preparing_at" is not null and "alumni_document_requests"."ready_at" is null and "alumni_document_requests"."delivered_at" is null and "alumni_document_requests"."rejected_at" is null)
        or ("alumni_document_requests"."status" = 'ready' and "alumni_document_requests"."ready_at" is not null and "alumni_document_requests"."ready_by_user_id" is not null and "alumni_document_requests"."delivered_at" is null and "alumni_document_requests"."rejected_at" is null)
        or ("alumni_document_requests"."status" = 'delivered' and "alumni_document_requests"."ready_at" is not null and "alumni_document_requests"."delivered_at" is not null and "alumni_document_requests"."delivered_by_user_id" is not null and "alumni_document_requests"."identity_check_note" is not null and "alumni_document_requests"."rejected_at" is null)
        or ("alumni_document_requests"."status" = 'rejected' and "alumni_document_requests"."rejected_at" is not null and "alumni_document_requests"."rejected_by_user_id" is not null and "alumni_document_requests"."rejection_reason" is not null and "alumni_document_requests"."delivered_at" is null)),
	CONSTRAINT "alumni_document_requests_payment_check" CHECK (("alumni_document_requests"."paid_at" is null) = ("alumni_document_requests"."payment_method" is null)
        and ("alumni_document_requests"."paid_at" is null or ("alumni_document_requests"."status" = 'delivered' and "alumni_document_requests"."fee_cents" > 0))
        and ("alumni_document_requests"."status" <> 'delivered' or "alumni_document_requests"."fee_cents" = 0 or "alumni_document_requests"."paid_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "alumni_document_fees" ADD CONSTRAINT "alumni_document_fees_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alumni_document_requests" ADD CONSTRAINT "alumni_document_requests_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alumni_document_requests" ADD CONSTRAINT "alumni_document_requests_authorization_file_fkey" FOREIGN KEY ("institution_id","authorization_file_id") REFERENCES "public"."files"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alumni_document_requests" ADD CONSTRAINT "alumni_document_requests_diploma_file_fkey" FOREIGN KEY ("institution_id","diploma_file_id") REFERENCES "public"."files"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alumni_document_requests_number_key" ON "alumni_document_requests" USING btree ("institution_id","document_year","document_sequence") WHERE "alumni_document_requests"."document_sequence" is not null;--> statement-breakpoint
CREATE INDEX "alumni_document_requests_status_idx" ON "alumni_document_requests" USING btree ("institution_id","status");--> statement-breakpoint
CREATE INDEX "alumni_document_requests_student_idx" ON "alumni_document_requests" USING btree ("institution_id","student_id");--> statement-breakpoint
CREATE INDEX "alumni_document_requests_authorization_file_idx" ON "alumni_document_requests" USING btree ("institution_id","authorization_file_id") WHERE "alumni_document_requests"."authorization_file_id" is not null;--> statement-breakpoint
CREATE INDEX "alumni_document_requests_diploma_file_idx" ON "alumni_document_requests" USING btree ("institution_id","diploma_file_id") WHERE "alumni_document_requests"."diploma_file_id" is not null;--> statement-breakpoint
COMMENT ON TABLE "alumni_document_requests" IS 'Mezun ve ayrılan öğrenci belge talebi (DOM-KAY-044, ON-260, K-328…K-331): mezun hesabı olmadığı için talep ön büroya telefon, e-posta, dilekçe ya da şahsen gelir, personel kaydeder. Durum alındı → hazırlanıyor → hazır → teslim edildi ya da reddedildi; her geçiş anını ve kişisini yazar. Hazır olurken yıl bazlı sıralı belge numarası verilir ve içerik dondurulur. Satır silinmez.';--> statement-breakpoint
COMMENT ON COLUMN "alumni_document_requests"."institution_id" IS 'Kurum (institutions).';--> statement-breakpoint
COMMENT ON COLUMN "alumni_document_requests"."id" IS 'Talep kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "alumni_document_requests"."student_id" IS 'Mezun ya da ayrılmış öğrencinin records kimliği (students); yabancı anahtar değildir. Aktif öğrenciye talep açılmaz (öğrenci belgesi DOM-KAY-027).';--> statement-breakpoint
COMMENT ON COLUMN "alumni_document_requests"."document_type" IS 'Belge türü: education_certificate öğrenim belgesi, transcript not dökümü, diploma_copy diploma örneği (yalnız okulda ve mezuna).';--> statement-breakpoint
COMMENT ON COLUMN "alumni_document_requests"."copies" IS 'İstenen adet, 1–10; ücret adetle çarpılır.';--> statement-breakpoint
COMMENT ON COLUMN "alumni_document_requests"."channel" IS 'Talebin geliş yolu: in_person ön büroda, phone telefon, email e-posta, petition dilekçe.';--> statement-breakpoint
COMMENT ON COLUMN "alumni_document_requests"."requester_kind" IS 'Talep eden: self kendisi (reşit değilse kabul edilmez), guardian velisi, proxy vekili (K-328).';--> statement-breakpoint
COMMENT ON COLUMN "alumni_document_requests"."guardian_parent_id" IS 'Talep eden velinin records kimliği (parents); yalnız guardian talebinde dolu. Talep anında velayetli ve iletişim kısıtsız bağ denetlenir.';--> statement-breakpoint
COMMENT ON COLUMN "alumni_document_requests"."requester_name" IS 'Talep edenin adı, talep anının kopyası (öğrenci, veli kaydı ya da vekilin yazılan adı). Kişisel veridir, loglanmaz.';--> statement-breakpoint
COMMENT ON COLUMN "alumni_document_requests"."authorization_file_id" IS 'Vekâletname ya da reşit kişinin velisine verdiği yazılı rıza (files, amaç document, PDF); vekilde zorunlu, kendisinde boş. Dosya talebe bağlanır.';--> statement-breakpoint
COMMENT ON COLUMN "alumni_document_requests"."delivery_method" IS 'Teslim yolu: in_person elden, email e-posta ile PDF, cargo kargo.';--> statement-breakpoint
COMMENT ON COLUMN "alumni_document_requests"."delivery_email" IS 'E-posta ile teslim adresi; yalnız email yolunda dolu. Kişisel veridir.';--> statement-breakpoint
COMMENT ON COLUMN "alumni_document_requests"."delivery_address" IS 'Kargo adresi; yalnız cargo yolunda dolu. Kişisel veridir.';--> statement-breakpoint
COMMENT ON COLUMN "alumni_document_requests"."fee_cents" IS 'Talep anında dondurulan ücret (belge başı kurum ücreti × adet, kuruş); ayar sonradan değişse de değişmez (K-329).';--> statement-breakpoint
COMMENT ON COLUMN "alumni_document_requests"."currency" IS 'Para birimi; yalnız TRY.';--> statement-breakpoint
COMMENT ON COLUMN "alumni_document_requests"."status" IS 'Durum: received, preparing, ready, delivered, rejected (K-330).';--> statement-breakpoint
COMMENT ON COLUMN "alumni_document_requests"."received_by_user_id" IS 'Talebi kaydeden personel.';--> statement-breakpoint
COMMENT ON COLUMN "alumni_document_requests"."preparing_at" IS 'Hazırlanmaya başlandığı an.';--> statement-breakpoint
COMMENT ON COLUMN "alumni_document_requests"."preparing_by_user_id" IS 'Hazırlamaya başlayan personel.';--> statement-breakpoint
COMMENT ON COLUMN "alumni_document_requests"."ready_at" IS 'Belgenin hazır olduğu an; belge numarası ve içerik bu anda yazılır.';--> statement-breakpoint
COMMENT ON COLUMN "alumni_document_requests"."ready_by_user_id" IS 'Belgeyi hazırlayan personel.';--> statement-breakpoint
COMMENT ON COLUMN "alumni_document_requests"."document_year" IS 'Belge numarasının yılı (hazır olduğu günün Europe/Istanbul yılı).';--> statement-breakpoint
COMMENT ON COLUMN "alumni_document_requests"."document_sequence" IS 'Kurumda yıl içindeki sıra; numara MB-<yıl>-<sıra>. Kurumda yıl ve sıra tekildir (alumni_document_requests_number_key).';--> statement-breakpoint
COMMENT ON COLUMN "alumni_document_requests"."document_content" IS 'Öğrenim belgesi ve not dökümünün hazır anındaki içeriği (kurum, ad, okul numarası, kayıt ve ayrılış günü, son sınıf, ders ortalamaları ya da kurlar); diploma örneğinde boş. Kimlik numarası ve doğum tarihi yoktur.';--> statement-breakpoint
COMMENT ON COLUMN "alumni_document_requests"."manual_note" IS 'Kayıtlarda olmayan bilgi için hazırlayanın açıklaması; belgeye yazılır. Kayıtsız not dökümünde zorunludur.';--> statement-breakpoint
COMMENT ON COLUMN "alumni_document_requests"."diploma_file_id" IS 'Diploma örneğinin taranmış dosyası (files, amaç document, PDF). Resmî diploma e-Okul''dan alınır, sisteme otomatik gönderim yoktur (IST-143).';--> statement-breakpoint
COMMENT ON COLUMN "alumni_document_requests"."delivered_at" IS 'Teslim anı.';--> statement-breakpoint
COMMENT ON COLUMN "alumni_document_requests"."delivered_by_user_id" IS 'Teslim eden ve kimliği kontrol eden personel.';--> statement-breakpoint
COMMENT ON COLUMN "alumni_document_requests"."identity_check_note" IS 'Teslimde kimliğin nasıl doğrulandığı (5–500 karakter); teslimde zorunlu. Kişisel veri içerebilir, loglanmaz.';--> statement-breakpoint
COMMENT ON COLUMN "alumni_document_requests"."payment_method" IS 'Ücretin alındığı yöntem (cash, card, transfer); yalnız ücretli teslimde dolu. Tahsilat kaydı açılmaz (K-329, M-50, M-51).';--> statement-breakpoint
COMMENT ON COLUMN "alumni_document_requests"."paid_at" IS 'Ödendi işaretinin anı; ücretli talebin teslimiyle birlikte yazılır.';--> statement-breakpoint
COMMENT ON COLUMN "alumni_document_requests"."rejected_at" IS 'Ret anı.';--> statement-breakpoint
COMMENT ON COLUMN "alumni_document_requests"."rejected_by_user_id" IS 'Reddeden personel.';--> statement-breakpoint
COMMENT ON COLUMN "alumni_document_requests"."rejection_reason" IS 'Ret gerekçesi (5–500 karakter); loglanmaz.';--> statement-breakpoint
COMMENT ON COLUMN "alumni_document_requests"."created_at" IS 'Kaydın oluşturulduğu an (talebin alındığı an).';--> statement-breakpoint
COMMENT ON COLUMN "alumni_document_requests"."updated_at" IS 'Son değişiklik anı.';--> statement-breakpoint
COMMENT ON COLUMN "alumni_document_requests"."archived_at" IS 'Arşiv anı; talep silinmez, bugün arşivlenmez.';--> statement-breakpoint
COMMENT ON COLUMN "alumni_document_requests"."version" IS 'İyimser kilit sürümü (If-Match).';--> statement-breakpoint
COMMENT ON TABLE "alumni_document_fees" IS 'Mezun belge ücretleri (DOM-KAY-044, K-329): kurumun belge türü başına ücreti (kuruş). Satırı olmayan tür ücretsizdir; değişiklik açılmış taleplerin dondurulmuş ücretini değiştirmez. Yalnız yönetici değiştirir.';--> statement-breakpoint
COMMENT ON COLUMN "alumni_document_fees"."institution_id" IS 'Kurum (institutions).';--> statement-breakpoint
COMMENT ON COLUMN "alumni_document_fees"."document_type" IS 'Belge türü (education_certificate, transcript, diploma_copy); kurumda tür başına bir satır.';--> statement-breakpoint
COMMENT ON COLUMN "alumni_document_fees"."fee_cents" IS 'Belge başı ücret, kuruş; 0–1.000.000.';--> statement-breakpoint
COMMENT ON COLUMN "alumni_document_fees"."currency" IS 'Para birimi; yalnız TRY.';--> statement-breakpoint
COMMENT ON COLUMN "alumni_document_fees"."updated_by_user_id" IS 'Ücreti son değiştiren yönetici.';--> statement-breakpoint
COMMENT ON COLUMN "alumni_document_fees"."created_at" IS 'Satırın oluşturulduğu an.';--> statement-breakpoint
COMMENT ON COLUMN "alumni_document_fees"."updated_at" IS 'Son değişiklik anı.';--> statement-breakpoint
COMMENT ON COLUMN "alumni_document_fees"."archived_at" IS 'Arşiv anı; kullanılmaz, ücret 0 yapılarak kaldırılır.';--> statement-breakpoint
COMMENT ON COLUMN "alumni_document_fees"."version" IS 'İyimser kilit sürümü.';
