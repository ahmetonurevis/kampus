CREATE TABLE "infirmary_medication_administrations" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"consent_id" uuid NOT NULL,
	"student_id" text NOT NULL,
	"dose_day" date NOT NULL,
	"scheduled_time" text NOT NULL,
	"administered_at" timestamp with time zone NOT NULL,
	"administered_by_membership_id" text NOT NULL,
	"recorded_by_user_id" text NOT NULL,
	"health_ciphertext" text NOT NULL,
	"health_key_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "infirmary_medication_administrations_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "infirmary_medication_administrations_time_check" CHECK ("infirmary_medication_administrations"."scheduled_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
	CONSTRAINT "infirmary_medication_administrations_key_version_check" CHECK ("infirmary_medication_administrations"."health_key_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "infirmary_medication_consents" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"student_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"dose_times" text[] NOT NULL,
	"health_ciphertext" text NOT NULL,
	"health_key_version" integer NOT NULL,
	"requested_by_membership_id" text NOT NULL,
	"requested_by_user_id" text NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by_user_id" text,
	"decision_ciphertext" text,
	"decision_key_version" integer,
	"withdrawn_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "infirmary_medication_consents_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "infirmary_medication_consents_status_check" CHECK ("infirmary_medication_consents"."status" in ('pending', 'approved', 'rejected', 'withdrawn')),
	CONSTRAINT "infirmary_medication_consents_period_check" CHECK ("infirmary_medication_consents"."end_date" >= "infirmary_medication_consents"."start_date"),
	CONSTRAINT "infirmary_medication_consents_times_check" CHECK (cardinality("infirmary_medication_consents"."dose_times") between 1 and 6),
	CONSTRAINT "infirmary_medication_consents_key_version_check" CHECK ("infirmary_medication_consents"."health_key_version" > 0 and ("infirmary_medication_consents"."decision_key_version" is null or "infirmary_medication_consents"."decision_key_version" > 0)),
	CONSTRAINT "infirmary_medication_consents_decision_check" CHECK ((("infirmary_medication_consents"."decided_at" is null) = ("infirmary_medication_consents"."decided_by_user_id" is null))
        and (("infirmary_medication_consents"."status" = 'pending') or ("infirmary_medication_consents"."status" = 'withdrawn') or ("infirmary_medication_consents"."decided_at" is not null))
        and (("infirmary_medication_consents"."status" = 'rejected') = ("infirmary_medication_consents"."decision_ciphertext" is not null))
        and (("infirmary_medication_consents"."decision_ciphertext" is null) = ("infirmary_medication_consents"."decision_key_version" is null))
        and (("infirmary_medication_consents"."status" = 'withdrawn') = ("infirmary_medication_consents"."withdrawn_at" is not null)))
);
--> statement-breakpoint
CREATE TABLE "infirmary_visits" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"student_id" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"arrived_at" timestamp with time zone NOT NULL,
	"returned_at" timestamp with time zone,
	"outcome" text,
	"referred_by_membership_id" text,
	"incident_report_id" uuid,
	"health_ciphertext" text NOT NULL,
	"health_key_version" integer NOT NULL,
	"created_by_user_id" text NOT NULL,
	"closed_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "infirmary_visits_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "infirmary_visits_status_check" CHECK ("infirmary_visits"."status" in ('open', 'closed')),
	CONSTRAINT "infirmary_visits_outcome_check" CHECK ("infirmary_visits"."outcome" is null or "infirmary_visits"."outcome" in ('returned_to_class', 'went_home', 'referred')),
	CONSTRAINT "infirmary_visits_closed_check" CHECK ((("infirmary_visits"."status" = 'closed') = ("infirmary_visits"."returned_at" is not null))
        and (("infirmary_visits"."returned_at" is null) = ("infirmary_visits"."outcome" is null))
        and (("infirmary_visits"."returned_at" is null) = ("infirmary_visits"."closed_by_user_id" is null))
        and ("infirmary_visits"."returned_at" is null or "infirmary_visits"."returned_at" >= "infirmary_visits"."arrived_at")),
	CONSTRAINT "infirmary_visits_key_version_check" CHECK ("infirmary_visits"."health_key_version" > 0)
);
--> statement-breakpoint
ALTER TABLE "infirmary_medication_administrations" ADD CONSTRAINT "infirmary_medication_administrations_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infirmary_medication_administrations" ADD CONSTRAINT "infirmary_medication_administrations_consent_fkey" FOREIGN KEY ("institution_id","consent_id") REFERENCES "public"."infirmary_medication_consents"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infirmary_medication_administrations" ADD CONSTRAINT "infirmary_medication_administrations_administered_by_fkey" FOREIGN KEY ("institution_id","administered_by_membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infirmary_medication_consents" ADD CONSTRAINT "infirmary_medication_consents_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infirmary_medication_consents" ADD CONSTRAINT "infirmary_medication_consents_requested_by_fkey" FOREIGN KEY ("institution_id","requested_by_membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infirmary_visits" ADD CONSTRAINT "infirmary_visits_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infirmary_visits" ADD CONSTRAINT "infirmary_visits_referred_by_fkey" FOREIGN KEY ("institution_id","referred_by_membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infirmary_visits" ADD CONSTRAINT "infirmary_visits_incident_report_fkey" FOREIGN KEY ("institution_id","incident_report_id") REFERENCES "public"."incident_reports"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "infirmary_medication_administrations_dose_key" ON "infirmary_medication_administrations" USING btree ("institution_id","consent_id","dose_day","scheduled_time");--> statement-breakpoint
CREATE INDEX "infirmary_medication_administrations_student_idx" ON "infirmary_medication_administrations" USING btree ("institution_id","student_id","administered_at");--> statement-breakpoint
CREATE INDEX "infirmary_medication_administrations_day_idx" ON "infirmary_medication_administrations" USING btree ("institution_id","dose_day");--> statement-breakpoint
CREATE INDEX "infirmary_medication_administrations_administered_by_idx" ON "infirmary_medication_administrations" USING btree ("institution_id","administered_by_membership_id");--> statement-breakpoint
CREATE INDEX "infirmary_medication_consents_student_idx" ON "infirmary_medication_consents" USING btree ("institution_id","student_id","start_date");--> statement-breakpoint
CREATE INDEX "infirmary_medication_consents_period_idx" ON "infirmary_medication_consents" USING btree ("institution_id","status","start_date","end_date");--> statement-breakpoint
CREATE INDEX "infirmary_medication_consents_requested_by_idx" ON "infirmary_medication_consents" USING btree ("institution_id","requested_by_membership_id");--> statement-breakpoint
CREATE UNIQUE INDEX "infirmary_visits_open_student_key" ON "infirmary_visits" USING btree ("institution_id","student_id") WHERE "infirmary_visits"."status" = 'open' and "infirmary_visits"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "infirmary_visits_arrived_idx" ON "infirmary_visits" USING btree ("institution_id","arrived_at");--> statement-breakpoint
CREATE INDEX "infirmary_visits_student_idx" ON "infirmary_visits" USING btree ("institution_id","student_id","arrived_at");--> statement-breakpoint
CREATE INDEX "infirmary_visits_referred_by_idx" ON "infirmary_visits" USING btree ("institution_id","referred_by_membership_id") WHERE "infirmary_visits"."referred_by_membership_id" is not null;--> statement-breakpoint
CREATE INDEX "infirmary_visits_incident_report_idx" ON "infirmary_visits" USING btree ("institution_id","incident_report_id") WHERE "infirmary_visits"."incident_report_id" is not null;--> statement-breakpoint
-- Kapanan revir ziyareti değişmez ve silinmez (DOM-FIN-151, K-508); açık ziyaret düzeltilir.
-- Reddedilen ve geri çekilen ilaç talebi değişmez (K-509); onaylı talep yalnız geri çekilir. İlaç
-- uygulaması hiç değişmez. Uygulama aynı kuralları 409 ile verir; bunlar son güvencedir.
CREATE FUNCTION "kampus_guard_infirmary_visit"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'closed' THEN
    RAISE EXCEPTION 'kampus: closed infirmary visit is immutable (%)', TG_OP
      USING ERRCODE = '55000', TABLE = TG_TABLE_NAME;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION "kampus_guard_infirmary_consent"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('rejected', 'withdrawn') THEN
    RAISE EXCEPTION 'kampus: closed medication consent is immutable (%)', TG_OP
      USING ERRCODE = '55000', TABLE = TG_TABLE_NAME;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'kampus: medication consent is not deleted (%)', TG_OP
      USING ERRCODE = '55000', TABLE = TG_TABLE_NAME;
  END IF;
  IF OLD.status = 'approved' AND NEW.status <> 'withdrawn' THEN
    RAISE EXCEPTION 'kampus: approved medication consent only withdraws (%)', TG_OP
      USING ERRCODE = '55000', TABLE = TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "infirmary_visits_closed_trigger" BEFORE UPDATE OR DELETE ON "infirmary_visits" FOR EACH ROW EXECUTE FUNCTION "kampus_guard_infirmary_visit"();--> statement-breakpoint
