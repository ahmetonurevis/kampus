CREATE TABLE "staff_job_offers" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"membership_id" text,
	"candidate_name" text,
	"candidate_email" text,
	"candidate_phone" text,
	"position" text NOT NULL,
	"staff_role" text NOT NULL,
	"start_date" date NOT NULL,
	"wage_type" text NOT NULL,
	"offered_amount_cents" bigint NOT NULL,
	"currency" text DEFAULT 'TRY' NOT NULL,
	"respond_by" date,
	"note" text,
	"status" text NOT NULL,
	"sent_on" date,
	"accepted_on" date,
	"closed_on" date,
	"close_reason" text,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "staff_job_offers_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "staff_job_offers_status_check" CHECK ("staff_job_offers"."status" in ('draft', 'sent', 'accepted', 'rejected', 'withdrawn')),
	CONSTRAINT "staff_job_offers_role_check" CHECK ("staff_job_offers"."staff_role" in ('yonetici', 'ogretmen', 'onburo')),
	CONSTRAINT "staff_job_offers_wage_type_check" CHECK ("staff_job_offers"."wage_type" in ('monthly_gross', 'monthly_net', 'hourly', 'lesson_hour')),
	CONSTRAINT "staff_job_offers_currency_check" CHECK ("staff_job_offers"."currency" = 'TRY'),
	CONSTRAINT "staff_job_offers_amount_check" CHECK ("staff_job_offers"."offered_amount_cents" > 0 and "staff_job_offers"."offered_amount_cents" <= 1000000000),
	CONSTRAINT "staff_job_offers_candidate_check" CHECK (("staff_job_offers"."membership_id" is not null or "staff_job_offers"."candidate_name" is not null)
        and ("staff_job_offers"."candidate_name" is null
          or char_length("staff_job_offers"."candidate_name") between 2 and 120)
        and ("staff_job_offers"."candidate_email" is null
          or char_length("staff_job_offers"."candidate_email") between 3 and 254)
        and ("staff_job_offers"."candidate_phone" is null or "staff_job_offers"."candidate_phone" ~ '^0[0-9]{10}$')),
	CONSTRAINT "staff_job_offers_position_check" CHECK (char_length("staff_job_offers"."position") between 2 and 120),
	CONSTRAINT "staff_job_offers_text_check" CHECK (("staff_job_offers"."note" is null or char_length("staff_job_offers"."note") between 1 and 500)
        and ("staff_job_offers"."close_reason" is null
          or char_length("staff_job_offers"."close_reason") between 1 and 500)),
	CONSTRAINT "staff_job_offers_dates_check" CHECK (("staff_job_offers"."status" <> 'draft' or "staff_job_offers"."sent_on" is null)
        and ("staff_job_offers"."status" not in ('sent', 'accepted', 'rejected') or "staff_job_offers"."sent_on" is not null)
        and (("staff_job_offers"."status" = 'accepted') <= ("staff_job_offers"."accepted_on" is not null))
        and ("staff_job_offers"."status" not in ('draft', 'sent', 'rejected') or "staff_job_offers"."accepted_on" is null)
        and (("staff_job_offers"."status" in ('rejected', 'withdrawn')) = ("staff_job_offers"."closed_on" is not null))
        and ("staff_job_offers"."closed_on" is not null or "staff_job_offers"."close_reason" is null)
        and ("staff_job_offers"."accepted_on" is null or "staff_job_offers"."accepted_on" >= "staff_job_offers"."sent_on")
        and ("staff_job_offers"."closed_on" is null or "staff_job_offers"."sent_on" is null or "staff_job_offers"."closed_on" >= "staff_job_offers"."sent_on")
        and ("staff_job_offers"."closed_on" is null or "staff_job_offers"."accepted_on" is null or "staff_job_offers"."closed_on" >= "staff_job_offers"."accepted_on"))
);
--> statement-breakpoint
CREATE TABLE "staff_onboarding_settings" (
	"institution_id" text PRIMARY KEY NOT NULL,
	"orientation_steps" jsonb NOT NULL,
	"updated_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_onboarding_steps" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"offer_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"kind" text NOT NULL,
	"document_type" text,
	"label" text NOT NULL,
	"required" boolean NOT NULL,
	"responsible_membership_id" text,
	"due_date" date,
	"completed_on" date,
	"completed_at" timestamp with time zone,
	"completed_by_user_id" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "staff_onboarding_steps_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "staff_onboarding_steps_kind_check" CHECK ("staff_onboarding_steps"."kind" in ('account', 'document', 'work_permit', 'pay_rate', 'seniority', 'asset_handover', 'orientation')),
	CONSTRAINT "staff_onboarding_steps_document_check" CHECK ((("staff_onboarding_steps"."kind" = 'document') = ("staff_onboarding_steps"."document_type" is not null))
        and ("staff_onboarding_steps"."document_type" is null or "staff_onboarding_steps"."document_type" in ('diploma', 'health_report', 'criminal_record', 'certificate', 'id_copy', 'other'))),
	CONSTRAINT "staff_onboarding_steps_label_check" CHECK (char_length("staff_onboarding_steps"."label") between 2 and 120),
	CONSTRAINT "staff_onboarding_steps_completed_check" CHECK ((("staff_onboarding_steps"."completed_on" is null) = ("staff_onboarding_steps"."completed_at" is null))
        and (("staff_onboarding_steps"."completed_on" is null) = ("staff_onboarding_steps"."completed_by_user_id" is null))
        and ("staff_onboarding_steps"."completed_on" is not null or "staff_onboarding_steps"."note" is null)
        and ("staff_onboarding_steps"."note" is null or char_length("staff_onboarding_steps"."note") between 1 and 300))
);
--> statement-breakpoint
ALTER TABLE "staff_job_offers" ADD CONSTRAINT "staff_job_offers_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_job_offers" ADD CONSTRAINT "staff_job_offers_membership_fkey" FOREIGN KEY ("institution_id","membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_onboarding_settings" ADD CONSTRAINT "staff_onboarding_settings_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_onboarding_steps" ADD CONSTRAINT "staff_onboarding_steps_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_onboarding_steps" ADD CONSTRAINT "staff_onboarding_steps_offer_fkey" FOREIGN KEY ("institution_id","offer_id") REFERENCES "public"."staff_job_offers"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_onboarding_steps" ADD CONSTRAINT "staff_onboarding_steps_responsible_fkey" FOREIGN KEY ("institution_id","responsible_membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_job_offers_status_idx" ON "staff_job_offers" USING btree ("institution_id","status","start_date");--> statement-breakpoint
CREATE INDEX "staff_job_offers_membership_idx" ON "staff_job_offers" USING btree ("institution_id","membership_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_onboarding_steps_position_key" ON "staff_onboarding_steps" USING btree ("institution_id","offer_id","position");--> statement-breakpoint
CREATE INDEX "staff_onboarding_steps_responsible_idx" ON "staff_onboarding_steps" USING btree ("institution_id","responsible_membership_id");
--> statement-breakpoint
COMMENT ON TABLE "staff_onboarding_settings" IS 'İşe başlama kurum ayarı (DOM-FIN-121, ON-179, K-413): yeni işe başlama listelerine kopyalanan oryantasyon adımları. Satır yoksa core varsayılanı (kurum tanıtımı, İSG eğitimi, çalışan aydınlatması) kullanılır; ayar değişikliği açılmış listeleri değiştirmez.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_onboarding_settings"."institution_id" IS 'Kurum; birincil anahtar.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_onboarding_settings"."orientation_steps" IS 'Oryantasyon adımları, sırasıyla: [{label (2–120), required}] dizisi, en çok 20, aynı ad iki kez olmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_onboarding_settings"."updated_by_user_id" IS 'Ayarı son değiştiren yönetici kullanıcı.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_onboarding_settings"."created_at" IS 'Oluşturulma anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_onboarding_settings"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_onboarding_settings"."archived_at" IS 'Kullanılmaz (ayar silinmez); zorunlu kolon.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_onboarding_settings"."version" IS 'İyimser kilit sürümü (If-Match).';
--> statement-breakpoint
COMMENT ON TABLE "staff_job_offers" IS 'İş teklifi (DOM-FIN-121, ON-179, K-412): taslak → gönderildi → kabul edildi, reddedildi ya da geri çekildi. Aday kurumda personel değilse yalnız adı ve iletişimi tutulur (KVKK, saklama süresi H-88), personelse üyeliğine bağlanır. Kabul edilen teklifin işe başlama listesi staff_onboarding_steps tablosundadır. Kampüs adaya e-posta göndermez; mektup PDF olarak indirilir. Satır silinmez, gönderilen teklif değişmez. Yalnız yönetici okur ve yazar.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_job_offers"."institution_id" IS 'Kurum; birincil anahtarın ve her indeksin ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_job_offers"."id" IS 'Teklif kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_job_offers"."membership_id" IS 'İç adayın ya da kabulden sonra bağlanan personel hesabının kurum üyeliği (memberships, aynı kurum); davetle açılır (IST-007), burada hesap açılmaz. Rolü staff_role ile aynı olmalı.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_job_offers"."candidate_name" IS 'Adayın adı (2–120; kişisel veri); iç adayda boş, ad personel kaydından gelir.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_job_offers"."candidate_email" IS 'Adayın e-postası (isteğe bağlı, kişisel veri); bu adrese e-posta gönderilmez. Hesap bağlanınca silinir.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_job_offers"."candidate_phone" IS 'Adayın telefonu (isteğe bağlı, 0XXXXXXXXXX, kişisel veri). Hesap bağlanınca silinir.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_job_offers"."position" IS 'Pozisyon / görev adı (2–120), mektupta yer alır.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_job_offers"."staff_role" IS 'Hesap açılınca verilecek rol: yonetici, ogretmen, onburo; öğretmende çalışma onayı adımı açılır, bağlanan hesabın rolü aynı olmalı.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_job_offers"."start_date" IS 'İşe başlama günü; adımların varsayılan son günü ve kıdem başlangıcı önerisi.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_job_offers"."wage_type" IS 'Ücret önerisinin türü (ücret tanımı türleri): monthly_gross, monthly_net, hourly, lesson_hour.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_job_offers"."offered_amount_cents" IS 'Ücret önerisi, kuruş (türün birimi başına; kişisel veri). Ücret tanımına kendiliğinden yazılmaz; işe başlama listesinden aktarılır (K-412).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_job_offers"."currency" IS 'Para birimi; yalnız TRY.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_job_offers"."respond_by" IS 'İsteğe bağlı son yanıt günü; geçtikten sonra kabul kaydedilmez.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_job_offers"."note" IS 'Mektupta yer alan isteğe bağlı koşullar / not (1–500).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_job_offers"."status" IS 'Durum: draft (taslak), sent (gönderildi), accepted (kabul edildi), rejected (reddedildi), withdrawn (geri çekildi). Yalnız taslak düzeltilir.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_job_offers"."sent_on" IS 'Adaya iletildiği gün (kayıt dışı kanal); taslakta boş, gönderilmiş, kabul ve ret durumunda zorunlu.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_job_offers"."accepted_on" IS 'Kabul günü; kabul edilmiş ve kabulden sonra geri çekilmiş teklifte dolu, gönderimden önce olamaz.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_job_offers"."closed_on" IS 'Ret ya da geri çekme günü; yalnız bu iki durumda dolu.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_job_offers"."close_reason" IS 'Ret ya da geri çekme gerekçesi (isteğe bağlı, 1–500); denetim kaydına yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_job_offers"."created_by_user_id" IS 'Teklifi hazırlayan yönetici kullanıcı.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_job_offers"."created_at" IS 'Oluşturulma anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_job_offers"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_job_offers"."archived_at" IS 'Kullanılmaz (teklif silinmez, geri çekilir); zorunlu kolon.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_job_offers"."version" IS 'İyimser kilit sürümü (If-Match); liste adımlarının değişikliği de sürümü artırır.';
--> statement-breakpoint
COMMENT ON TABLE "staff_onboarding_steps" IS 'İşe başlama listesi adımı (DOM-FIN-121, ON-179, K-413, K-414): teklif kabul edilince açılır (hesap, özlük belgesi zorunlu türleri, öğretmende çalışma onayı, ücret tanımı, kıdem başlangıcı, zimmet, oryantasyon). Kaynak isteyen adım (hesap, belge, çalışma onayı, ücret, kıdem) kaynak kaydı olmadan işaretlenmez; liste zorunlu adımlar bitince tamamlanır (hesaplanır, saklanmaz). Adım silinmez.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_onboarding_steps"."institution_id" IS 'Kurum; birincil anahtarın ve her indeksin ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_onboarding_steps"."id" IS 'Adım kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_onboarding_steps"."offer_id" IS 'Adımın ait olduğu kabul edilmiş teklif (staff_job_offers, aynı kurum).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_onboarding_steps"."position" IS 'Listedeki sıra (0’dan); teklif içinde tekil.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_onboarding_steps"."kind" IS 'Adım türü: account, document, work_permit, pay_rate, seniority, asset_handover, orientation.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_onboarding_steps"."document_type" IS 'Yalnız document adımında: özlük belgesi türü (staff_documents türleri); kabul anındaki kurum ayarının zorunlu türlerinden.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_onboarding_steps"."label" IS 'Adımın gösterilen adı (2–120); oryantasyonda kurum ayarından kopyalanır.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_onboarding_steps"."required" IS 'Liste tamamlanması için zorunlu mu; zimmet varsayılan isteğe bağlı.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_onboarding_steps"."responsible_membership_id" IS 'İsteğe bağlı sorumlu personel üyeliği (memberships, aynı kurum).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_onboarding_steps"."due_date" IS 'İsteğe bağlı son gün; açılışta işe başlama günü.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_onboarding_steps"."completed_on" IS 'Tamamlandığı gün (bugünden sonra olamaz); completed_at ve completed_by_user_id ile birlikte dolar ya da boşalır.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_onboarding_steps"."completed_at" IS 'İşaretlendiği an (UTC); listenin tamamlanma anı en son zorunlu işarettir.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_onboarding_steps"."completed_by_user_id" IS 'İşaretleyen kullanıcı.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_onboarding_steps"."note" IS 'İsteğe bağlı tamamlanma notu (1–300); yalnız tamamlanmış adımda, denetim kaydına yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_onboarding_steps"."created_at" IS 'Oluşturulma anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_onboarding_steps"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_onboarding_steps"."archived_at" IS 'Kullanılmaz (adım silinmez); zorunlu kolon.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_onboarding_steps"."version" IS 'Satır sürümü; eşzamanlılık teklif sürümüyle (If-Match) denetlenir.';
