CREATE TABLE "staff_certificates" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"membership_id" text NOT NULL,
	"kind" text NOT NULL,
	"certificate_year" integer NOT NULL,
	"certificate_number" integer NOT NULL,
	"institution_name" text NOT NULL,
	"staff_name" text NOT NULL,
	"position" text NOT NULL,
	"identity_number" text,
	"hire_date" date NOT NULL,
	"exit_date" date,
	"addressee" text NOT NULL,
	"wage_rate_type" text,
	"wage_amount_cents" bigint,
	"currency" text DEFAULT 'TRY' NOT NULL,
	"issued_by_user_id" text NOT NULL,
	"issued_by_name" text NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_user_id" text,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "staff_certificates_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "staff_certificates_kind_check" CHECK ("staff_certificates"."kind" in ('employment', 'service')),
	CONSTRAINT "staff_certificates_number_check" CHECK ("staff_certificates"."certificate_year" between 2000 and 2999 and "staff_certificates"."certificate_number" > 0),
	CONSTRAINT "staff_certificates_position_check" CHECK (char_length("staff_certificates"."position") between 2 and 120),
	CONSTRAINT "staff_certificates_addressee_check" CHECK (char_length("staff_certificates"."addressee") between 1 and 200),
	CONSTRAINT "staff_certificates_identity_number_check" CHECK ("staff_certificates"."identity_number" is null or "staff_certificates"."identity_number" ~ '^[1-9][0-9]{10}$'),
	CONSTRAINT "staff_certificates_dates_check" CHECK ((("staff_certificates"."kind" = 'service') = ("staff_certificates"."exit_date" is not null))
        and ("staff_certificates"."exit_date" is null or "staff_certificates"."exit_date" >= "staff_certificates"."hire_date")),
	CONSTRAINT "staff_certificates_wage_check" CHECK ((("staff_certificates"."wage_rate_type" is null) = ("staff_certificates"."wage_amount_cents" is null))
        and ("staff_certificates"."wage_rate_type" is null or ("staff_certificates"."kind" = 'employment'
          and "staff_certificates"."wage_rate_type" in ('monthly_gross', 'monthly_net', 'hourly', 'lesson_hour') and "staff_certificates"."wage_amount_cents" > 0))),
	CONSTRAINT "staff_certificates_currency_check" CHECK ("staff_certificates"."currency" = 'TRY'),
	CONSTRAINT "staff_certificates_cancel_check" CHECK ((("staff_certificates"."cancelled_at" is null) = ("staff_certificates"."cancelled_by_user_id" is null))
        and (("staff_certificates"."cancelled_at" is null) = ("staff_certificates"."cancel_reason" is null))
        and ("staff_certificates"."cancel_reason" is null or char_length("staff_certificates"."cancel_reason")
          between 5 and 500))
);
--> statement-breakpoint
ALTER TABLE "staff_certificates" ADD CONSTRAINT "staff_certificates_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_certificates" ADD CONSTRAINT "staff_certificates_membership_fkey" FOREIGN KEY ("institution_id","membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_certificates_number_key" ON "staff_certificates" USING btree ("institution_id","certificate_year","certificate_number");--> statement-breakpoint
CREATE INDEX "staff_certificates_membership_idx" ON "staff_certificates" USING btree ("institution_id","membership_id","created_at");--> statement-breakpoint
-- Elle yazıldı: üretilen belgenin içeriği dondurulur (DOM-FIN-106, K-341). Yalnız iptal alanları
-- (cancelled_at, cancelled_by_user_id, cancel_reason) ile updated_at ve version değişebilir; belge
-- silinmez ve tablo boşaltılmaz. Ortak `kampus_reject_immutable_change()` (migration 0013, 55000).
CREATE TRIGGER "staff_certificates_frozen_trigger" BEFORE UPDATE ON "staff_certificates" FOR EACH ROW
WHEN (
  (OLD."institution_id", OLD."id", OLD."membership_id", OLD."kind", OLD."certificate_year",
    OLD."certificate_number", OLD."institution_name", OLD."staff_name", OLD."position",
    OLD."identity_number", OLD."hire_date", OLD."exit_date", OLD."addressee", OLD."wage_rate_type",
    OLD."wage_amount_cents", OLD."currency", OLD."issued_by_user_id", OLD."issued_by_name",
    OLD."created_at", OLD."archived_at")
  IS DISTINCT FROM
  (NEW."institution_id", NEW."id", NEW."membership_id", NEW."kind", NEW."certificate_year",
    NEW."certificate_number", NEW."institution_name", NEW."staff_name", NEW."position",
    NEW."identity_number", NEW."hire_date", NEW."exit_date", NEW."addressee", NEW."wage_rate_type",
    NEW."wage_amount_cents", NEW."currency", NEW."issued_by_user_id", NEW."issued_by_name",
    NEW."created_at", NEW."archived_at")
  OR (OLD."cancelled_at" IS NOT NULL AND (OLD."cancelled_at", OLD."cancelled_by_user_id", OLD."cancel_reason")
    IS DISTINCT FROM (NEW."cancelled_at", NEW."cancelled_by_user_id", NEW."cancel_reason"))
)
EXECUTE FUNCTION "kampus_reject_immutable_change"();--> statement-breakpoint
CREATE TRIGGER "staff_certificates_delete_trigger" BEFORE DELETE ON "staff_certificates" FOR EACH ROW EXECUTE FUNCTION "kampus_reject_immutable_change"();--> statement-breakpoint
CREATE TRIGGER "staff_certificates_truncate_trigger" BEFORE TRUNCATE ON "staff_certificates" FOR EACH STATEMENT EXECUTE FUNCTION "kampus_reject_immutable_change"();--> statement-breakpoint
COMMENT ON TRIGGER "staff_certificates_frozen_trigger" ON "staff_certificates" IS 'Üretilmiş personel belgesinin içeriğinin değişmesini ve iptalin geri alınmasını reddeder; yalnız ilk iptal yazılır (DOM-FIN-106, K-341).';
--> statement-breakpoint
COMMENT ON TABLE "staff_certificates" IS 'Personel çalışma ve hizmet belgesi (DOM-FIN-106, ON-175, K-340…K-343). Her satır bir üretimdir: çalışma belgesi etkin personele (görev, işe giriş, isteğe bağlı ücret, muhatap), hizmet belgesi ayrılan personele (giriş–çıkış, görev; 4857 md. 28). İçerik üretim anında kopyalanır ve tetikleyiciyle dondurulur; personel ya da ücret sonradan değişse de belge aynı kalır. Numara kurumda yıl bazlı ardışıktır (PB-yıl-sıra, iki tür ortak). Belge silinmez, gerekçeyle iptal edilir. Yalnız yönetici üretir ve okur; T.C. kimlik no ve ücret yalnız belge ucunda döner, her okuma denetim kaydına yazılır.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_certificates"."institution_id" IS 'Kurum.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_certificates"."id" IS 'Belge kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_certificates"."membership_id" IS 'Belgenin düzenlendiği personelin kurum üyeliği (memberships; yönetici, öğretmen ya da ön büro). Üyelik silinirse belge korunur: restrict.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_certificates"."kind" IS 'Tür: employment çalışma belgesi (etkin personel), service hizmet belgesi (ayrılan personel).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_certificates"."certificate_year" IS 'Belge numarasının yılı: üretim gününün Europe/Istanbul yılı.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_certificates"."certificate_number" IS 'Yıl içindeki sıra (1''den başlar); kurum, yıl ve sıra tekildir, iki tür ortak sıradadır. İptal edilen belgenin numarası yeniden kullanılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_certificates"."institution_name" IS 'Üretim anındaki kurum adı (belge başlığı); kurum adı sonradan değişse de belge aynı kalır.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_certificates"."staff_name" IS 'Üretim anındaki personel adı (kullanıcı adından kopya). Kişisel veri.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_certificates"."position" IS 'Görev ya da unvan (2–120 karakter); personel kaydında olmadığı için yönetici elle girer.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_certificates"."identity_number" IS 'İsteğe bağlı T.C. kimlik no (11 hane, kontrol haneli). Maskesiz yalnız belge ucunda döner; listede ve logda yoktur, okuma denetim kaydına yazılır.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_certificates"."hire_date" IS 'İşe giriş günü (elle girilir); bugünden sonra olamaz.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_certificates"."exit_date" IS 'İşten ayrılış günü (dahil); yalnız hizmet belgesinde ve orada zorunlu, işe girişten önce olamaz.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_certificates"."addressee" IS 'Muhatap (1–200 karakter); yönetici yazmazsa "İlgili makama".';
--> statement-breakpoint
COMMENT ON COLUMN "staff_certificates"."wage_rate_type" IS 'Belgeye yazılan ana ücretin türü (monthly_gross, monthly_net, hourly, lesson_hour); yalnız çalışma belgesinde ve ücret istenmişse, düzenleme günündeki ücret tanımından (DOM-FIN-099) kopya.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_certificates"."wage_amount_cents" IS 'Belgeye yazılan ana ücret, kuruş; tür ile birlikte dolu ya da boş. Kişisel veri; loga ve denetim kaydına yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_certificates"."currency" IS 'Para birimi; yalnız TRY.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_certificates"."issued_by_user_id" IS 'Belgeyi düzenleyen yöneticinin kullanıcı kimliği.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_certificates"."issued_by_name" IS 'Düzenleyenin üretim anındaki adı (belgenin imza alanı).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_certificates"."cancelled_at" IS 'İptal anı; boşsa belge geçerlidir. Bir kez yazılır, geri alınmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_certificates"."cancelled_by_user_id" IS 'Belgeyi iptal eden yöneticinin kullanıcı kimliği.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_certificates"."cancel_reason" IS 'İptal gerekçesi (5–500 karakter); denetim kaydına ve loga yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_certificates"."created_at" IS 'Üretim anı (UTC); belgenin düzenleme tarihi.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_certificates"."updated_at" IS 'Son değişiklik anı (yalnız iptal).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_certificates"."archived_at" IS 'Kullanılmaz: belge silinmez ve arşivlenmez, iptal cancelled_at ile izlenir (zorunlu kolon).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_certificates"."version" IS 'İyimser kilit sürümü (If-Match); iptalde artar.';
