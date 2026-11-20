CREATE TABLE "staff_personnel_files" (
	"institution_id" text NOT NULL,
	"membership_id" text NOT NULL,
	"national_id_ciphertext" text,
	"national_id_key_version" integer,
	"birth_date" date,
	"address" text,
	"phone" text,
	"email" text,
	"education" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"iban_ciphertext" text,
	"iban_key_version" integer,
	"bank_account_holder" text,
	"emergency_contacts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by_user_id" text NOT NULL,
	"updated_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "staff_personnel_files_pkey" PRIMARY KEY("institution_id","membership_id"),
	CONSTRAINT "staff_personnel_files_national_id_check" CHECK (("staff_personnel_files"."national_id_ciphertext" is null) = ("staff_personnel_files"."national_id_key_version" is null)
        and ("staff_personnel_files"."national_id_key_version" is null or "staff_personnel_files"."national_id_key_version" > 0)),
	CONSTRAINT "staff_personnel_files_bank_check" CHECK (("staff_personnel_files"."iban_ciphertext" is null) = ("staff_personnel_files"."iban_key_version" is null)
        and ("staff_personnel_files"."iban_ciphertext" is null) = ("staff_personnel_files"."bank_account_holder" is null)
        and ("staff_personnel_files"."iban_key_version" is null or "staff_personnel_files"."iban_key_version" > 0)
        and ("staff_personnel_files"."bank_account_holder" is null or char_length("staff_personnel_files"."bank_account_holder")
          between 2 and 120)),
	CONSTRAINT "staff_personnel_files_address_check" CHECK ("staff_personnel_files"."address" is null or char_length("staff_personnel_files"."address")
        between 10 and 500),
	CONSTRAINT "staff_personnel_files_phone_check" CHECK ("staff_personnel_files"."phone" is null or "staff_personnel_files"."phone" ~ '^0[0-9]{10}$'),
	CONSTRAINT "staff_personnel_files_lists_check" CHECK (jsonb_typeof("staff_personnel_files"."education") = 'array'
        and jsonb_array_length("staff_personnel_files"."education") <= 10
        and jsonb_typeof("staff_personnel_files"."emergency_contacts") = 'array'
        and jsonb_array_length("staff_personnel_files"."emergency_contacts") <= 5)
);
--> statement-breakpoint
ALTER TABLE "staff_personnel_files" ADD CONSTRAINT "staff_personnel_files_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_personnel_files" ADD CONSTRAINT "staff_personnel_files_membership_fkey" FOREIGN KEY ("institution_id","membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
COMMENT ON TABLE "staff_personnel_files" IS 'Personel özlük kartı (DOM-FIN-140; ON-172; K-475…K-477): kurum üyeliği başına tek satır; kimlik, kişisel iletişim, eğitim geçmişi, banka ve acil durum kişileri. Ad, iş e-postası ve rol platform hesabındadır, kopyalanmaz. T.C. kimlik no ve IBAN uygulama düzeyinde şifrelidir. Alan grubu × rol yetkisi core matrisindedir; özlük imhasında (DOM-FIN-122) fiziksel silinir.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_personnel_files"."institution_id" IS 'Kartın kurumu; birincil anahtarın ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_personnel_files"."membership_id" IS 'Kartın personeli (kurum üyeliği; yönetici, öğretmen ya da ön büro). Üyelik başına tek kart; yabancı anahtar restrict.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_personnel_files"."national_id_ciphertext" IS 'Şifreli T.C. kimlik no (kvkk Ç): base64(IV + GCM etiketi + şifreli metin); AAD kurum, üyelik, tablo ve kolona bağlıdır. Okumada maskeli, tam hâli yalnız yöneticiye ve denetimli döner (K-476).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_personnel_files"."national_id_key_version" IS 'T.C. kimlik no şifresinin alan anahtarı sürümü; şifreli değerle birlikte bulunur.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_personnel_files"."birth_date" IS 'Doğum günü (kvkk K); 1920 sonrası, bugünden önce ve en az 14 yaş.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_personnel_files"."address" IS 'Ev adresi (kvkk K; 10–500 karakter).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_personnel_files"."phone" IS 'Kişisel telefon (kvkk K; 0 ile başlayan 11 hane). İş iletişimi platform hesabındadır.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_personnel_files"."email" IS 'Kişisel e-posta (kvkk K); iş e-postası platform hesabındadır.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_personnel_files"."education" IS 'Eğitim geçmişi (kvkk K): düzey, okul, bölüm, mezuniyet yılı satırları; en çok 10, core şemasıyla doğrulanır.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_personnel_files"."iban_ciphertext" IS 'Şifreli TR IBAN (kvkk Ç; mod-97 doğrulanmış): base64(IV + GCM etiketi + şifreli metin). Hiçbir okumada tam dönmez, maskeli gösterilir (K-476).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_personnel_files"."iban_key_version" IS 'IBAN şifresinin alan anahtarı sürümü; şifreli değerle birlikte bulunur.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_personnel_files"."bank_account_holder" IS 'Banka hesabının sahibi (kvkk K; 2–120); IBAN ile birlikte bulunur.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_personnel_files"."emergency_contacts" IS 'Acil durum kişileri (kvkk K): ad, yakınlık, telefon; en çok 5, core şemasıyla doğrulanır.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_personnel_files"."created_by_user_id" IS 'Kartı açan kullanıcı.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_personnel_files"."updated_by_user_id" IS 'Kartı son değiştiren kullanıcı.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_personnel_files"."created_at" IS 'Oluşturulma anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_personnel_files"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_personnel_files"."archived_at" IS 'Arşiv anı; bugün kullanılmaz (kart düzeltilir ya da imhada silinir).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_personnel_files"."version" IS 'Satır sürümü; düzeltmede If-Match ile denetlenir.';
