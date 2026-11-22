CREATE TABLE "early_dismissals" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"student_id" text NOT NULL,
	"class_id" text,
	"dismissal_on" date NOT NULL,
	"planned_at" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"reason_note" text,
	"pickup_kind" text NOT NULL,
	"pickup_guardian_link_id" uuid,
	"pickup_name" text,
	"pickup_id_last4" text,
	"pickup_relationship" text,
	"status" text NOT NULL,
	"source" text NOT NULL,
	"requested_by_user_id" text NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by_user_id" text,
	"rejection_reason" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_user_id" text,
	"cancel_reason" text,
	"released_at" timestamp with time zone,
	"released_by_user_id" text,
	"released_to_kind" text,
	"released_to_guardian_link_id" uuid,
	"released_to_name" text,
	"release_identity_verified" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "early_dismissals_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "early_dismissals_status_check" CHECK ("early_dismissals"."status" in ('pending', 'approved', 'rejected', 'cancelled', 'released')),
	CONSTRAINT "early_dismissals_source_check" CHECK ("early_dismissals"."source" in ('guardian', 'school')),
	CONSTRAINT "early_dismissals_reason_check" CHECK ("early_dismissals"."reason" in ('health', 'appointment', 'family', 'other')),
	CONSTRAINT "early_dismissals_reason_note_check" CHECK (("early_dismissals"."reason_note" is null or char_length("early_dismissals"."reason_note") between 1 and 300) and ("early_dismissals"."reason" <> 'other' or "early_dismissals"."reason_note" is not null)),
	CONSTRAINT "early_dismissals_pickup_check" CHECK ("early_dismissals"."pickup_kind" in ('guardian', 'other') and (("early_dismissals"."pickup_kind" = 'guardian' and "early_dismissals"."pickup_guardian_link_id" is not null and "early_dismissals"."pickup_name" is null and "early_dismissals"."pickup_id_last4" is null and "early_dismissals"."pickup_relationship" is null) or ("early_dismissals"."pickup_kind" = 'other' and "early_dismissals"."pickup_guardian_link_id" is null and char_length("early_dismissals"."pickup_name") between 2 and 120 and "early_dismissals"."pickup_id_last4" ~ '^[0-9A-Z]{4}$' and "early_dismissals"."pickup_relationship" in ('grandparent', 'sibling', 'relative', 'family_friend', 'other')))),
	CONSTRAINT "early_dismissals_decision_check" CHECK (("early_dismissals"."decided_at" is null) = ("early_dismissals"."decided_by_user_id" is null) and ("early_dismissals"."status" = 'pending' or "early_dismissals"."status" = 'cancelled' or "early_dismissals"."decided_at" is not null) and ("early_dismissals"."status" <> 'pending' or "early_dismissals"."decided_at" is null) and (("early_dismissals"."status" = 'rejected') = ("early_dismissals"."rejection_reason" is not null)) and ("early_dismissals"."rejection_reason" is null or char_length("early_dismissals"."rejection_reason") between 5 and 300)),
	CONSTRAINT "early_dismissals_cancel_check" CHECK ((("early_dismissals"."status" = 'cancelled') = ("early_dismissals"."cancelled_at" is not null)) and ("early_dismissals"."cancelled_at" is null) = ("early_dismissals"."cancelled_by_user_id" is null) and ("early_dismissals"."cancel_reason" is null or ("early_dismissals"."cancelled_at" is not null and char_length("early_dismissals"."cancel_reason") between 1 and 300))),
	CONSTRAINT "early_dismissals_release_check" CHECK ((("early_dismissals"."status" = 'released') = ("early_dismissals"."released_at" is not null)) and ("early_dismissals"."released_at" is null or ("early_dismissals"."released_by_user_id" is not null and "early_dismissals"."release_identity_verified" and char_length("early_dismissals"."released_to_name") between 1 and 120 and (("early_dismissals"."released_to_kind" = 'guardian' and "early_dismissals"."released_to_guardian_link_id" is not null) or ("early_dismissals"."released_to_kind" = 'other' and "early_dismissals"."released_to_guardian_link_id" is null and "early_dismissals"."pickup_kind" = 'other')))) and ("early_dismissals"."released_at" is not null or ("early_dismissals"."released_by_user_id" is null and "early_dismissals"."released_to_kind" is null and "early_dismissals"."released_to_guardian_link_id" is null and "early_dismissals"."released_to_name" is null and "early_dismissals"."release_identity_verified" is null)))
);
--> statement-breakpoint
ALTER TABLE "early_dismissals" ADD CONSTRAINT "early_dismissals_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "early_dismissals" ADD CONSTRAINT "early_dismissals_pickup_guardian_fkey" FOREIGN KEY ("institution_id","pickup_guardian_link_id") REFERENCES "public"."student_guardians"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "early_dismissals" ADD CONSTRAINT "early_dismissals_released_guardian_fkey" FOREIGN KEY ("institution_id","released_to_guardian_link_id") REFERENCES "public"."student_guardians"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "early_dismissals_day_idx" ON "early_dismissals" USING btree ("institution_id","dismissal_on","planned_at");--> statement-breakpoint
CREATE INDEX "early_dismissals_student_idx" ON "early_dismissals" USING btree ("institution_id","student_id");--> statement-breakpoint
CREATE INDEX "early_dismissals_pickup_guardian_idx" ON "early_dismissals" USING btree ("institution_id","pickup_guardian_link_id");--> statement-breakpoint
CREATE INDEX "early_dismissals_released_guardian_idx" ON "early_dismissals" USING btree ("institution_id","released_to_guardian_link_id");--> statement-breakpoint
CREATE UNIQUE INDEX "early_dismissals_student_day_key" ON "early_dismissals" USING btree ("institution_id","student_id","dismissal_on") WHERE "early_dismissals"."status" in ('pending', 'approved', 'released');--> statement-breakpoint
COMMENT ON TABLE "early_dismissals" IS 'Erken çıkış ve izinli ayrılış (DOM-FIN-161, ON-168, K-538…K-540): veli talebi ya da okulun acil kaydı, okul kararı, teslim alan kişinin doğrulaması ve gerçek çıkış anı. Kimlik numarasının yalnız son dört hanesi saklanır. Öğrencinin bir günde tek açık talebi olur; yoklama kaydı bu tablodan yazılmaz, etkilenen dersler okumada hesaplanır.';
--> statement-breakpoint
COMMENT ON COLUMN "early_dismissals"."institution_id" IS 'Kurum.';
--> statement-breakpoint
COMMENT ON COLUMN "early_dismissals"."id" IS 'Erken çıkış kaydı kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "early_dismissals"."student_id" IS 'Öğrencinin records kimliği.';
--> statement-breakpoint
COMMENT ON COLUMN "early_dismissals"."class_id" IS 'Öğrencinin talep açıldığındaki sınıfı (records kimliği); etkilenen dersler bu sınıfın ders programından hesaplanır.';
--> statement-breakpoint
COMMENT ON COLUMN "early_dismissals"."dismissal_on" IS 'Çıkış günü (Europe/Istanbul). Bugün ya da 30 gün içinde açılır; teslim yalnız bu gün yapılır.';
--> statement-breakpoint
COMMENT ON COLUMN "early_dismissals"."planned_at" IS 'Planlanan çıkış anı (UTC; gün ve SS:DD saatin Europe/Istanbul anı).';
--> statement-breakpoint
COMMENT ON COLUMN "early_dismissals"."reason" IS 'Çıkış nedeni: health sağlık, appointment randevu (doktor, resmî işlem), family aile işi, other diğer.';
--> statement-breakpoint
COMMENT ON COLUMN "early_dismissals"."reason_note" IS 'Neden açıklaması (≤ 300, serbest metin; kişisel veri); other nedeninde zorunlu. Denetime ve loga yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "early_dismissals"."pickup_kind" IS 'Teslim alacak kişi: guardian kayıtlı teslim yetkilisi bağı, other kayıtlı olmayan ve okulca onaylanan kişi.';
--> statement-breakpoint
COMMENT ON COLUMN "early_dismissals"."pickup_guardian_link_id" IS 'Teslim alacak kayıtlı bağ (student_guardians FK); yalnız guardian türünde dolu.';
--> statement-breakpoint
COMMENT ON COLUMN "early_dismissals"."pickup_name" IS 'Kayıtlı olmayan teslim alanın adı soyadı (2–120; kişisel veri); yalnız other türünde dolu.';
--> statement-breakpoint
COMMENT ON COLUMN "early_dismissals"."pickup_id_last4" IS 'Kayıtlı olmayan teslim alanın kimliğinin yalnız son dört hanesi (rakam ya da büyük harf); kimliğin tamamı alınmaz. Teslimde görülen kimlikle eşleşmeli.';
--> statement-breakpoint
COMMENT ON COLUMN "early_dismissals"."pickup_relationship" IS 'Kayıtlı olmayan teslim alanın öğrenciye yakınlığı: grandparent, sibling, relative, family_friend, other.';
--> statement-breakpoint
COMMENT ON COLUMN "early_dismissals"."status" IS 'Durum: pending onay bekliyor, approved onaylandı, rejected reddedildi, cancelled iptal edildi, released teslim edildi.';
--> statement-breakpoint
COMMENT ON COLUMN "early_dismissals"."source" IS 'Talebi açan: guardian veli (onay bekler), school okul (acil durum; onaylı doğar).';
--> statement-breakpoint
COMMENT ON COLUMN "early_dismissals"."requested_by_user_id" IS 'Talebi açan kullanıcı.';
--> statement-breakpoint
COMMENT ON COLUMN "early_dismissals"."decided_at" IS 'Onay ya da ret anı; okulun açtığı talepte açılış anı. Bekleyen talepte boş.';
--> statement-breakpoint
COMMENT ON COLUMN "early_dismissals"."decided_by_user_id" IS 'Onaylayan ya da reddeden kullanıcı.';
--> statement-breakpoint
COMMENT ON COLUMN "early_dismissals"."rejection_reason" IS 'Ret gerekçesi (5–300, serbest metin; veliye görünür). Yalnız rejected durumunda dolu; denetime ve loga yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "early_dismissals"."cancelled_at" IS 'İptal anı; yalnız cancelled durumunda dolu.';
--> statement-breakpoint
COMMENT ON COLUMN "early_dismissals"."cancelled_by_user_id" IS 'İptal eden kullanıcı (okul ya da velayetli veli).';
--> statement-breakpoint
COMMENT ON COLUMN "early_dismissals"."cancel_reason" IS 'İsteğe bağlı iptal gerekçesi (≤ 300, serbest metin).';
--> statement-breakpoint
COMMENT ON COLUMN "early_dismissals"."released_at" IS 'Gerçek çıkış (teslim) anı; yalnız released durumunda dolu. Etkilenen dersler bu andan hesaplanır.';
--> statement-breakpoint
COMMENT ON COLUMN "early_dismissals"."released_by_user_id" IS 'Teslimi kaydeden ön büro ya da yönetici kullanıcısı.';
--> statement-breakpoint
COMMENT ON COLUMN "early_dismissals"."released_to_kind" IS 'Teslim alan: guardian teslim anında yetkili bağ, other talepte onaylanan kayıtlı olmayan kişi.';
--> statement-breakpoint
COMMENT ON COLUMN "early_dismissals"."released_to_guardian_link_id" IS 'Teslim alan bağ (student_guardians FK); yalnız guardian türünde dolu.';
--> statement-breakpoint
COMMENT ON COLUMN "early_dismissals"."released_to_name" IS 'Teslim alanın adının teslim anındaki kopyası (kişisel veri); bağ sonradan değişse de teslim kaydı değişmez.';
--> statement-breakpoint
COMMENT ON COLUMN "early_dismissals"."release_identity_verified" IS 'Teslimde teslim alanın kimliği görüldü (teslim edilen kayıtta zorunlu true). Numara yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "early_dismissals"."created_at" IS 'Satırın oluşturulduğu an.';
--> statement-breakpoint
COMMENT ON COLUMN "early_dismissals"."updated_at" IS 'Son değişiklik anı.';
--> statement-breakpoint
COMMENT ON COLUMN "early_dismissals"."archived_at" IS 'Kullanılmıyor (zorunlu kolon); kayıt arşivlenmez, durumla kapanır.';
--> statement-breakpoint
COMMENT ON COLUMN "early_dismissals"."version" IS 'İyimser kilit sürümü (If-Match).';
