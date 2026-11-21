CREATE TABLE "emergency_summaries" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"student_id" text NOT NULL,
	"published_ciphertext" text,
	"published_key_version" integer,
	"draft_ciphertext" text,
	"draft_key_version" integer,
	"reviewed_profile_version" integer,
	"reviewed_profile_updated_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"approved_by_user_id" text,
	"created_by_user_id" text NOT NULL,
	"updated_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "emergency_summaries_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "emergency_summaries_texts_check" CHECK ((("emergency_summaries"."published_ciphertext" is null) = ("emergency_summaries"."published_key_version" is null))
        and (("emergency_summaries"."draft_ciphertext" is null) = ("emergency_summaries"."draft_key_version" is null))
        and ("emergency_summaries"."published_ciphertext" is not null or "emergency_summaries"."draft_ciphertext" is not null)
        and ("emergency_summaries"."published_key_version" is null or "emergency_summaries"."published_key_version" > 0)
        and ("emergency_summaries"."draft_key_version" is null or "emergency_summaries"."draft_key_version" > 0)),
	CONSTRAINT "emergency_summaries_approval_check" CHECK ((("emergency_summaries"."published_ciphertext" is null) = ("emergency_summaries"."approved_at" is null))
        and (("emergency_summaries"."approved_at" is null) = ("emergency_summaries"."approved_by_user_id" is null))
        and (("emergency_summaries"."approved_at" is null) = ("emergency_summaries"."reviewed_profile_version" is null))
        and ("emergency_summaries"."reviewed_profile_version" is null or "emergency_summaries"."reviewed_profile_version" > 0)
        and ("emergency_summaries"."approved_at" is not null or "emergency_summaries"."reviewed_profile_updated_at" is null))
);
--> statement-breakpoint
ALTER TABLE "emergency_summaries" ADD CONSTRAINT "emergency_summaries_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "emergency_summaries_student_key" ON "emergency_summaries" USING btree ("institution_id","student_id") WHERE "emergency_summaries"."archived_at" is null;--> statement-breakpoint
COMMENT ON TABLE "emergency_summaries" IS 'Acil durum özeti (DOM-FIN-155, ON-165, K-520…K-522): öğrencinin sınıf öğretmeni, derse giren öğretmen, ön büro ve yöneticiye gösterilen en az bilgili acil eylem metni. Yönetici yazar ve onaylar; onaydan önce görünmez, düzeltme onaylanana kadar yayındaki metin görünür. Öğrenci başına bir etkin satır. Uyarı işaretleri, bugünkü ilaç ve acil iletişim her okumada sağlık profili, revir ilaç onayı ve veli bağından türetilir; sağlık profili kopyalanmaz. Her okuma öğrenci başına denetime düşer.';
--> statement-breakpoint
COMMENT ON COLUMN "emergency_summaries"."institution_id" IS 'Kurum; birincil anahtarın ve her indeksin ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "emergency_summaries"."id" IS 'Özet kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "emergency_summaries"."student_id" IS 'Özetin öğrencisi (records students kimliği; yabancı anahtar yok). Kurumda öğrenci başına bir etkin özet.';
--> statement-breakpoint
COMMENT ON COLUMN "emergency_summaries"."published_ciphertext" IS 'Özel nitelikli: onaylanmış ve görünen acil eylem metni; AES-256-GCM ile kurum anahtarıyla şifreli, satır ve öğrenciye bağlı. Onaydan önce boş. Düz metin tutulmaz, loglanmaz, denetime yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "emergency_summaries"."published_key_version" IS 'Yayındaki metni şifreleyen anahtarın sürümü (> 0); metinle birlikte dolu.';
--> statement-breakpoint
COMMENT ON COLUMN "emergency_summaries"."draft_ciphertext" IS 'Özel nitelikli: onay bekleyen acil eylem metni (şifreli); onayla yayına geçer ve boşalır. Yalnız yönetici görür.';
--> statement-breakpoint
COMMENT ON COLUMN "emergency_summaries"."draft_key_version" IS 'Onay bekleyen metni şifreleyen anahtarın sürümü (> 0); metinle birlikte dolu.';
--> statement-breakpoint
COMMENT ON COLUMN "emergency_summaries"."reviewed_profile_version" IS 'Son onay anındaki sağlık profili sürümü (profil yoksa 1). Güncel sürümden farklıysa özet gözden geçirilmeli işaretlenir.';
--> statement-breakpoint
COMMENT ON COLUMN "emergency_summaries"."reviewed_profile_updated_at" IS 'Son onay anındaki sağlık profilinin güncelleme anı (profil yoksa boş); arşivlenip yeniden açılan profili ayırt eder.';
--> statement-breakpoint
COMMENT ON COLUMN "emergency_summaries"."approved_at" IS 'Son onay anı (UTC); yayındaki metinle birlikte dolu.';
--> statement-breakpoint
COMMENT ON COLUMN "emergency_summaries"."approved_by_user_id" IS 'Son onaylayan yönetici kullanıcısı.';
--> statement-breakpoint
COMMENT ON COLUMN "emergency_summaries"."created_by_user_id" IS 'Özeti açan kullanıcı.';
--> statement-breakpoint
COMMENT ON COLUMN "emergency_summaries"."updated_by_user_id" IS 'Metni ya da onayı son yazan kullanıcı.';
--> statement-breakpoint
COMMENT ON COLUMN "emergency_summaries"."created_at" IS 'Oluşturulma anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "emergency_summaries"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "emergency_summaries"."archived_at" IS 'Arşiv anı; arşivli özet görünmez, öğrenci için yeni özet açılabilir.';
--> statement-breakpoint
COMMENT ON COLUMN "emergency_summaries"."version" IS 'İyimser kilit sürümü (If-Match); her yazmada artar.';
