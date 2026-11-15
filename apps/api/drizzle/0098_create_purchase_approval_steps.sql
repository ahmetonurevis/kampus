CREATE TABLE "purchase_approval_settings" (
	"institution_id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_approval_tiers" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"position" integer NOT NULL,
	"min_total_cents" bigint NOT NULL,
	"currency" text DEFAULT 'TRY' NOT NULL,
	"approver_role" text,
	"approver_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "purchase_approval_tiers_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "purchase_approval_tiers_position_check" CHECK ("purchase_approval_tiers"."position" between 1 and 5),
	CONSTRAINT "purchase_approval_tiers_amount_check" CHECK ("purchase_approval_tiers"."min_total_cents" between 0 and 1000000000000),
	CONSTRAINT "purchase_approval_tiers_currency_check" CHECK ("purchase_approval_tiers"."currency" = 'TRY'),
	CONSTRAINT "purchase_approval_tiers_approver_check" CHECK (("purchase_approval_tiers"."approver_role" is null) <> ("purchase_approval_tiers"."approver_user_id" is null)
        and ("purchase_approval_tiers"."approver_role" is null or "purchase_approval_tiers"."approver_role" in ('yonetici')))
);
--> statement-breakpoint
CREATE TABLE "purchase_request_approval_steps" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"min_total_cents" bigint NOT NULL,
	"currency" text DEFAULT 'TRY' NOT NULL,
	"approver_role" text,
	"approver_user_id" text,
	"decision" text,
	"decided_by_user_id" text,
	"decided_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "purchase_request_approval_steps_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "purchase_request_approval_steps_position_check" CHECK ("purchase_request_approval_steps"."position" between 1 and 5),
	CONSTRAINT "purchase_request_approval_steps_amount_check" CHECK ("purchase_request_approval_steps"."min_total_cents" between 0 and 1000000000000),
	CONSTRAINT "purchase_request_approval_steps_currency_check" CHECK ("purchase_request_approval_steps"."currency" = 'TRY'),
	CONSTRAINT "purchase_request_approval_steps_approver_check" CHECK (("purchase_request_approval_steps"."approver_role" is null) <> ("purchase_request_approval_steps"."approver_user_id" is null)
        and ("purchase_request_approval_steps"."approver_role" is null or "purchase_request_approval_steps"."approver_role" in ('yonetici'))),
	CONSTRAINT "purchase_request_approval_steps_decision_check" CHECK (("purchase_request_approval_steps"."decision" is null and "purchase_request_approval_steps"."decided_by_user_id" is null and "purchase_request_approval_steps"."decided_at" is null and "purchase_request_approval_steps"."note" is null)
        or ("purchase_request_approval_steps"."decision" in ('approved', 'rejected') and "purchase_request_approval_steps"."decided_by_user_id" is not null and "purchase_request_approval_steps"."decided_at" is not null
          and ("purchase_request_approval_steps"."decision" <> 'rejected' or "purchase_request_approval_steps"."note" is not null))),
	CONSTRAINT "purchase_request_approval_steps_note_check" CHECK ("purchase_request_approval_steps"."note" is null or char_length("purchase_request_approval_steps"."note") between 1 and 500)
);
--> statement-breakpoint
ALTER TABLE "purchase_approval_settings" ADD CONSTRAINT "purchase_approval_settings_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_approval_tiers" ADD CONSTRAINT "purchase_approval_tiers_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_request_approval_steps" ADD CONSTRAINT "purchase_request_approval_steps_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_request_approval_steps" ADD CONSTRAINT "purchase_request_approval_steps_request_fkey" FOREIGN KEY ("institution_id","request_id") REFERENCES "public"."purchase_requests"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_approval_tiers_position_key" ON "purchase_approval_tiers" USING btree ("institution_id","position") WHERE "purchase_approval_tiers"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_request_approval_steps_position_key" ON "purchase_request_approval_steps" USING btree ("institution_id","request_id","position") WHERE "purchase_request_approval_steps"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "purchase_request_approval_steps_request_idx" ON "purchase_request_approval_steps" USING btree ("institution_id","request_id");--> statement-breakpoint
COMMENT ON TABLE "purchase_approval_settings" IS 'Satın alma talebinin kademeli onay ayarının sürüm satırı (DOM-FIN-071, ON-223, K-260): kurum başına bir satır; kademe listesi purchase_approval_tiers tablosunda bütün olarak yazılır ve If-Match bu satırın sürümüyle denetlenir. Satır yoksa ayar hiç değişmemiştir: kademe yok, talepleri her yönetici tek adımda onaylar (K-129).';--> statement-breakpoint
COMMENT ON COLUMN "purchase_approval_settings"."institution_id" IS 'Kurum; birincil anahtar (kurum başına bir ayar satırı).';--> statement-breakpoint
COMMENT ON COLUMN "purchase_approval_settings"."created_at" IS 'Ayarın ilk kaydedildiği zaman (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "purchase_approval_settings"."updated_at" IS 'Kademe listesinin son yazıldığı zaman (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "purchase_approval_settings"."archived_at" IS 'Arşiv zamanı; ayar satırı arşivlenmez, kademeler boş liste yazılarak kapatılır.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_approval_settings"."version" IS 'İyimser kilit sürümü; her kayıtta bir artar. Satır yokken istemci 1 gönderir, ilk kayıt satırı 2 ile açar.';--> statement-breakpoint
COMMENT ON TABLE "purchase_approval_tiers" IS 'Satın alma talebi onay kademesi eşiği (DOM-FIN-071, ON-223, K-260): talebin KDV dahil tahmini toplamı alt sınıra eşit ya da büyükse kademe gerekir. İlk kademe 0 ile başlar, alt sınırlar kesin artar, en çok 5 kademe. Onaylayan ya herhangi bir yönetici (approver_role) ya da adlandırılmış etkin yönetici üyesidir (approver_user_id). Liste yeniden yazılınca eski satırlar arşivlenir; açık talepler kendi dondurulmuş kademelerini (purchase_request_approval_steps) taşır.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_approval_tiers"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_approval_tiers"."id" IS 'Kademe satırının kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_approval_tiers"."position" IS 'Kademe sırası, 1–5; etkin satırlarda kurum içinde tekil. Sıra alt sınırla birlikte artar.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_approval_tiers"."min_total_cents" IS 'Kademenin alt sınırı, kuruş (KDV dahil tahmini talep toplamıyla karşılaştırılır); ilk kademede 0.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_approval_tiers"."currency" IS 'Para birimi; yalnız TRY.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_approval_tiers"."approver_role" IS 'Kademeyi onaylayabilen rol (yalnız yonetici: herhangi bir yönetici); adlandırılmış kişi verilmişse boş. approver_user_id ile tam olarak biri dolu.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_approval_tiers"."approver_user_id" IS 'Kademeyi onaylayacak adlandırılmış kurum üyesinin kullanıcı kimliği (ör. finans yöneticisi, kurucu temsilcisi); kayıt anında kurumun etkin yöneticisi olmalıdır. Rol verilmişse boş.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_approval_tiers"."created_at" IS 'Oluşturma zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "purchase_approval_tiers"."updated_at" IS 'Son değişiklik zamanı (UTC); arşivlenince arşiv zamanı.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_approval_tiers"."archived_at" IS 'Arşiv zamanı: kademe listesi yeniden yazılınca eski satırlar arşivlenir; arşivli satır yeni gönderimde kullanılmaz.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_approval_tiers"."version" IS 'Satır sürümü; ayarın kilidi purchase_approval_settings.version üzerindedir.';--> statement-breakpoint
COMMENT ON TABLE "purchase_request_approval_steps" IS 'Satın alma talebine dondurulmuş onay kademesi (DOM-FIN-071, ON-223, K-261, K-262): talep gönderilince tutarın eriştiği kademeler eşiği ve onaylayanıyla kopyalanır; sonradan ayar değişse de açık talep etkilenmez. Kademeler sırayla karar alır: talep eden hiçbir kademeye, aynı kişi iki kademeye karar veremez; ret talebi reddeder, son kademenin onayı talebi onaylar. Talep taslağa geri çekilince kademeleri arşivlenir, yeniden gönderimde yenileri yazılır. Kademesi olmayan gönderilmiş talep tek adımlı yönetici onayındadır (K-129).';--> statement-breakpoint
COMMENT ON COLUMN "purchase_request_approval_steps"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_request_approval_steps"."id" IS 'Kademe kaydının kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_request_approval_steps"."request_id" IS 'Satın alma talebi (purchase_requests); kurum içi bileşik yabancı anahtar, silme kısıtlı.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_request_approval_steps"."position" IS 'Kademe sırası, 1–5; talebin etkin kademelerinde tekil. Karar en küçük kararsız sıradan başlar.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_request_approval_steps"."min_total_cents" IS 'Gönderim anındaki ayardan kopyalanan alt sınır, kuruş; kademenin neden gerektiğini gösterir.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_request_approval_steps"."currency" IS 'Para birimi; yalnız TRY.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_request_approval_steps"."approver_role" IS 'Gönderim anındaki onaylayan rol (yalnız yonetici); adlandırılmış kişi varsa boş.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_request_approval_steps"."approver_user_id" IS 'Gönderim anındaki adlandırılmış onaylayanın kullanıcı kimliği; kişi sonradan ayrılırsa talep geri çekilip yeniden gönderilir.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_request_approval_steps"."decision" IS 'Kademe kararı: approved (onaylandı) ya da rejected (reddedildi); karar bekliyorsa boş.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_request_approval_steps"."decided_by_user_id" IS 'Kararı veren kullanıcı; talep eden ve aynı talepte başka kademeye karar vermiş kişi olamaz (servis ve core denetler).';--> statement-breakpoint
COMMENT ON COLUMN "purchase_request_approval_steps"."decided_at" IS 'Karar zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "purchase_request_approval_steps"."note" IS 'Onay notu (isteğe bağlı) ya da ret gerekçesi (retle zorunlu), en çok 500 karakter.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_request_approval_steps"."created_at" IS 'Kademenin talebe dondurulduğu zaman (gönderim, UTC).';--> statement-breakpoint
COMMENT ON COLUMN "purchase_request_approval_steps"."updated_at" IS 'Son değişiklik zamanı (UTC): karar ya da arşiv.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_request_approval_steps"."archived_at" IS 'Arşiv zamanı: talep taslağa geri çekilince kademeler (verilmiş kararlarıyla) arşivlenir, geçmiş olarak kalır.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_request_approval_steps"."version" IS 'Satır sürümü; talebin kilidi purchase_requests.version üzerindedir.';