CREATE TRIGGER "infirmary_medication_consents_closed_trigger" BEFORE UPDATE OR DELETE ON "infirmary_medication_consents" FOR EACH ROW EXECUTE FUNCTION "kampus_guard_infirmary_consent"();--> statement-breakpoint
CREATE TRIGGER "infirmary_medication_administrations_immutable_trigger" BEFORE UPDATE OR DELETE ON "infirmary_medication_administrations" FOR EACH ROW EXECUTE FUNCTION "kampus_reject_immutable_change"();--> statement-breakpoint
CREATE TRIGGER "infirmary_medication_administrations_truncate_trigger" BEFORE TRUNCATE ON "infirmary_medication_administrations" FOR EACH STATEMENT EXECUTE FUNCTION "kampus_reject_immutable_change"();
--> statement-breakpoint
COMMENT ON TABLE "infirmary_visits" IS 'Revir ziyareti (DOM-FIN-151, ON-101, IST-102, K-508…K-510): öğrenci, geliş ve dönüş anı, sonuç, gönderen personel, kaza tutanağı bağı ve şifreli sağlık grubu (şikâyet, yapılanlar, not). Ziyaret açık (revirde) başlar, dönüşle kapanır; kapanan ziyaret değişmez ve silinmez (tetikleyici). Öğrencinin aynı anda tek açık ziyareti olur. Yönetici ve ön büro okur ve yazar; sınıf öğretmeni yalnız revirde / döndü durumunu görür; veli kendi çocuğunun özetini görür. Sağlık profili kopyalanmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_visits"."institution_id" IS 'Kurum; birincil anahtarın ve her indeksin ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_visits"."id" IS 'Ziyaret kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_visits"."student_id" IS 'Revire gelen öğrenci kaydı (records students kimliği; yabancı anahtar yok). Kişisel veri.';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_visits"."status" IS 'open revirde, closed ayrıldı. Kapanan satır değişmez.';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_visits"."arrived_at" IS 'Revire geliş anı (UTC); gelecekte ve 7 günden eski olamaz.';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_visits"."returned_at" IS 'Revirden ayrılış anı (UTC); yalnız kapanmış ziyarette, gelişten önce olamaz.';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_visits"."outcome" IS 'Sonuç: returned_to_class sınıfa döndü, went_home eve gitti, referred sevk. Sağlık verisi sayılır; öğretmene gitmez.';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_visits"."referred_by_membership_id" IS 'Öğrenciyi revire gönderen kurum personeli üyeliği; kendisi geldiyse boş.';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_visits"."incident_report_id" IS 'Kaza kaynaklı ziyarette aynı öğrencinin kaza tutanağı (incident_reports, DOM-FIN-146).';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_visits"."health_ciphertext" IS 'Özel nitelikli: şikâyet, yapılanlar ve revir notu JSON; AES-256-GCM ile kurum anahtarıyla şifreli, satır ve öğrenciye bağlı. Düz metin tutulmaz, loglanmaz, denetime yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_visits"."health_key_version" IS 'Sağlık grubunu şifreleyen anahtarın sürümü (> 0).';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_visits"."created_by_user_id" IS 'Ziyareti açan kullanıcı.';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_visits"."closed_by_user_id" IS 'Ziyareti kapatan kullanıcı; yalnız kapanmış ziyarette.';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_visits"."created_at" IS 'Satırın yazıldığı an (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_visits"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_visits"."archived_at" IS 'Arşiv anı; bugün kullanılmaz (ziyaret silinmez, H-109).';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_visits"."version" IS 'İyimser kilit sürümü (If-Match).';
--> statement-breakpoint
COMMENT ON TABLE "infirmary_medication_consents" IS 'Veli ilaç onayı (DOM-FIN-151, K-509): velinin kendi çocuğu için ilaç talebi; dönem ve doz saatleri düz, ilaç adı, doz ve veli notu şifreli. Okul (yönetici, ön büro) onaylar ya da gerekçeyle reddeder, veli geri çeker. Onaysız ilaç verilmez. Reddedilen ve geri çekilen talep değişmez, onaylı talep yalnız geri çekilir, satır silinmez (tetikleyici).';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_consents"."institution_id" IS 'Kurum; birincil anahtarın ve her indeksin ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_consents"."id" IS 'Talep kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_consents"."student_id" IS 'İlacı kullanacak öğrenci kaydı; velinin kapsamındaki (velayetli ve kısıtsız bağ) çocuk. Kişisel veri.';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_consents"."status" IS 'pending onay bekliyor, approved onaylandı, rejected reddedildi, withdrawn veli geri çekti.';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_consents"."start_date" IS 'İlk gün (Europe/Istanbul takvim günü); talep anında bugünden önce ve 60 günden sonra olamaz.';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_consents"."end_date" IS 'Son gün (dahil); ilk günden önce olamaz, dönem en çok 90 gün.';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_consents"."dose_times" IS 'Doz saatleri (SS:DD, Europe/Istanbul; 1–6, sıralı, tekil). Uygulama yalnız bu saatlerde yazılır.';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_consents"."health_ciphertext" IS 'Özel nitelikli: ilaç adı, doz ve veli notu JSON; AES-256-GCM ile kurum anahtarıyla şifreli, satır ve öğrenciye bağlı. Düz metin tutulmaz, loglanmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_consents"."health_key_version" IS 'Sağlık grubunu şifreleyen anahtarın sürümü (> 0).';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_consents"."requested_by_membership_id" IS 'Talebi açan veli üyeliği.';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_consents"."requested_by_user_id" IS 'Talebi açan veli kullanıcısı (onayın biçimi H-109).';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_consents"."decided_at" IS 'Onay ya da ret anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_consents"."decided_by_user_id" IS 'Onaylayan ya da reddeden okul kullanıcısı.';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_consents"."decision_ciphertext" IS 'Özel nitelikli olabilir: ret gerekçesi, şifreli; yalnız reddedilen talepte. Veliye döner.';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_consents"."decision_key_version" IS 'Ret gerekçesini şifreleyen anahtarın sürümü; gerekçe yoksa boş.';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_consents"."withdrawn_at" IS 'Velinin talebi geri çektiği an; yalnız geri çekilmiş talepte.';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_consents"."created_at" IS 'Satırın yazıldığı an (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_consents"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_consents"."archived_at" IS 'Arşiv anı; bugün kullanılmaz (talep silinmez, H-109).';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_consents"."version" IS 'İyimser kilit sürümü (If-Match).';
--> statement-breakpoint
COMMENT ON TABLE "infirmary_medication_administrations" IS 'İlaç uygulaması (DOM-FIN-151, K-509; ON-161 genişletir): onaylı talebin bir doz saatinin bir günde verilişi; uygulama anı, uygulayan personel ve şifreli doz ile not. Aynı talepte aynı günün aynı doz saati tekildir; satır yalnız eklenir (kampus_reject_immutable_change).';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_administrations"."institution_id" IS 'Kurum; birincil anahtarın ve her indeksin ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_administrations"."id" IS 'Uygulama kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_administrations"."consent_id" IS 'Onaylı ilaç talebi (infirmary_medication_consents).';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_administrations"."student_id" IS 'İlacı alan öğrenci kaydı; talepten kopya. Kişisel veri.';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_administrations"."dose_day" IS 'Uygulama anının Europe/Istanbul günü; onay dönemi içinde olmalı.';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_administrations"."scheduled_time" IS 'Onaydaki doz saati (SS:DD); gün ve talep ile birlikte tekil.';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_administrations"."administered_at" IS 'İlacın verildiği an (UTC); gelecekte ve 24 saatten eski olamaz.';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_administrations"."administered_by_membership_id" IS 'İlacı veren kurum personeli üyeliği.';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_administrations"."recorded_by_user_id" IS 'Kaydı yazan kullanıcı.';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_administrations"."health_ciphertext" IS 'Özel nitelikli: verilen doz ve not JSON; AES-256-GCM ile kurum anahtarıyla şifreli, satır ve talebe bağlı. Düz metin tutulmaz, loglanmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_administrations"."health_key_version" IS 'Sağlık grubunu şifreleyen anahtarın sürümü (> 0).';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_administrations"."created_at" IS 'Satırın yazıldığı an (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_administrations"."updated_at" IS 'Yazıldığı an (UTC); satır değişmez.';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_administrations"."archived_at" IS 'Arşiv anı; bugün kullanılmaz (uygulama silinmez, H-109).';
--> statement-breakpoint
COMMENT ON COLUMN "infirmary_medication_administrations"."version" IS 'Sürüm; satır değişmediğinden hep 1.';
