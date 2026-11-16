CREATE TABLE "donation_campaigns" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"name" text NOT NULL,
	"purpose" text NOT NULL,
	"target_cents" bigint NOT NULL,
	"currency" text DEFAULT 'TRY' NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"bank_account_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"opened_at" timestamp with time zone,
	"opened_by_user_id" text,
	"closed_at" timestamp with time zone,
	"closed_by_user_id" text,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "donation_campaigns_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "donation_campaigns_target_check" CHECK ("donation_campaigns"."target_cents" > 0),
	CONSTRAINT "donation_campaigns_currency_check" CHECK ("donation_campaigns"."currency" = 'TRY'),
	CONSTRAINT "donation_campaigns_dates_check" CHECK ("donation_campaigns"."ends_on" >= "donation_campaigns"."starts_on"),
	CONSTRAINT "donation_campaigns_status_check" CHECK ("donation_campaigns"."status" in ('draft', 'open', 'closed')),
	CONSTRAINT "donation_campaigns_opened_check" CHECK (("donation_campaigns"."status" = 'draft') = ("donation_campaigns"."opened_at" is null) and ("donation_campaigns"."opened_at" is null) = ("donation_campaigns"."opened_by_user_id" is null)),
	CONSTRAINT "donation_campaigns_closed_check" CHECK (("donation_campaigns"."status" = 'closed') = ("donation_campaigns"."closed_at" is not null) and ("donation_campaigns"."closed_at" is null) = ("donation_campaigns"."closed_by_user_id" is null))
);
--> statement-breakpoint
CREATE TABLE "donation_settings" (
	"institution_id" text PRIMARY KEY NOT NULL,
	"tax_notice_enabled" boolean DEFAULT false NOT NULL,
	"tax_notice_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "donation_settings_tax_notice_check" CHECK (not "donation_settings"."tax_notice_enabled" or "donation_settings"."tax_notice_text" is not null)
);
--> statement-breakpoint
CREATE TABLE "donations" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"donor_id" uuid,
	"donor_kind" text,
	"donor_name" text,
	"donor_identity_number" text,
	"kind" text NOT NULL,
	"amount_cents" bigint,
	"currency" text DEFAULT 'TRY' NOT NULL,
	"method" text,
	"bank_account_id" uuid,
	"reference" text,
	"description" text,
	"declared_value_cents" bigint,
	"donated_on" date NOT NULL,
	"note" text,
	"receipt_year" integer NOT NULL,
	"receipt_number" integer NOT NULL,
	"tax_notice" text,
	"recorded_by_user_id" text NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_user_id" text,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "donations_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "donations_kind_check" CHECK ("donations"."kind" in ('cash', 'in_kind')),
	CONSTRAINT "donations_currency_check" CHECK ("donations"."currency" = 'TRY'),
	CONSTRAINT "donations_method_check" CHECK ("donations"."method" is null or "donations"."method" in ('cash', 'bank_transfer', 'card_slip')),
	CONSTRAINT "donations_cash_check" CHECK (("donations"."kind" = 'cash') = ("donations"."amount_cents" is not null and "donations"."method" is not null) and ("donations"."kind" = 'in_kind') = ("donations"."description" is not null)),
	CONSTRAINT "donations_amount_check" CHECK ("donations"."amount_cents" is null or "donations"."amount_cents" > 0),
	CONSTRAINT "donations_declared_value_check" CHECK ("donations"."declared_value_cents" is null or ("donations"."kind" = 'in_kind' and "donations"."declared_value_cents" > 0)),
	CONSTRAINT "donations_bank_account_check" CHECK (("donations"."bank_account_id" is not null) = ("donations"."method" is not null and "donations"."method" = 'bank_transfer')),
	CONSTRAINT "donations_donor_check" CHECK (("donations"."donor_id" is null) = ("donations"."donor_name" is null) and ("donations"."donor_id" is null) = ("donations"."donor_kind" is null) and ("donations"."donor_id" is not null or ("donations"."donor_identity_number" is null and "donations"."tax_notice" is null))),
	CONSTRAINT "donations_cancel_check" CHECK (("donations"."cancelled_at" is null) = ("donations"."cancelled_by_user_id" is null) and ("donations"."cancelled_at" is null) = ("donations"."cancel_reason" is null))
);
--> statement-breakpoint
CREATE TABLE "donors" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"identity_number" text,
	"phone" text,
	"email" text,
	"address" text,
	"student_id" text,
	"relation" text,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "donors_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "donors_kind_check" CHECK ("donors"."kind" in ('person', 'organization')),
	CONSTRAINT "donors_identity_number_check" CHECK ("donors"."identity_number" is null or "donors"."identity_number" ~ '^[0-9]{10,11}$'),
	CONSTRAINT "donors_relation_check" CHECK (("donors"."student_id" is null) = ("donors"."relation" is null) and ("donors"."relation" is null or "donors"."relation" in ('parent', 'alumnus')))
);
--> statement-breakpoint
ALTER TABLE "donation_campaigns" ADD CONSTRAINT "donation_campaigns_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donation_campaigns" ADD CONSTRAINT "donation_campaigns_bank_account_fkey" FOREIGN KEY ("institution_id","bank_account_id") REFERENCES "public"."bank_accounts"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donation_settings" ADD CONSTRAINT "donation_settings_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations" ADD CONSTRAINT "donations_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations" ADD CONSTRAINT "donations_campaign_fkey" FOREIGN KEY ("institution_id","campaign_id") REFERENCES "public"."donation_campaigns"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations" ADD CONSTRAINT "donations_donor_fkey" FOREIGN KEY ("institution_id","donor_id") REFERENCES "public"."donors"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations" ADD CONSTRAINT "donations_bank_account_fkey" FOREIGN KEY ("institution_id","bank_account_id") REFERENCES "public"."bank_accounts"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donors" ADD CONSTRAINT "donors_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "donation_campaigns_name_key" ON "donation_campaigns" USING btree ("institution_id","name") WHERE "donation_campaigns"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "donation_campaigns_bank_account_idx" ON "donation_campaigns" USING btree ("institution_id","bank_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "donations_receipt_key" ON "donations" USING btree ("institution_id","receipt_year","receipt_number");--> statement-breakpoint
CREATE INDEX "donations_campaign_idx" ON "donations" USING btree ("institution_id","campaign_id","donated_on");--> statement-breakpoint
CREATE INDEX "donations_donor_idx" ON "donations" USING btree ("institution_id","donor_id");--> statement-breakpoint
CREATE INDEX "donations_bank_account_idx" ON "donations" USING btree ("institution_id","bank_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "donors_identity_number_key" ON "donors" USING btree ("institution_id","identity_number") WHERE "donors"."identity_number" is not null and "donors"."archived_at" is null;--> statement-breakpoint
-- Elle eklendi (kolon açıklamaları; drizzle-kit üretmez, yeniden üretimde bu blok korunur).
COMMENT ON TABLE "donation_campaigns" IS 'Bağış kampanyası (DOM-FIN-097, ON-258): ad, amaç, hedef, günler ve isteğe bağlı banka hesabı. Durum taslak → açık → kapandı (K-296); toplanan tutar bağışlardan hesaplanır, saklanmaz. Silinmez.';--> statement-breakpoint
COMMENT ON COLUMN "donation_campaigns"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "donation_campaigns"."id" IS 'Kampanya kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "donation_campaigns"."name" IS 'Kampanya adı (2–120 karakter); arşivlenmemiş kampanyalar arasında tekil (donation_campaigns_name_key; servis Türkçe küçük harfle de karşılaştırır).';--> statement-breakpoint
COMMENT ON COLUMN "donation_campaigns"."purpose" IS 'Kampanyanın amacı (5–1000 karakter); makbuzda yazılır.';--> statement-breakpoint
COMMENT ON COLUMN "donation_campaigns"."target_cents" IS 'Hedef tutar, kuruş; sıfırdan büyük. İlerleme geçerli nakdi bağışların bu tutara oranıdır.';--> statement-breakpoint
COMMENT ON COLUMN "donation_campaigns"."currency" IS 'Para birimi; yalnız TRY.';--> statement-breakpoint
COMMENT ON COLUMN "donation_campaigns"."starts_on" IS 'Başlangıç günü (Europe/Istanbul); bağış günü bundan önce olamaz.';--> statement-breakpoint
COMMENT ON COLUMN "donation_campaigns"."ends_on" IS 'Bitiş günü (Europe/Istanbul); başlangıçtan önce olamaz, bağış günü bundan sonra olamaz.';--> statement-breakpoint
COMMENT ON COLUMN "donation_campaigns"."bank_account_id" IS 'Bağışların yatırılacağı kurum banka hesabı (bank_accounts); isteğe bağlı, havale bağışında varsayılan.';--> statement-breakpoint
COMMENT ON COLUMN "donation_campaigns"."status" IS 'Durum: draft (taslak, bağış alınmaz), open (açık), closed (kapandı, bağış alınmaz, geri açılmaz).';--> statement-breakpoint
COMMENT ON COLUMN "donation_campaigns"."opened_at" IS 'Kampanyanın açıldığı an; taslakta boş.';--> statement-breakpoint
COMMENT ON COLUMN "donation_campaigns"."opened_by_user_id" IS 'Kampanyayı açan kullanıcı; opened_at ile birlikte dolar.';--> statement-breakpoint
COMMENT ON COLUMN "donation_campaigns"."closed_at" IS 'Kampanyanın kapandığı an; yalnız closed durumunda dolu.';--> statement-breakpoint
COMMENT ON COLUMN "donation_campaigns"."closed_by_user_id" IS 'Kampanyayı kapatan kullanıcı; closed_at ile birlikte dolar.';--> statement-breakpoint
COMMENT ON COLUMN "donation_campaigns"."created_by_user_id" IS 'Kampanyayı açan (oluşturan) kullanıcı (yönetici).';--> statement-breakpoint
COMMENT ON COLUMN "donation_campaigns"."created_at" IS 'Oluşturulma anı.';--> statement-breakpoint
COMMENT ON COLUMN "donation_campaigns"."updated_at" IS 'Son değişiklik anı.';--> statement-breakpoint
COMMENT ON COLUMN "donation_campaigns"."archived_at" IS 'Arşiv anı; bugün kullanılmaz, kampanya kapatılır.';--> statement-breakpoint
COMMENT ON COLUMN "donation_campaigns"."version" IS 'Kayıt sürümü; düzeltme, açma ve kapatmada If-Match ile denetlenir.';--> statement-breakpoint
COMMENT ON TABLE "donors" IS 'Bağışçı (DOM-FIN-097, K-298): kişi ya da kurum. Kimlik numarası, iletişim ve veli/mezun bağı isteğe bağlıdır; veriyi yalnız yönetici görür, kimlik numarası listede maskelidir (H-38). Anonim bağışçı kaydı yoktur.';--> statement-breakpoint
COMMENT ON COLUMN "donors"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "donors"."id" IS 'Bağışçı kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "donors"."kind" IS 'Bağışçı türü: person (kişi), organization (kurum); sonradan değişmez.';--> statement-breakpoint
COMMENT ON COLUMN "donors"."name" IS 'Kişi adı ya da kurum unvanı (kişide kişisel veri).';--> statement-breakpoint
COMMENT ON COLUMN "donors"."identity_number" IS 'Kişide 11 haneli TCKN, kurumda 10 haneli VKN (şahıs işletmesinde TCKN); isteğe bağlı, kurumda tekil (donors_identity_number_key). Listede son dört hane dışında maskelenir, loglanmaz; tam değer yalnız makbuz ucunda döner.';--> statement-breakpoint
COMMENT ON COLUMN "donors"."phone" IS 'İsteğe bağlı telefon (0XXXXXXXXXX); kişisel veri, loglanmaz.';--> statement-breakpoint
COMMENT ON COLUMN "donors"."email" IS 'İsteğe bağlı e-posta; kişisel veri, loglanmaz.';--> statement-breakpoint
COMMENT ON COLUMN "donors"."address" IS 'İsteğe bağlı adres (10–500 karakter); kişisel veri, loglanmaz.';--> statement-breakpoint
COMMENT ON COLUMN "donors"."student_id" IS 'Bağışçının bağlı olduğu öğrenci (records öğrenci kimliği, mezun dahil); relation ile birlikte dolar.';--> statement-breakpoint
COMMENT ON COLUMN "donors"."relation" IS 'Öğrenciyle bağ: parent (velisi), alumnus (mezun öğrencinin kendisi); student_id ile birlikte dolar.';--> statement-breakpoint
COMMENT ON COLUMN "donors"."created_by_user_id" IS 'Bağışçıyı kaydeden kullanıcı.';--> statement-breakpoint
COMMENT ON COLUMN "donors"."created_at" IS 'Oluşturulma anı.';--> statement-breakpoint
COMMENT ON COLUMN "donors"."updated_at" IS 'Son değişiklik anı.';--> statement-breakpoint
COMMENT ON COLUMN "donors"."archived_at" IS 'Arşiv anı; bugün kullanılmaz.';--> statement-breakpoint
COMMENT ON COLUMN "donors"."version" IS 'Kayıt sürümü; düzeltmede If-Match ile denetlenir.';--> statement-breakpoint
COMMENT ON TABLE "donations" IS 'Bağış ve makbuzu (DOM-FIN-097, K-297): elle girilen nakdi (nakit, havale/EFT, kart slipi) ya da ayni bağış. Her satır kurumda yıl bazlı sıralı makbuz numarasıdır; silinmez, tutarı değişmez, iptal gerekçeyle aynı satıra yazılır ve numara yeniden kullanılmaz. Gün sonuna ve muhasebe aktarımına girmez (M-35).';--> statement-breakpoint
COMMENT ON COLUMN "donations"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "donations"."id" IS 'Bağış kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "donations"."campaign_id" IS 'Bağışın kampanyası (donation_campaigns).';--> statement-breakpoint
COMMENT ON COLUMN "donations"."donor_id" IS 'Bağışçı (donors); anonim bağışta boş.';--> statement-breakpoint
COMMENT ON COLUMN "donations"."donor_kind" IS 'Makbuz anındaki bağışçı türü (kopya); anonimde boş.';--> statement-breakpoint
COMMENT ON COLUMN "donations"."donor_name" IS 'Makbuz anındaki bağışçı adı ya da unvanı (kopya, kişisel veri); bağışçı sonradan düzeltilse de makbuz değişmez. Anonimde boş.';--> statement-breakpoint
COMMENT ON COLUMN "donations"."donor_identity_number" IS 'Makbuz anındaki bağışçı kimlik numarası (kopya, TCKN/VKN); listede maskeli, loglanmaz, tam değer yalnız makbuz ucunda.';--> statement-breakpoint
COMMENT ON COLUMN "donations"."kind" IS 'Bağış türü: cash (nakdi, hedefe sayılır), in_kind (ayni, açıklama ve beyan edilen değerle; hedefe sayılmaz).';--> statement-breakpoint
COMMENT ON COLUMN "donations"."amount_cents" IS 'Nakdi bağış tutarı, kuruş; ayni bağışta boş.';--> statement-breakpoint
COMMENT ON COLUMN "donations"."currency" IS 'Para birimi; yalnız TRY.';--> statement-breakpoint
COMMENT ON COLUMN "donations"."method" IS 'Nakdi bağışın geliş yolu: cash, bank_transfer, card_slip (fiziksel POS slipi; sanal POS yok). Ayni bağışta boş.';--> statement-breakpoint
COMMENT ON COLUMN "donations"."bank_account_id" IS 'Havale/EFT bağışının yattığı kurum hesabı (bank_accounts); yalnız bank_transfer yönteminde dolu.';--> statement-breakpoint
COMMENT ON COLUMN "donations"."reference" IS 'İsteğe bağlı dekont ya da slip numarası (en çok 100 karakter); loglanmaz.';--> statement-breakpoint
COMMENT ON COLUMN "donations"."description" IS 'Ayni bağışın açıklaması (ne, kaç adet; 5–500 karakter); yalnız ayni bağışta dolu.';--> statement-breakpoint
COMMENT ON COLUMN "donations"."declared_value_cents" IS 'Ayni bağışta bağışçının beyan ettiği değer, kuruş; isteğe bağlı, değerleme değildir (M-34).';--> statement-breakpoint
COMMENT ON COLUMN "donations"."donated_on" IS 'Bağışın geldiği gün (Europe/Istanbul); kampanya günleri içinde ve gelecekte değil.';--> statement-breakpoint
COMMENT ON COLUMN "donations"."note" IS 'İsteğe bağlı kısa not (en çok 200 karakter); serbest metin, loglanmaz.';--> statement-breakpoint
COMMENT ON COLUMN "donations"."receipt_year" IS 'Makbuz yılı: kaydın Europe/Istanbul yılı.';--> statement-breakpoint
COMMENT ON COLUMN "donations"."receipt_number" IS 'Makbuz sıra numarası; kurum ve yıl içinde ardışık ve tekil (donations_receipt_key), kurum kilidi altında verilir. Gösterim BM-<yıl>-<sıra>.';--> statement-breakpoint
COMMENT ON COLUMN "donations"."tax_notice" IS 'Makbuza kopyalanan vergi indirimi ibaresi; kurum ayarı açıksa ve bağış anonim değilse dolar, sonradan ayar değişse de makbuz değişmez (K-299, H-37).';--> statement-breakpoint
COMMENT ON COLUMN "donations"."recorded_by_user_id" IS 'Bağışı kaydeden kullanıcı (yönetici).';--> statement-breakpoint
COMMENT ON COLUMN "donations"."cancelled_at" IS 'İptal anı; iptal edilen bağış ilerlemeye girmez, makbuzu İPTAL ibaresiyle kalır.';--> statement-breakpoint
COMMENT ON COLUMN "donations"."cancelled_by_user_id" IS 'İptal eden kullanıcı; cancelled_at ile birlikte dolar.';--> statement-breakpoint
COMMENT ON COLUMN "donations"."cancel_reason" IS 'İptal gerekçesi (5–500 karakter); serbest metin, loglanmaz.';--> statement-breakpoint
COMMENT ON COLUMN "donations"."created_at" IS 'Kayıt anı; makbuzun düzenlenme anı.';--> statement-breakpoint
COMMENT ON COLUMN "donations"."updated_at" IS 'Son değişiklik anı.';--> statement-breakpoint
COMMENT ON COLUMN "donations"."archived_at" IS 'Arşiv anı; bugün kullanılmaz, bağış iptal edilir.';--> statement-breakpoint
COMMENT ON COLUMN "donations"."version" IS 'Kayıt sürümü; iptalde If-Match ile denetlenir.';--> statement-breakpoint
COMMENT ON TABLE "donation_settings" IS 'Kurumun bağış ayarı (DOM-FIN-097, K-299): makbuza yazılacak vergi indirimi ibaresi. Satır yoksa ibare kapalı, sürüm 1 sayılır.';--> statement-breakpoint
COMMENT ON COLUMN "donation_settings"."institution_id" IS 'Kurum (birincil anahtar; kurum başına tek satır).';--> statement-breakpoint
COMMENT ON COLUMN "donation_settings"."tax_notice_enabled" IS 'Vergi indirimi ibaresi makbuza yazılsın mı; varsayılan kapalı (GVK md. 89 / KVK md. 10 kapsamı doğrulanmalı, H-37).';--> statement-breakpoint
COMMENT ON COLUMN "donation_settings"."tax_notice_text" IS 'İbare metni (20–600 karakter); ayar açıkken zorunlu. Kurumun mali müşavirince onaylanmış metin girilir.';--> statement-breakpoint
COMMENT ON COLUMN "donation_settings"."created_at" IS 'Oluşturulma anı.';--> statement-breakpoint
COMMENT ON COLUMN "donation_settings"."updated_at" IS 'Son değişiklik anı.';--> statement-breakpoint
COMMENT ON COLUMN "donation_settings"."archived_at" IS 'Arşiv anı; kullanılmaz.';--> statement-breakpoint
COMMENT ON COLUMN "donation_settings"."version" IS 'Ayar sürümü; değişiklikte If-Match ile denetlenir.';
