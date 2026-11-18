CREATE TABLE "staff_leave_profiles" (
	"institution_id" text NOT NULL,
	"membership_id" text NOT NULL,
	"seniority_start_date" date NOT NULL,
	"birth_date" date,
	"opening_balance_date" date,
	"opening_balance_days" integer,
	"updated_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "staff_leave_profiles_pkey" PRIMARY KEY("institution_id","membership_id"),
	CONSTRAINT "staff_leave_profiles_opening_check" CHECK (("staff_leave_profiles"."opening_balance_date" is null) = ("staff_leave_profiles"."opening_balance_days" is null)
        and ("staff_leave_profiles"."opening_balance_days" is null or "staff_leave_profiles"."opening_balance_days"
          between -366 and 999)
        and ("staff_leave_profiles"."opening_balance_date" is null
          or "staff_leave_profiles"."opening_balance_date" >= "staff_leave_profiles"."seniority_start_date")),
	CONSTRAINT "staff_leave_profiles_birth_check" CHECK ("staff_leave_profiles"."birth_date" is null or "staff_leave_profiles"."birth_date" < "staff_leave_profiles"."seniority_start_date")
);
--> statement-breakpoint
CREATE TABLE "staff_leave_records" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"membership_id" text NOT NULL,
	"type_code" text NOT NULL,
	"kind" text NOT NULL,
	"type_label" text NOT NULL,
	"paid" boolean NOT NULL,
	"deducts_from_annual" boolean NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"days" integer NOT NULL,
	"note" text,
	"created_by_user_id" text NOT NULL,
	"cancel_reason" text,
	"cancelled_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "staff_leave_records_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "staff_leave_records_kind_check" CHECK ("staff_leave_records"."kind" in ('annual', 'excuse', 'unpaid', 'sick', 'other') and "staff_leave_records"."kind" <> 'sick'),
	CONSTRAINT "staff_leave_records_dates_check" CHECK ("staff_leave_records"."end_date" >= "staff_leave_records"."start_date"
        and "staff_leave_records"."days" between 1 and least(366,
          "staff_leave_records"."end_date" - "staff_leave_records"."start_date" + 1)),
	CONSTRAINT "staff_leave_records_label_check" CHECK (char_length("staff_leave_records"."type_label") between 2 and 80),
	CONSTRAINT "staff_leave_records_note_check" CHECK ("staff_leave_records"."note" is null or char_length("staff_leave_records"."note") between 1 and 200),
	CONSTRAINT "staff_leave_records_cancel_check" CHECK ((("staff_leave_records"."archived_at" is null) = ("staff_leave_records"."cancel_reason" is null))
        and (("staff_leave_records"."archived_at" is null) = ("staff_leave_records"."cancelled_by_user_id" is null))
        and ("staff_leave_records"."cancel_reason" is null or char_length("staff_leave_records"."cancel_reason")
          between 5 and 500))
);
--> statement-breakpoint
CREATE TABLE "staff_leave_types" (
	"institution_id" text NOT NULL,
	"code" text NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"paid" boolean NOT NULL,
	"deducts_from_annual" boolean NOT NULL,
	"default_days" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"updated_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "staff_leave_types_pkey" PRIMARY KEY("institution_id","code"),
	CONSTRAINT "staff_leave_types_kind_check" CHECK ("staff_leave_types"."kind" in ('annual', 'excuse', 'unpaid', 'sick', 'other')),
	CONSTRAINT "staff_leave_types_code_check" CHECK ("staff_leave_types"."code" ~ '^[a-z][a-z0-9_]{1,39}$'),
	CONSTRAINT "staff_leave_types_label_check" CHECK (char_length("staff_leave_types"."label") between 2 and 80),
	CONSTRAINT "staff_leave_types_days_check" CHECK ("staff_leave_types"."default_days" is null or "staff_leave_types"."default_days" between 1 and 366),
	CONSTRAINT "staff_leave_types_rules_check" CHECK (("staff_leave_types"."kind" <> 'annual' or ("staff_leave_types"."paid" and "staff_leave_types"."deducts_from_annual"))
        and ("staff_leave_types"."kind" <> 'unpaid' or not ("staff_leave_types"."paid" or "staff_leave_types"."deducts_from_annual"))
        and ("staff_leave_types"."kind" <> 'sick' or not "staff_leave_types"."deducts_from_annual"))
);
--> statement-breakpoint
ALTER TABLE "staff_leave_profiles" ADD CONSTRAINT "staff_leave_profiles_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_leave_profiles" ADD CONSTRAINT "staff_leave_profiles_membership_fkey" FOREIGN KEY ("institution_id","membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_leave_records" ADD CONSTRAINT "staff_leave_records_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_leave_records" ADD CONSTRAINT "staff_leave_records_membership_fkey" FOREIGN KEY ("institution_id","membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_leave_types" ADD CONSTRAINT "staff_leave_types_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_leave_records_membership_idx" ON "staff_leave_records" USING btree ("institution_id","membership_id","start_date");--> statement-breakpoint
COMMENT ON TABLE "staff_leave_types" IS 'Kurumun izin türü ayarı (DOM-FIN-109, ON-181, K-361). Varsayılan türler (yıllık, Ek md. 2 mazeret izinleri, ücretsiz, rapor, diğer) kodda durur; satır yalnız kurum bir varsayılanı ayarlayınca ya da ek tür açınca yazılır. Yasanın sabitlediği alanlar (yıllık izin ücretli ve yıllıktan düşer; mazeret ücretli, yıllıktan düşmez, yasal günün altına inmez; ücretsiz izin ücretsiz; rapor yıllıktan düşmez) servis ve denetimlerle korunur.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_types"."institution_id" IS 'Kurum.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_types"."code" IS 'Tür kodu: varsayılan türde sabit ad (annual, marriage, adoption, bereavement, paternity, child_treatment, unpaid, sick, other), kurumun ek türünde custom_ önekli. Kullanılmış izin kaydı bu kodu taşır.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_types"."kind" IS 'Biçim: annual yıllık, excuse mazeret, unpaid ücretsiz, sick rapor, other diğer. Ek tür yalnız excuse, unpaid ya da other olur.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_types"."label" IS 'Kurumdaki görünen ad (2–80 karakter); kurumda büyük-küçük harf duyarsız tekil (servis denetimi).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_types"."paid" IS 'İzin günleri ücretli mi. Rapor için kurum SGK ödeneğine ek ücret farkı ödüyorsa doğrudur.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_types"."deducts_from_annual" IS 'Kullanılan gün yıllık izin bakiyesinden düşer mi.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_types"."default_days" IS 'Varsayılan gün (bilgi; kayıtta gün elle girilir). Yasal mazerette yasal günün altına inemez; boşsa sınırsız.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_types"."is_active" IS 'Kapalı tür yeni kayıtta seçilmez; yıllık izin ve rapor kapatılamaz.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_types"."updated_by_user_id" IS 'Ayarı son yazan yönetici.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_types"."created_at" IS 'Kaydın açıldığı an (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_types"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_types"."archived_at" IS 'Kullanılmaz (tür silinmez, kapatılır); zorunlu kolon.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_types"."version" IS 'İyimser kilit sürümü (If-Match; hiç yazılmamış varsayılan tür 1 sayılır, ilk ayar satırı 2 ile açılır).';
--> statement-breakpoint
COMMENT ON TABLE "staff_leave_profiles" IS 'Personelin izin profili (DOM-FIN-109, ON-181, K-360): kıdem başlangıcı, yaş kuralı için doğum günü ve açılış devri. Personel kaydı ayrı tablo olmadığından kurumda elle girilir; kıdem başlangıcı personel belgesi ve kıdem hesaplayıcısı için önerilen ortak kaynaktır. Üyelik başına tek satır.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_profiles"."institution_id" IS 'Kurum.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_profiles"."membership_id" IS 'Personelin kurum üyeliği (memberships; yönetici, öğretmen ya da ön büro). Üyelik silinirse profil korunur: restrict.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_profiles"."seniority_start_date" IS 'Kıdem başlangıcı (işe giriş günü, deneme süresi dahil). Her yıl dönümü bir yıllık izin hak ediş günüdür; 1960 öncesi ve bugünden sonrası olamaz. Kişisel veri.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_profiles"."birth_date" IS 'Doğum günü; yalnız 18 yaşından küçük ve 50 yaş ve üstü en az 20 gün kuralı için. Boşsa kural uygulanmaz. Kişisel veri; loga ve denetim kaydına yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_profiles"."opening_balance_date" IS 'Açılış devrinin günü: bu güne kadarki hak ediş ve kullanım opening_balance_days içindedir. Kıdem başlangıcından önce olamaz; boşsa devir yok.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_profiles"."opening_balance_days" IS 'Açılış günü sonundaki kalan yıllık izin (gün, −366…999; eksi avans izindir). Tarihle birlikte doludur.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_profiles"."updated_by_user_id" IS 'Profili son yazan yönetici.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_profiles"."created_at" IS 'Kaydın açıldığı an (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_profiles"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_profiles"."archived_at" IS 'Kullanılmaz (profil silinmez); zorunlu kolon.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_profiles"."version" IS 'İyimser kilit sürümü (If-Match).';
--> statement-breakpoint
COMMENT ON TABLE "staff_leave_records" IS 'Kullanılmış izin kaydı (DOM-FIN-109, ON-181, K-362). Talep ve onay akışı (ON-182) gelene kadar yönetici elle yazar. Tür ayarının anlık kopyasını taşır; ayar sonradan değişse de bakiye geçmişi değişmez. Aynı personelde aralıklar çakışmaz (kurum kilidi altında servis denetimi). Düzeltilmez, gerekçeyle iptal edilir. Rapor (sağlık verisi) bu tabloya yazılmaz; sağlık raporu kaydındadır (ON-185).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_records"."institution_id" IS 'Kurum.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_records"."id" IS 'Kayıt kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_records"."membership_id" IS 'İzni kullanan personelin kurum üyeliği. Üyelik silinirse kayıt korunur: restrict.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_records"."type_code" IS 'Kayıt anındaki izin türü kodu (staff_leave_types.code ya da varsayılan tür).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_records"."kind" IS 'Kayıt anındaki tür biçimi (annual, excuse, unpaid, other); sick yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_records"."type_label" IS 'Kayıt anındaki tür adı (kopya).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_records"."paid" IS 'Kayıt anında tür ücretli miydi (kopya).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_records"."deducts_from_annual" IS 'Kayıt anında tür yıllık izinden düşüyor muydu (kopya); bakiye hesabı bunu okur.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_records"."start_date" IS 'İznin ilk günü.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_records"."end_date" IS 'İznin son günü (dahil).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_records"."days" IS 'Kullanılan iş günü (hafta tatili ve genel tatil hariç; elle). 1 ile aralığın takvim günü arasında.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_records"."note" IS 'İsteğe bağlı not (1–200 karakter); denetim kaydına yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_records"."created_by_user_id" IS 'Kaydı yazan yönetici.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_records"."cancel_reason" IS 'İptal gerekçesi (5–500 karakter); yalnız iptal edilmiş kayıtta. Denetim kaydına yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_records"."cancelled_by_user_id" IS 'Kaydı iptal eden yönetici.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_records"."created_at" IS 'Kaydın açıldığı an (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_records"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_records"."archived_at" IS 'İptal anı; iptal edilen kayıt bakiyeye sayılmaz ve listelenmez.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_records"."version" IS 'İyimser kilit sürümü (If-Match).';
