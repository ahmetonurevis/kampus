CREATE TABLE "stakeholder_agreements" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"stakeholder_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"renewal_notice_days" integer NOT NULL,
	"contribution_type" text NOT NULL,
	"contribution_amount_cents" bigint,
	"currency" text DEFAULT 'TRY' NOT NULL,
	"contribution_description" text,
	"benefits" text[] DEFAULT '{}'::text[] NOT NULL,
	"benefit_note" text,
	"contract_file_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"activated_at" timestamp with time zone,
	"termination_date" date,
	"termination_reason" text,
	"terminated_at" timestamp with time zone,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "stakeholder_agreements_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "stakeholder_agreements_status_check" CHECK ("stakeholder_agreements"."status" in ('draft', 'active', 'terminated')),
	CONSTRAINT "stakeholder_agreements_contribution_type_check" CHECK ("stakeholder_agreements"."contribution_type" in ('cash', 'in_kind', 'service')),
	CONSTRAINT "stakeholder_agreements_text_check" CHECK (char_length("stakeholder_agreements"."subject") between 3 and 200
        and ("stakeholder_agreements"."contribution_description" is null
          or char_length("stakeholder_agreements"."contribution_description") between 1 and 500)
        and ("stakeholder_agreements"."benefit_note" is null or char_length("stakeholder_agreements"."benefit_note") between 1 and 300)),
	CONSTRAINT "stakeholder_agreements_terms_check" CHECK ("stakeholder_agreements"."end_date" >= "stakeholder_agreements"."start_date"
        and "stakeholder_agreements"."renewal_notice_days" between 0 and 365
        and "stakeholder_agreements"."currency" = 'TRY'
        and ("stakeholder_agreements"."contribution_amount_cents" is null
          or "stakeholder_agreements"."contribution_amount_cents" between 1 and 100000000000)
        and ("stakeholder_agreements"."contribution_type" <> 'cash' or "stakeholder_agreements"."contribution_amount_cents" is not null)
        and ("stakeholder_agreements"."contribution_type" = 'cash'
          or char_length(coalesce("stakeholder_agreements"."contribution_description", '')) >= 3)
        and "stakeholder_agreements"."benefits" <@ array['logo', 'event_naming', 'announcement', 'other']::text[]),
	CONSTRAINT "stakeholder_agreements_status_fields_check" CHECK ((("stakeholder_agreements"."status" = 'terminated') = ("stakeholder_agreements"."termination_date" is not null))
        and (("stakeholder_agreements"."status" = 'terminated') = ("stakeholder_agreements"."terminated_at" is not null))
        and (("stakeholder_agreements"."status" = 'terminated') = ("stakeholder_agreements"."termination_reason" is not null))
        and (("stakeholder_agreements"."status" = 'draft') = ("stakeholder_agreements"."activated_at" is null))
        and ("stakeholder_agreements"."termination_reason" is null
          or char_length("stakeholder_agreements"."termination_reason") between 5 and 500)
        and ("stakeholder_agreements"."termination_date" is null
          or "stakeholder_agreements"."termination_date" between "stakeholder_agreements"."start_date" and "stakeholder_agreements"."end_date"))
);
--> statement-breakpoint
CREATE TABLE "stakeholders" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"tax_number" text,
	"contact_name" text,
	"contact_email" text,
	"contact_phone" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "stakeholders_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "stakeholders_type_check" CHECK ("stakeholders"."type" in ('sponsor', 'partner', 'corporate', 'university', 'municipality_ngo', 'parent_association')),
	CONSTRAINT "stakeholders_text_check" CHECK (char_length("stakeholders"."name") between 2 and 200
        and ("stakeholders"."tax_number" is null or "stakeholders"."tax_number" ~ '^[0-9]{10}$')
        and ("stakeholders"."contact_name" is null or char_length("stakeholders"."contact_name") between 2 and 120)
        and ("stakeholders"."contact_email" is null or char_length("stakeholders"."contact_email") <= 254)
        and ("stakeholders"."contact_phone" is null or "stakeholders"."contact_phone" ~ '^0[0-9]{10}$')),
	CONSTRAINT "stakeholders_tags_check" CHECK (cardinality("stakeholders"."tags") <= 10)
);
--> statement-breakpoint
ALTER TABLE "stakeholder_agreements" ADD CONSTRAINT "stakeholder_agreements_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stakeholder_agreements" ADD CONSTRAINT "stakeholder_agreements_stakeholder_fkey" FOREIGN KEY ("institution_id","stakeholder_id") REFERENCES "public"."stakeholders"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stakeholder_agreements" ADD CONSTRAINT "stakeholder_agreements_contract_file_fkey" FOREIGN KEY ("institution_id","contract_file_id") REFERENCES "public"."files"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stakeholders" ADD CONSTRAINT "stakeholders_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stakeholder_agreements_stakeholder_idx" ON "stakeholder_agreements" USING btree ("institution_id","stakeholder_id","start_date");--> statement-breakpoint
CREATE INDEX "stakeholder_agreements_end_idx" ON "stakeholder_agreements" USING btree ("institution_id","status","end_date");--> statement-breakpoint
CREATE INDEX "stakeholder_agreements_contract_file_idx" ON "stakeholder_agreements" USING btree ("institution_id","contract_file_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stakeholders_tax_number_key" ON "stakeholders" USING btree ("institution_id","tax_number") WHERE "stakeholders"."archived_at" is null and "stakeholders"."tax_number" is not null;--> statement-breakpoint
CREATE INDEX "stakeholders_active_name_idx" ON "stakeholders" USING btree ("institution_id","is_active","name");--> statement-breakpoint
COMMENT ON TABLE "stakeholders" IS 'Kurumsal paydaş (DOM-FIN-102, ON-262): sponsor, iş birliği kurumu, tedarikçi dışı kurumsal paydaş, üniversite, belediye/STK, veli derneği. Silinmez, is_active ile pasifleşir; pasif paydaşla yeni anlaşma açılmaz (K-316). Yalnız yönetici okur ve yazar (K-317).';--> statement-breakpoint
COMMENT ON COLUMN "stakeholders"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "stakeholders"."id" IS 'Paydaş kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "stakeholders"."name" IS 'Kurumun adı ya da unvanı, 2–200 karakter.';--> statement-breakpoint
COMMENT ON COLUMN "stakeholders"."type" IS 'Tür: sponsor, partner iş birliği kurumu, corporate kurumsal paydaş (tedarikçi dışı), university üniversite, municipality_ngo belediye ya da STK, parent_association veli derneği.';--> statement-breakpoint
COMMENT ON COLUMN "stakeholders"."tax_number" IS 'İsteğe bağlı 10 haneli VKN (kontrol hanesi sunucuda denetlenir); verilmişse kurumda tekil, pasifler dahil (stakeholders_tax_number_key).';--> statement-breakpoint
COMMENT ON COLUMN "stakeholders"."contact_name" IS 'İletişim kişisinin adı (kvkk K), 2–120 karakter; listede açık, CSV''ye girmez.';--> statement-breakpoint
COMMENT ON COLUMN "stakeholders"."contact_email" IS 'İletişim kişisinin e-postası (kvkk K); listede maskeli (a***@alan.com), tam değer yalnız yöneticinin ayrıntısında, loglanmaz.';--> statement-breakpoint
COMMENT ON COLUMN "stakeholders"."contact_phone" IS 'İletişim kişisinin telefonu (kvkk K), 0 ile başlayan 11 hane; listede maskeli (0532 *** ** 12), loglanmaz.';--> statement-breakpoint
COMMENT ON COLUMN "stakeholders"."tags" IS 'Serbest etiketler, en çok 10; Türkçe küçük harfe çevrilir, yinelenen tek tutulur. Liste süzgecinde tam eşleşme.';--> statement-breakpoint
COMMENT ON COLUMN "stakeholders"."is_active" IS 'Etkin mi; pasif paydaşla anlaşma açılmaz ve taslak yürürlüğe alınmaz, mevcut anlaşmalar sürer.';--> statement-breakpoint
COMMENT ON COLUMN "stakeholders"."created_by_user_id" IS 'Paydaşı ekleyen kullanıcı.';--> statement-breakpoint
COMMENT ON COLUMN "stakeholders"."created_at" IS 'Oluşturma zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "stakeholders"."updated_at" IS 'Son değişiklik zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "stakeholders"."archived_at" IS 'Arşiv zamanı; paydaş silinmediği için uygulama doldurmaz (pasifleştirme is_active ile).';--> statement-breakpoint
COMMENT ON COLUMN "stakeholders"."version" IS 'İyimser kilit sürümü (If-Match).';--> statement-breakpoint
COMMENT ON TABLE "stakeholder_agreements" IS 'İş birliği ya da sponsorluk anlaşması (DOM-FIN-102). Saklanan durum draft taslak, active yürürlükte, terminated feshedildi; "sona erdi" saklanmaz, yürürlükteki anlaşmanın bitiş günü bugünden önceyse hesaplanır (K-318). Bitişe kalan gün renewal_notice_days değerine inince uyarıdadır (K-319). Sponsor katkısı bağış ya da tahsilat kaydı değildir.';--> statement-breakpoint
COMMENT ON COLUMN "stakeholder_agreements"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "stakeholder_agreements"."id" IS 'Anlaşma kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "stakeholder_agreements"."stakeholder_id" IS 'Paydaş (stakeholders); paydaş silinemez (restrict).';--> statement-breakpoint
COMMENT ON COLUMN "stakeholder_agreements"."subject" IS 'Anlaşmanın konusu, 3–200 karakter.';--> statement-breakpoint
COMMENT ON COLUMN "stakeholder_agreements"."start_date" IS 'Başlangıç günü (Europe/Istanbul).';--> statement-breakpoint
COMMENT ON COLUMN "stakeholder_agreements"."end_date" IS 'Bitiş günü (dahil); başlangıçtan önce olamaz. Uzatma bu günün düzeltilmesidir.';--> statement-breakpoint
COMMENT ON COLUMN "stakeholder_agreements"."renewal_notice_days" IS 'Bitişten kaç gün önce yenileme uyarısı verileceği (0–365, varsayılan 30). Arka plan bildirimi yoktur; uyarı listede ve panoda görünür.';--> statement-breakpoint
COMMENT ON COLUMN "stakeholder_agreements"."contribution_type" IS 'Katkı türü: cash nakdi, in_kind ayni, service hizmet.';--> statement-breakpoint
COMMENT ON COLUMN "stakeholder_agreements"."contribution_amount_cents" IS 'Katkı tutarı (kuruş, 1–100.000.000.000); nakdide zorunlu, ayni ve hizmette isteğe bağlı tahmini değer. Muhasebe ya da tahsilat kaydı açmaz.';--> statement-breakpoint
COMMENT ON COLUMN "stakeholder_agreements"."currency" IS 'Para birimi; yalnız TRY.';--> statement-breakpoint
COMMENT ON COLUMN "stakeholder_agreements"."contribution_description" IS 'Ayni ya da hizmet katkısının açıklaması (en az 3, en çok 500 karakter); bu türlerde zorunlu.';--> statement-breakpoint
COMMENT ON COLUMN "stakeholder_agreements"."benefits" IS 'Sponsora verilen karşılıklar: logo logo kullanımı, event_naming etkinlik adı, announcement duyuru ve teşekkür, other diğer.';--> statement-breakpoint
COMMENT ON COLUMN "stakeholder_agreements"."benefit_note" IS 'Karşılığın ayrıntısı (ör. etkinlik adı), en çok 300 karakter.';--> statement-breakpoint
COMMENT ON COLUMN "stakeholder_agreements"."contract_file_id" IS 'Sözleşme dosyası (files; amaç document, bağ türü stakeholder_agreement). Dosyayı yükleyen yönetici bağlar; bağlı dosya anlaşmayı okuyabilene açılır. Dosya satırı silinemez (restrict).';--> statement-breakpoint
COMMENT ON COLUMN "stakeholder_agreements"."status" IS 'Saklanan durum: draft taslak (düzenlenir, silinebilir), active yürürlükte (yürürlüğe alma zamanı activated_at), terminated feshedildi (değişmez).';--> statement-breakpoint
COMMENT ON COLUMN "stakeholder_agreements"."activated_at" IS 'Yürürlüğe alındığı an (UTC); taslakta boş.';--> statement-breakpoint
COMMENT ON COLUMN "stakeholder_agreements"."termination_date" IS 'Fesih günü; başlangıç ile bitiş arasında. Yalnız feshedilmiş anlaşmada.';--> statement-breakpoint
COMMENT ON COLUMN "stakeholder_agreements"."termination_reason" IS 'Fesih gerekçesi, 5–500 karakter; loglanmaz, denetim kaydına yalnız alan adı düşer.';--> statement-breakpoint
COMMENT ON COLUMN "stakeholder_agreements"."terminated_at" IS 'Feshin kaydedildiği an (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "stakeholder_agreements"."created_by_user_id" IS 'Anlaşmayı açan kullanıcı.';--> statement-breakpoint
COMMENT ON COLUMN "stakeholder_agreements"."created_at" IS 'Oluşturma zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "stakeholder_agreements"."updated_at" IS 'Son değişiklik zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "stakeholder_agreements"."archived_at" IS 'Arşiv zamanı; yalnız taslak anlaşma silinir (arşivlenir), bağlı dosyanın bağı kalkar.';--> statement-breakpoint
COMMENT ON COLUMN "stakeholder_agreements"."version" IS 'İyimser kilit sürümü (If-Match).';
