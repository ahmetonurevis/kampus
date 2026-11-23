CREATE TABLE "meal_subscription_cancellations" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"meal_date" date NOT NULL,
	"late" boolean DEFAULT false NOT NULL,
	"cancelled_by" text NOT NULL,
	"cancelled_by_user_id" text NOT NULL,
	"restored_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "meal_subscription_cancellations_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "meal_subscription_cancellations_cancelled_by_check" CHECK ("meal_subscription_cancellations"."cancelled_by" in ('family', 'school')),
	CONSTRAINT "meal_subscription_cancellations_late_check" CHECK (not "meal_subscription_cancellations"."late" or "meal_subscription_cancellations"."cancelled_by" = 'school'),
	CONSTRAINT "meal_subscription_cancellations_restored_check" CHECK (("meal_subscription_cancellations"."archived_at" is null) = ("meal_subscription_cancellations"."restored_by_user_id" is null))
);
--> statement-breakpoint
CREATE TABLE "meal_subscription_settings" (
	"institution_id" text PRIMARY KEY NOT NULL,
	"cutoff_days_before" integer NOT NULL,
	"cutoff_time" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "meal_subscription_settings_cutoff_check" CHECK ("meal_subscription_settings"."cutoff_days_before" between 0 and 7
        and "meal_subscription_settings"."cutoff_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);
--> statement-breakpoint
CREATE TABLE "meal_subscriptions" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"student_id" text NOT NULL,
	"meal_kind" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"weekdays" integer[] NOT NULL,
	"diet_type" text NOT NULL,
	"diet_note" text,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "meal_subscriptions_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "meal_subscriptions_meal_kind_check" CHECK ("meal_subscriptions"."meal_kind" in ('breakfast', 'lunch', 'snack')),
	CONSTRAINT "meal_subscriptions_diet_type_check" CHECK ("meal_subscriptions"."diet_type" in ('standard', 'vegetarian', 'gluten_free', 'lactose_free', 'other')),
	CONSTRAINT "meal_subscriptions_dates_check" CHECK ("meal_subscriptions"."end_date" >= "meal_subscriptions"."start_date"
        and "meal_subscriptions"."end_date" - "meal_subscriptions"."start_date" < 366),
	CONSTRAINT "meal_subscriptions_weekdays_check" CHECK (cardinality("meal_subscriptions"."weekdays") between 1 and 7
        and "meal_subscriptions"."weekdays" <@ array[1, 2, 3, 4, 5, 6, 7]::integer[]),
	CONSTRAINT "meal_subscriptions_diet_note_check" CHECK (("meal_subscriptions"."diet_type" = 'other') = ("meal_subscriptions"."diet_note" is not null)
        and ("meal_subscriptions"."diet_note" is null
          or char_length("meal_subscriptions"."diet_note") between 2 and 200))
);
--> statement-breakpoint
ALTER TABLE "meal_subscription_cancellations" ADD CONSTRAINT "meal_subscription_cancellations_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_subscription_cancellations" ADD CONSTRAINT "meal_subscription_cancellations_subscription_fkey" FOREIGN KEY ("institution_id","subscription_id") REFERENCES "public"."meal_subscriptions"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_subscription_settings" ADD CONSTRAINT "meal_subscription_settings_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_subscriptions" ADD CONSTRAINT "meal_subscriptions_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "meal_subscription_cancellations_day_key" ON "meal_subscription_cancellations" USING btree ("institution_id","subscription_id","meal_date") WHERE "meal_subscription_cancellations"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "meal_subscription_cancellations_subscription_idx" ON "meal_subscription_cancellations" USING btree ("institution_id","subscription_id");--> statement-breakpoint
CREATE INDEX "meal_subscription_cancellations_date_idx" ON "meal_subscription_cancellations" USING btree ("institution_id","meal_date");--> statement-breakpoint
CREATE INDEX "meal_subscriptions_student_idx" ON "meal_subscriptions" USING btree ("institution_id","student_id");--> statement-breakpoint
CREATE INDEX "meal_subscriptions_dates_idx" ON "meal_subscriptions" USING btree ("institution_id","end_date","start_date");
--> statement-breakpoint
COMMENT ON TABLE "meal_subscriptions" IS 'Yemek aboneliği (DOM-FIN-164, ON-150, K-547): öğrencinin bir öğüne (meal_menu_items öğün anahtarları; kurumun açık öğünü) başlangıç ve bitiş günü arasında, seçili hafta günlerinde katılması ve diyet türü. Aynı öğrenci ve öğünde tarihleri değen iki etkin abonelik olmaz (kurum kilidi altında core denetler). Başlamış abonelikte yalnız bitiş günü değişir, bugünden önceye çekilmez; diyet ya da gün değişikliği için abonelik bitirilip yenisi açılır. Yalnız başlamamış abonelik arşivlenir. Ücret bağı ek hizmet kalemiyle (ON-087) eklenecek; bugün yalnız gün sayısı hesaplanır.';
--> statement-breakpoint
COMMENT ON COLUMN "meal_subscriptions"."institution_id" IS 'Kurum; birincil anahtarın ve her indeksin ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "meal_subscriptions"."id" IS 'Abonelik kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "meal_subscriptions"."student_id" IS 'Öğrenci (records students kimliği; yabancı anahtar yok). Çocuk verisi; veli yalnız bağlı çocuğunun aboneliğini görür.';
--> statement-breakpoint
COMMENT ON COLUMN "meal_subscriptions"."meal_kind" IS 'Öğün: breakfast (kahvaltı), lunch (öğle), snack (ikindi ara öğünü); açılışta kurumun yemek menüsü ayarında açık olmalı.';
--> statement-breakpoint
COMMENT ON COLUMN "meal_subscriptions"."start_date" IS 'İlk yemek günü (Europe/Istanbul takvim günü); açılışta bugünden önce olamaz.';
--> statement-breakpoint
COMMENT ON COLUMN "meal_subscriptions"."end_date" IS 'Son yemek günü (dahil); başlangıçtan önce olamaz, abonelik en çok 366 gün.';
--> statement-breakpoint
COMMENT ON COLUMN "meal_subscriptions"."weekdays" IS 'Yemek günleri (ISO hafta günü: 1 pazartesi … 7 pazar; en az bir).';
--> statement-breakpoint
COMMENT ON COLUMN "meal_subscriptions"."diet_type" IS 'Diyet türü: standard (normal), vegetarian (vejetaryen), gluten_free (glütensiz), lactose_free (laktozsuz), other (diğer). Yemek hizmeti tercihi olarak tutulur, sağlık kaydı değildir; tıbbi gerekçe sağlık profilinde kalır (K-547).';
--> statement-breakpoint
COMMENT ON COLUMN "meal_subscriptions"."diet_note" IS 'Yalnız other türünde dolu kısa açıklama (2–200 karakter); tıbbi ayrıntı yazılmaz. Serbest metin; loga ve denetim değerine yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "meal_subscriptions"."created_by_user_id" IS 'Aboneliği açan kullanıcı (yönetici ya da ön büro).';
--> statement-breakpoint
COMMENT ON COLUMN "meal_subscriptions"."created_at" IS 'Oluşturulma anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "meal_subscriptions"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "meal_subscriptions"."archived_at" IS 'Arşiv anı (yalnız başlamamış abonelik); dolu satır okunmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "meal_subscriptions"."version" IS 'İyimser kilit sürümü (If-Match); her yazmada 1 artar.';
--> statement-breakpoint
COMMENT ON TABLE "meal_subscription_cancellations" IS 'Yemek günü iptali (DOM-FIN-164, K-548): aboneliğin bir yemek günü veli ya da okul tarafından iptal edilir. Kesim (meal_subscription_settings) geçince veli iptal edemez; okulun iptali late işaretlenir ve iade/mahsup gününe girmez. Tatil günü ve geçmiş gün iptal edilmez. Geri alma satırı arşivler (geri alanla); etkin iptal abonelik ve gün başına tektir. Gerekçe alınmaz. Günlük mutfak sayısı ve aylık özet bu satırlardan okumada hesaplanır (K-549).';
--> statement-breakpoint
COMMENT ON COLUMN "meal_subscription_cancellations"."institution_id" IS 'Kurum; birincil anahtarın ve her indeksin ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "meal_subscription_cancellations"."id" IS 'İptal kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "meal_subscription_cancellations"."subscription_id" IS 'Abonelik (meal_subscriptions).';
--> statement-breakpoint
COMMENT ON COLUMN "meal_subscription_cancellations"."meal_date" IS 'İptal edilen yemek günü (Europe/Istanbul takvim günü); aboneliğin yemek günü.';
--> statement-breakpoint
COMMENT ON COLUMN "meal_subscription_cancellations"."late" IS 'Kesimden sonra okulun yaptığı iptal: mutfak sayısından düşülür ama iade/mahsup gününe girmez. Velinin iptali hiçbir zaman geç değildir.';
--> statement-breakpoint
COMMENT ON COLUMN "meal_subscription_cancellations"."cancelled_by" IS 'İptal eden taraf: family (veli) ya da school (yönetici, ön büro).';
--> statement-breakpoint
COMMENT ON COLUMN "meal_subscription_cancellations"."cancelled_by_user_id" IS 'İptali yapan kullanıcı.';
--> statement-breakpoint
COMMENT ON COLUMN "meal_subscription_cancellations"."restored_by_user_id" IS 'İptali geri alan kullanıcı; yalnız arşivli (geri alınmış) satırda dolu.';
--> statement-breakpoint
COMMENT ON COLUMN "meal_subscription_cancellations"."created_at" IS 'İptal anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "meal_subscription_cancellations"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "meal_subscription_cancellations"."archived_at" IS 'Geri alma anı; dolu satır etkin iptal sayılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "meal_subscription_cancellations"."version" IS 'İyimser kilit sürümü (If-Match); her yazmada 1 artar.';
--> statement-breakpoint
COMMENT ON TABLE "meal_subscription_settings" IS 'Gün iptali kesimi (DOM-FIN-164, K-548): iptalin son anı yemek gününden cutoff_days_before gün önce, cutoff_time saatinde (Europe/Istanbul). Satır yoksa bir gün önce 15:00; ilk kayıt satırı sürüm 2 ile açar. Yalnız yönetici değiştirir.';
--> statement-breakpoint
COMMENT ON COLUMN "meal_subscription_settings"."institution_id" IS 'Kurum; birincil anahtar.';
--> statement-breakpoint
COMMENT ON COLUMN "meal_subscription_settings"."cutoff_days_before" IS 'Kesim yemek gününden kaç gün önce (0 aynı gün, en çok 7).';
--> statement-breakpoint
COMMENT ON COLUMN "meal_subscription_settings"."cutoff_time" IS 'Kesim saati (SS:DD, Europe/Istanbul duvar saati).';
--> statement-breakpoint
COMMENT ON COLUMN "meal_subscription_settings"."created_at" IS 'Oluşturulma anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "meal_subscription_settings"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "meal_subscription_settings"."archived_at" IS 'Arşiv anı; kullanılmaz, kurum tablosu zorunlu kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "meal_subscription_settings"."version" IS 'İyimser kilit sürümü (If-Match); her yazmada 1 artar.';
