CREATE TABLE "infirmary_medication_dose_corrections" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"consent_id" uuid NOT NULL,
	"target_kind" text NOT NULL,
	"administration_id" uuid,
	"skip_id" uuid,
	"kind" text NOT NULL,
	"administered_at" timestamp with time zone,
	"administered_by_membership_id" text,
	"health_ciphertext" text NOT NULL,
	"health_key_version" integer NOT NULL,
	"corrected_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "infirmary_medication_dose_corrections_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "infirmary_medication_dose_corrections_kind_check" CHECK ("infirmary_medication_dose_corrections"."kind" in ('void', 'amend') and "infirmary_medication_dose_corrections"."target_kind" in ('administration', 'skip')),
	CONSTRAINT "infirmary_medication_dose_corrections_target_check" CHECK ((("infirmary_medication_dose_corrections"."target_kind" = 'administration') = ("infirmary_medication_dose_corrections"."administration_id" is not null))
        and (("infirmary_medication_dose_corrections"."target_kind" = 'skip') = ("infirmary_medication_dose_corrections"."skip_id" is not null))
        and (("infirmary_medication_dose_corrections"."kind" = 'amend' and "infirmary_medication_dose_corrections"."target_kind" = 'administration')
          or ("infirmary_medication_dose_corrections"."administered_at" is null and "infirmary_medication_dose_corrections"."administered_by_membership_id" is null))),
	CONSTRAINT "infirmary_medication_dose_corrections_key_version_check" CHECK ("infirmary_medication_dose_corrections"."health_key_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "infirmary_medication_settings" (
	"institution_id" text PRIMARY KEY NOT NULL,
	"late_tolerance_minutes" integer DEFAULT 30 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "infirmary_medication_settings_tolerance_check" CHECK ("infirmary_medication_settings"."late_tolerance_minutes" between 5 and 180)
);
--> statement-breakpoint
CREATE TABLE "infirmary_medication_skips" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"consent_id" uuid NOT NULL,
	"student_id" text NOT NULL,
	"dose_day" date NOT NULL,
	"scheduled_time" text NOT NULL,
	"replaces_skip_id" uuid,
	"health_ciphertext" text NOT NULL,
	"health_key_version" integer NOT NULL,
	"recorded_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "infirmary_medication_skips_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "infirmary_medication_skips_time_check" CHECK ("infirmary_medication_skips"."scheduled_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
	CONSTRAINT "infirmary_medication_skips_key_version_check" CHECK ("infirmary_medication_skips"."health_key_version" > 0)
);
--> statement-breakpoint
DROP INDEX "infirmary_medication_administrations_dose_key";--> statement-breakpoint
ALTER TABLE "infirmary_medication_administrations" ADD COLUMN "replaces_administration_id" uuid;--> statement-breakpoint
ALTER TABLE "infirmary_medication_dose_corrections" ADD CONSTRAINT "infirmary_medication_dose_corrections_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infirmary_medication_dose_corrections" ADD CONSTRAINT "infirmary_medication_dose_corrections_consent_fkey" FOREIGN KEY ("institution_id","consent_id") REFERENCES "public"."infirmary_medication_consents"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infirmary_medication_dose_corrections" ADD CONSTRAINT "infirmary_medication_dose_corrections_administration_fkey" FOREIGN KEY ("institution_id","administration_id") REFERENCES "public"."infirmary_medication_administrations"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infirmary_medication_dose_corrections" ADD CONSTRAINT "infirmary_medication_dose_corrections_skip_fkey" FOREIGN KEY ("institution_id","skip_id") REFERENCES "public"."infirmary_medication_skips"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infirmary_medication_dose_corrections" ADD CONSTRAINT "infirmary_medication_dose_corrections_administered_by_fkey" FOREIGN KEY ("institution_id","administered_by_membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infirmary_medication_settings" ADD CONSTRAINT "infirmary_medication_settings_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infirmary_medication_skips" ADD CONSTRAINT "infirmary_medication_skips_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infirmary_medication_skips" ADD CONSTRAINT "infirmary_medication_skips_consent_fkey" FOREIGN KEY ("institution_id","consent_id") REFERENCES "public"."infirmary_medication_consents"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infirmary_medication_skips" ADD CONSTRAINT "infirmary_medication_skips_replaces_fkey" FOREIGN KEY ("institution_id","replaces_skip_id") REFERENCES "public"."infirmary_medication_skips"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "infirmary_medication_dose_corrections_void_administration_key" ON "infirmary_medication_dose_corrections" USING btree ("institution_id","administration_id") WHERE "infirmary_medication_dose_corrections"."kind" = 'void' and "infirmary_medication_dose_corrections"."administration_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "infirmary_medication_dose_corrections_void_skip_key" ON "infirmary_medication_dose_corrections" USING btree ("institution_id","skip_id") WHERE "infirmary_medication_dose_corrections"."kind" = 'void' and "infirmary_medication_dose_corrections"."skip_id" is not null;--> statement-breakpoint
CREATE INDEX "infirmary_medication_dose_corrections_administration_idx" ON "infirmary_medication_dose_corrections" USING btree ("institution_id","administration_id") WHERE "infirmary_medication_dose_corrections"."administration_id" is not null;--> statement-breakpoint
CREATE INDEX "infirmary_medication_dose_corrections_skip_idx" ON "infirmary_medication_dose_corrections" USING btree ("institution_id","skip_id") WHERE "infirmary_medication_dose_corrections"."skip_id" is not null;--> statement-breakpoint
CREATE INDEX "infirmary_medication_dose_corrections_consent_idx" ON "infirmary_medication_dose_corrections" USING btree ("institution_id","consent_id");--> statement-breakpoint
CREATE INDEX "infirmary_medication_dose_corrections_administered_by_idx" ON "infirmary_medication_dose_corrections" USING btree ("institution_id","administered_by_membership_id") WHERE "infirmary_medication_dose_corrections"."administered_by_membership_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "infirmary_medication_skips_dose_key" ON "infirmary_medication_skips" USING btree ("institution_id","consent_id","dose_day","scheduled_time") WHERE "infirmary_medication_skips"."replaces_skip_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "infirmary_medication_skips_replaces_key" ON "infirmary_medication_skips" USING btree ("institution_id","replaces_skip_id") WHERE "infirmary_medication_skips"."replaces_skip_id" is not null;--> statement-breakpoint
CREATE INDEX "infirmary_medication_skips_consent_idx" ON "infirmary_medication_skips" USING btree ("institution_id","consent_id","dose_day");--> statement-breakpoint
CREATE INDEX "infirmary_medication_skips_student_idx" ON "infirmary_medication_skips" USING btree ("institution_id","student_id","dose_day");--> statement-breakpoint
CREATE INDEX "infirmary_medication_skips_day_idx" ON "infirmary_medication_skips" USING btree ("institution_id","dose_day");--> statement-breakpoint
ALTER TABLE "infirmary_medication_administrations" ADD CONSTRAINT "infirmary_medication_administrations_replaces_fkey" FOREIGN KEY ("institution_id","replaces_administration_id") REFERENCES "public"."infirmary_medication_administrations"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "infirmary_medication_administrations_replaces_key" ON "infirmary_medication_administrations" USING btree ("institution_id","replaces_administration_id") WHERE "infirmary_medication_administrations"."replaces_administration_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "infirmary_medication_administrations_dose_key" ON "infirmary_medication_administrations" USING btree ("institution_id","consent_id","dose_day","scheduled_time") WHERE "infirmary_medication_administrations"."replaces_administration_id" is null;--> statement-breakpoint
-- Atlama ve düzeltme kaydı yalnız eklenir (DOM-FIN-152, K-512, K-513): yanlış kayıt silinmez, değişmez;
-- düzeltme yeni satırdır. Uygulama aynı kuralları 409 ile verir; tetikleyici son güvencedir.
CREATE TRIGGER "infirmary_medication_skips_immutable_trigger" BEFORE UPDATE OR DELETE ON "infirmary_medication_skips" FOR EACH ROW EXECUTE FUNCTION "kampus_reject_immutable_change"();
--> statement-breakpoint
CREATE TRIGGER "infirmary_medication_skips_truncate_trigger" BEFORE TRUNCATE ON "infirmary_medication_skips" FOR EACH STATEMENT EXECUTE FUNCTION "kampus_reject_immutable_change"();
--> statement-breakpoint
CREATE TRIGGER "infirmary_medication_dose_corrections_immutable_trigger" BEFORE UPDATE OR DELETE ON "infirmary_medication_dose_corrections" FOR EACH ROW EXECUTE FUNCTION "kampus_reject_immutable_change"();
--> statement-breakpoint
CREATE TRIGGER "infirmary_medication_dose_corrections_truncate_trigger" BEFORE TRUNCATE ON "infirmary_medication_dose_corrections" FOR EACH STATEMENT EXECUTE FUNCTION "kampus_reject_immutable_change"();
--> statement-breakpoint
COMMENT ON TABLE "infirmary_medication_skips" IS 'Atlanan doz (DOM-FIN-152, ON-161, IST-102, K-512): onaylı talebin bir doz saatinin bir günde verilmeyişi; şifreli gerekçe (öğrenci okulda yok, reddetti, veli iptal etti, diğer) ve açıklama. Bir doz saatinin tek etkin sonucu olur (uygulama ya da atlama; uygulama kilit altında denetler). İlk atlama tekildir; iptal edilen atlamanın yerine yazılan kayıt replaces_skip_id ile zinciri sürdürür. Satır yalnız eklenir (kampus_reject_immutable_change); düzeltme ve iptal infirmary_medication_dose_corrections tablosundadır. Yönetici ve ön büro yazar; veli kendi çocuğununkini gerekçesiyle okur.';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_skips"."institution_id" IS 'Kurum; birincil anahtarın ve her indeksin ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_skips"."id" IS 'Atlama kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_skips"."consent_id" IS 'Onaylı ilaç talebi (infirmary_medication_consents).';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_skips"."student_id" IS 'Dozu atlanan öğrenci kaydı; talepten kopya (veli listesi için). Kişisel veri.';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_skips"."dose_day" IS 'Doz günü (Europe/Istanbul); bugün ya da dün ve onay dönemi içinde.';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_skips"."scheduled_time" IS 'Onaydaki doz saati (SS:DD).';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_skips"."replaces_skip_id" IS 'İptal edilen aynı doz saati atlamasının yerine geçiyorsa onun kimliği; boşsa doz saatinin ilk atlaması (talep, gün ve saatle tekil). Her atlamanın yerine en çok bir kez geçilir.';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_skips"."health_ciphertext" IS 'Özel nitelikli: atlama gerekçesi ve açıklama JSON; AES-256-GCM ile kurum anahtarıyla şifreli, satır ve talebe bağlı. Düz metin tutulmaz, loglanmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_skips"."health_key_version" IS 'Sağlık grubunu şifreleyen anahtarın sürümü (> 0).';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_skips"."recorded_by_user_id" IS 'Atlamayı yazan kullanıcı.';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_skips"."created_at" IS 'Atlamanın yazıldığı an (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_skips"."updated_at" IS 'Yazıldığı an (UTC); satır değişmez.';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_skips"."archived_at" IS 'Arşiv anı; bugün kullanılmaz (atlama silinmez, H-109).';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_skips"."version" IS 'Sürüm; satır değişmediğinden hep 1.';
--> statement-breakpoint
COMMENT ON TABLE "infirmary_medication_dose_corrections" IS 'Doz kaydı düzeltmesi (DOM-FIN-152, K-513): yönetici uygulama ya da atlama kaydına gerekçeli iptal (kayıt hiç olmamış sayılır, doz saati yeniden sonuçlanabilir) ya da düzeltme (uygulamada an, uygulayan ve not; atlamada gerekçe ve açıklama) ekler; asıl kayıt değişmez. Etkin değer kayıt üzerine düzeltmelerin sırayla uygulanmasıdır. Her kaydın en çok bir iptali olur (kısmi tekil indeks); iptal edilmiş kayıt düzeltilmez. Satır yalnız eklenir (kampus_reject_immutable_change).';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_dose_corrections"."institution_id" IS 'Kurum; birincil anahtarın ve her indeksin ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_dose_corrections"."id" IS 'Düzeltme kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_dose_corrections"."consent_id" IS 'Kaydın ait olduğu ilaç talebi (infirmary_medication_consents).';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_dose_corrections"."target_kind" IS 'Düzeltilen kaydın türü: administration (uygulama) ya da skip (atlama).';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_dose_corrections"."administration_id" IS 'Düzeltilen uygulama (infirmary_medication_administrations); yalnız target_kind = administration iken dolu.';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_dose_corrections"."skip_id" IS 'Düzeltilen atlama (infirmary_medication_skips); yalnız target_kind = skip iken dolu.';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_dose_corrections"."kind" IS 'void iptal ya da amend düzeltme; kayıt başına en çok bir void.';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_dose_corrections"."administered_at" IS 'Düzeltilmiş uygulama anı (UTC); yalnız uygulama düzeltmesinde, kaydın doz günüyle aynı gün. Boşsa an değişmedi.';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_dose_corrections"."administered_by_membership_id" IS 'Düzeltilmiş uygulayan kurum personeli üyeliği; yalnız uygulama düzeltmesinde. Boşsa değişmedi. Kişisel veri.';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_dose_corrections"."health_ciphertext" IS 'Özel nitelikli: düzeltme gerekçesi ve verildiyse düzeltilmiş not ya da atlama gerekçesi JSON; AES-256-GCM ile kurum anahtarıyla şifreli, satır ve düzeltilen kayda bağlı. Düz metin tutulmaz, loglanmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_dose_corrections"."health_key_version" IS 'Şifreli grubu şifreleyen anahtarın sürümü (> 0).';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_dose_corrections"."corrected_by_user_id" IS 'Düzeltmeyi yazan yönetici kullanıcı.';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_dose_corrections"."created_at" IS 'Düzeltmenin yazıldığı an (UTC); düzeltmeler bu sırayla uygulanır.';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_dose_corrections"."updated_at" IS 'Yazıldığı an (UTC); satır değişmez.';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_dose_corrections"."archived_at" IS 'Arşiv anı; bugün kullanılmaz (düzeltme silinmez, H-109).';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_dose_corrections"."version" IS 'Sürüm; satır değişmediğinden hep 1.';
--> statement-breakpoint
COMMENT ON TABLE "infirmary_medication_settings" IS 'İlaç çizelgesi ayarı (DOM-FIN-152, K-511): kurum başına bir satır; satır yoksa varsayılan (gecikme payı 30 dk). Yalnız yönetici değiştirir (If-Match).';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_settings"."institution_id" IS 'Kurum; birincil anahtar.';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_settings"."late_tolerance_minutes" IS 'Doz saatinden sonra sonuçsuz doz gecikti sayılmadan önceki pay, dakika (5–180; varsayılan 30).';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_settings"."created_at" IS 'Ayarın ilk kaydedildiği an (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_settings"."updated_at" IS 'Ayarın son değiştiği an (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_settings"."archived_at" IS 'Arşiv anı; kullanılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_settings"."version" IS 'İyimser kilit sürümü; satır yokken istemciye 1 döner, ilk kayıt 2 ile açılır.';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_administrations"."replaces_administration_id" IS 'İptal edilen aynı doz saati uygulamasının yerine geçiyorsa onun kimliği (DOM-FIN-152, K-513); boşsa doz saatinin ilk uygulaması (talep, gün ve saatle tekil). Her uygulamanın yerine en çok bir kez geçilir.';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_administrations"."scheduled_time" IS 'Onaydaki doz saati (SS:DD); ilk uygulama gün ve talep ile birlikte tekil, iptal sonrası kayıt zinciri sürdürür (DOM-FIN-152).';
--> statement-breakpoint
COMMENT ON TABLE "infirmary_medication_administrations" IS 'İlaç uygulaması (DOM-FIN-151, K-509; DOM-FIN-152, ON-161): onaylı talebin bir doz saatinin bir günde verilişi; uygulama anı, uygulayan personel ve şifreli doz ile not. Aynı talepte aynı günün aynı doz saatinin ilk uygulaması tekildir; yönetici iptal ederse yerine yazılan kayıt replaces_administration_id ile zinciri sürdürür, doz saatinin tek etkin sonucu olur. Satır yalnız eklenir (kampus_reject_immutable_change); düzeltme infirmary_medication_dose_corrections tablosundadır.';
