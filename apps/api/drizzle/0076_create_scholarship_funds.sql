CREATE TABLE "scholarship_fund_allocations" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"fund_id" uuid NOT NULL,
	"award_id" uuid NOT NULL,
	"student_id" text NOT NULL,
	"academic_year" integer NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" text DEFAULT 'TRY' NOT NULL,
	"allocated_on" date NOT NULL,
	"allocated_by_user_id" text NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_user_id" text,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "scholarship_fund_allocations_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "scholarship_fund_allocations_amount_check" CHECK ("scholarship_fund_allocations"."amount_cents" > 0),
	CONSTRAINT "scholarship_fund_allocations_currency_check" CHECK ("scholarship_fund_allocations"."currency" = 'TRY'),
	CONSTRAINT "scholarship_fund_allocations_cancel_check" CHECK (("scholarship_fund_allocations"."cancelled_at" is null) = ("scholarship_fund_allocations"."cancelled_by_user_id" is null) and ("scholarship_fund_allocations"."cancelled_at" is null) = ("scholarship_fund_allocations"."cancel_reason" is null))
);
--> statement-breakpoint
CREATE TABLE "scholarship_fund_donations" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"fund_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" text DEFAULT 'TRY' NOT NULL,
	"donated_on" date NOT NULL,
	"channel" text NOT NULL,
	"note" text,
	"recorded_by_user_id" text NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_user_id" text,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "scholarship_fund_donations_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "scholarship_fund_donations_amount_check" CHECK ("scholarship_fund_donations"."amount_cents" > 0),
	CONSTRAINT "scholarship_fund_donations_currency_check" CHECK ("scholarship_fund_donations"."currency" = 'TRY'),
	CONSTRAINT "scholarship_fund_donations_channel_check" CHECK ("scholarship_fund_donations"."channel" in ('bank_transfer', 'cash', 'other')),
	CONSTRAINT "scholarship_fund_donations_cancel_check" CHECK (("scholarship_fund_donations"."cancelled_at" is null) = ("scholarship_fund_donations"."cancelled_by_user_id" is null) and ("scholarship_fund_donations"."cancelled_at" is null) = ("scholarship_fund_donations"."cancel_reason" is null))
);
--> statement-breakpoint
CREATE TABLE "scholarship_funds" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"donor_kind" text NOT NULL,
	"donor_name" text,
	"closed_at" timestamp with time zone,
	"closed_by_user_id" text,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "scholarship_funds_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "scholarship_funds_donor_kind_check" CHECK ("scholarship_funds"."donor_kind" in ('person', 'organization', 'anonymous')),
	CONSTRAINT "scholarship_funds_donor_name_check" CHECK (("scholarship_funds"."donor_kind" = 'anonymous') = ("scholarship_funds"."donor_name" is null)),
	CONSTRAINT "scholarship_funds_closed_check" CHECK (("scholarship_funds"."closed_at" is null) = ("scholarship_funds"."closed_by_user_id" is null))
);
--> statement-breakpoint
ALTER TABLE "scholarship_fund_allocations" ADD CONSTRAINT "scholarship_fund_allocations_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scholarship_fund_allocations" ADD CONSTRAINT "scholarship_fund_allocations_fund_fkey" FOREIGN KEY ("institution_id","fund_id") REFERENCES "public"."scholarship_funds"("institution_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scholarship_fund_allocations" ADD CONSTRAINT "scholarship_fund_allocations_award_fkey" FOREIGN KEY ("institution_id","award_id") REFERENCES "public"."scholarship_awards"("institution_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scholarship_fund_donations" ADD CONSTRAINT "scholarship_fund_donations_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scholarship_fund_donations" ADD CONSTRAINT "scholarship_fund_donations_fund_fkey" FOREIGN KEY ("institution_id","fund_id") REFERENCES "public"."scholarship_funds"("institution_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scholarship_funds" ADD CONSTRAINT "scholarship_funds_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scholarship_fund_allocations_fund_award_key" ON "scholarship_fund_allocations" USING btree ("institution_id","fund_id","award_id") WHERE "scholarship_fund_allocations"."cancelled_at" is null and "scholarship_fund_allocations"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "scholarship_fund_allocations_fund_idx" ON "scholarship_fund_allocations" USING btree ("institution_id","fund_id");--> statement-breakpoint
CREATE INDEX "scholarship_fund_allocations_award_idx" ON "scholarship_fund_allocations" USING btree ("institution_id","award_id");--> statement-breakpoint
CREATE INDEX "scholarship_fund_donations_fund_idx" ON "scholarship_fund_donations" USING btree ("institution_id","fund_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scholarship_funds_name_key" ON "scholarship_funds" USING btree ("institution_id","name") WHERE "scholarship_funds"."archived_at" is null and "scholarship_funds"."closed_at" is null;--> statement-breakpoint
-- Elle eklendi (kolon açıklamaları; drizzle-kit üretmez, yeniden üretimde bu blok korunur).
COMMENT ON TABLE "scholarship_funds" IS 'Bağış kaynaklı burs fonu (DOM-FIN-068, ON-259). Bakiye bağış ve atama satırlarından hesaplanır, saklanmaz. Silinmez; sıfır bakiyede kapanır (closed_at).';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_funds"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_funds"."id" IS 'Fon kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_funds"."name" IS 'Fon adı; kurumun açık fonları arasında tekil (scholarship_funds_name_key).';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_funds"."description" IS 'İsteğe bağlı açıklama (en çok 1000 karakter).';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_funds"."donor_kind" IS 'Bağışçı türü: person (kişi), organization (kurum), anonymous (anonim). K-95.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_funds"."donor_name" IS 'Bağışçının adı ya da kurum adı (kişide kişisel veri); anonimde boş. İletişim ve kimlik numarası tutulmaz (K-95).';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_funds"."closed_at" IS 'Fonun kapandığı an; kapalı fona bağış ve atama yapılmaz. Yalnız sıfır bakiyede kapanır.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_funds"."closed_by_user_id" IS 'Fonu kapatan kullanıcı; closed_at ile birlikte dolar.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_funds"."created_by_user_id" IS 'Fonu açan kullanıcı (yönetici).';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_funds"."created_at" IS 'Oluşturulma anı.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_funds"."updated_at" IS 'Son değişiklik anı.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_funds"."archived_at" IS 'Arşiv anı; bugün kullanılmaz, fon kapatılır.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_funds"."version" IS 'Kayıt sürümü; kapanışta If-Match ile denetlenir.';--> statement-breakpoint
COMMENT ON TABLE "scholarship_fund_donations" IS 'Burs fonuna bağış girişi (DOM-FIN-068). Silinmez, gerekçeyle iptal edilir; bakiyeyi eksiye düşürecek iptal reddedilir (K-97). Makbuz ve vergi belgesi değildir (M-21).';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_fund_donations"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_fund_donations"."id" IS 'Bağış kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_fund_donations"."fund_id" IS 'Bağışın girdiği fon (scholarship_funds).';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_fund_donations"."amount_cents" IS 'Bağış tutarı, kuruş; sıfırdan büyük.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_fund_donations"."currency" IS 'Para birimi; yalnız TRY.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_fund_donations"."donated_on" IS 'Bağışın geldiği gün (Europe/Istanbul); gelecek gün girilemez.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_fund_donations"."channel" IS 'Bağışın kaynağı: bank_transfer, cash, other.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_fund_donations"."note" IS 'İsteğe bağlı kısa not (dekont numarası vb., en çok 200 karakter); serbest metin, loglanmaz.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_fund_donations"."recorded_by_user_id" IS 'Bağışı giren kullanıcı.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_fund_donations"."cancelled_at" IS 'İptal anı; iptal edilen bağış bakiyeye girmez.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_fund_donations"."cancelled_by_user_id" IS 'İptal eden kullanıcı; cancelled_at ile birlikte dolar.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_fund_donations"."cancel_reason" IS 'İptal gerekçesi (5–500 karakter); serbest metin, loglanmaz.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_fund_donations"."created_at" IS 'Giriş anı; aynı gündeki hareketlerin sırası.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_fund_donations"."updated_at" IS 'Son değişiklik anı.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_fund_donations"."archived_at" IS 'Arşiv anı; bugün kullanılmaz, bağış iptal edilir.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_fund_donations"."version" IS 'Kayıt sürümü; iptalde If-Match ile denetlenir.';--> statement-breakpoint
COMMENT ON TABLE "scholarship_fund_allocations" IS 'Fondan burs ataması (DOM-FIN-068): mevcut burs atamasının (scholarship_awards, DOM-FIN-025) fondan karşılanan kısmı; sözleşme ve taksit değişmez. Atama fon bakiyesini ve bursun karşılanmamış kısmını aşamaz (kurum kilidi altında, K-96). İptal bakiyeyi geri verir.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_fund_allocations"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_fund_allocations"."id" IS 'Atama kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_fund_allocations"."fund_id" IS 'Karşılayan fon (scholarship_funds).';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_fund_allocations"."award_id" IS 'Karşılanan burs ataması (scholarship_awards). Aynı fondan aynı bursa tek geçerli atama (scholarship_fund_allocations_fund_award_key).';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_fund_allocations"."student_id" IS 'Burslu öğrenci (records kimliği, kişisel veri); burs atamasından kopyalanır.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_fund_allocations"."academic_year" IS 'Bursun eğitim yılı (başlangıç yılı); burs atamasından kopyalanır.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_fund_allocations"."amount_cents" IS 'Fondan karşılanan tutar, kuruş; sıfırdan büyük.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_fund_allocations"."currency" IS 'Para birimi; yalnız TRY.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_fund_allocations"."allocated_on" IS 'Atama günü (Europe/Istanbul).';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_fund_allocations"."allocated_by_user_id" IS 'Atamayı yapan kullanıcı (yönetici).';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_fund_allocations"."cancelled_at" IS 'İptal anı; iptal edilen atama bakiyeden düşmez.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_fund_allocations"."cancelled_by_user_id" IS 'İptal eden kullanıcı; cancelled_at ile birlikte dolar.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_fund_allocations"."cancel_reason" IS 'İptal gerekçesi (5–500 karakter); serbest metin, loglanmaz.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_fund_allocations"."created_at" IS 'Giriş anı; aynı gündeki hareketlerin sırası.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_fund_allocations"."updated_at" IS 'Son değişiklik anı.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_fund_allocations"."archived_at" IS 'Arşiv anı; bugün kullanılmaz, atama iptal edilir.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_fund_allocations"."version" IS 'Kayıt sürümü; iptalde If-Match ile denetlenir.';