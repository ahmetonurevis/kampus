CREATE TABLE "incident_report_addenda" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"note_ciphertext" text NOT NULL,
	"note_key_version" integer NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "incident_report_addenda_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "incident_report_addenda_key_version_check" CHECK ("incident_report_addenda"."note_key_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "incident_report_notifications" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"notified_at" timestamp with time zone NOT NULL,
	"channel" text NOT NULL,
	"notified_by_membership_id" text NOT NULL,
	"recorded_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "incident_report_notifications_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "incident_report_notifications_channel_check" CHECK ("incident_report_notifications"."channel" in ('phone', 'in_person', 'message'))
);
--> statement-breakpoint
CREATE TABLE "incident_report_witnesses" (
	"institution_id" text NOT NULL,
	"report_id" uuid NOT NULL,
	"membership_id" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "incident_report_witnesses_pkey" PRIMARY KEY("institution_id","report_id","membership_id"),
	CONSTRAINT "incident_report_witnesses_position_check" CHECK ("incident_report_witnesses"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "incident_reports" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"injured_kind" text NOT NULL,
	"student_id" text,
	"injured_membership_id" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"location" text NOT NULL,
	"kind" text NOT NULL,
	"description_ciphertext" text NOT NULL,
	"description_key_version" integer NOT NULL,
	"health_ciphertext" text NOT NULL,
	"health_key_version" integer NOT NULL,
	"first_aid_by_membership_id" text,
	"responsible_membership_id" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"finalized_at" timestamp with time zone,
	"finalized_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "incident_reports_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "incident_reports_status_check" CHECK ("incident_reports"."status" in ('draft', 'finalized')),
	CONSTRAINT "incident_reports_kind_check" CHECK ("incident_reports"."kind" in ('fall', 'collision', 'sports', 'play', 'other')),
	CONSTRAINT "incident_reports_injured_check" CHECK ("incident_reports"."injured_kind" in ('student', 'staff')
        and (("incident_reports"."injured_kind" = 'student' and "incident_reports"."student_id" is not null and "incident_reports"."injured_membership_id" is null)
          or ("incident_reports"."injured_kind" = 'staff' and "incident_reports"."student_id" is null and "incident_reports"."injured_membership_id" is not null))),
	CONSTRAINT "incident_reports_location_check" CHECK (char_length("incident_reports"."location") between 2 and 200),
	CONSTRAINT "incident_reports_key_version_check" CHECK ("incident_reports"."description_key_version" > 0 and "incident_reports"."health_key_version" > 0),
	CONSTRAINT "incident_reports_finalized_check" CHECK ((("incident_reports"."status" = 'finalized') = ("incident_reports"."finalized_at" is not null))
        and (("incident_reports"."finalized_at" is null) = ("incident_reports"."finalized_by_user_id" is null)))
);
--> statement-breakpoint
ALTER TABLE "incident_report_addenda" ADD CONSTRAINT "incident_report_addenda_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_report_addenda" ADD CONSTRAINT "incident_report_addenda_report_fkey" FOREIGN KEY ("institution_id","report_id") REFERENCES "public"."incident_reports"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_report_notifications" ADD CONSTRAINT "incident_report_notifications_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_report_notifications" ADD CONSTRAINT "incident_report_notifications_report_fkey" FOREIGN KEY ("institution_id","report_id") REFERENCES "public"."incident_reports"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_report_notifications" ADD CONSTRAINT "incident_report_notifications_notified_by_fkey" FOREIGN KEY ("institution_id","notified_by_membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_report_witnesses" ADD CONSTRAINT "incident_report_witnesses_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_report_witnesses" ADD CONSTRAINT "incident_report_witnesses_report_fkey" FOREIGN KEY ("institution_id","report_id") REFERENCES "public"."incident_reports"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_report_witnesses" ADD CONSTRAINT "incident_report_witnesses_membership_fkey" FOREIGN KEY ("institution_id","membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_injured_membership_fkey" FOREIGN KEY ("institution_id","injured_membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_first_aid_by_fkey" FOREIGN KEY ("institution_id","first_aid_by_membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_responsible_fkey" FOREIGN KEY ("institution_id","responsible_membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "incident_report_addenda_report_idx" ON "incident_report_addenda" USING btree ("institution_id","report_id","created_at");--> statement-breakpoint
CREATE INDEX "incident_report_notifications_report_idx" ON "incident_report_notifications" USING btree ("institution_id","report_id","notified_at");--> statement-breakpoint
CREATE INDEX "incident_report_notifications_notified_by_idx" ON "incident_report_notifications" USING btree ("institution_id","notified_by_membership_id");--> statement-breakpoint
CREATE INDEX "incident_report_witnesses_membership_idx" ON "incident_report_witnesses" USING btree ("institution_id","membership_id");--> statement-breakpoint
CREATE INDEX "incident_reports_occurred_idx" ON "incident_reports" USING btree ("institution_id","occurred_at");--> statement-breakpoint
CREATE INDEX "incident_reports_student_idx" ON "incident_reports" USING btree ("institution_id","student_id","occurred_at") WHERE "incident_reports"."student_id" is not null;--> statement-breakpoint
CREATE INDEX "incident_reports_injured_membership_idx" ON "incident_reports" USING btree ("institution_id","injured_membership_id") WHERE "incident_reports"."injured_membership_id" is not null;--> statement-breakpoint
CREATE INDEX "incident_reports_first_aid_by_idx" ON "incident_reports" USING btree ("institution_id","first_aid_by_membership_id") WHERE "incident_reports"."first_aid_by_membership_id" is not null;--> statement-breakpoint
CREATE INDEX "incident_reports_responsible_idx" ON "incident_reports" USING btree ("institution_id","responsible_membership_id");--> statement-breakpoint
CREATE INDEX "incident_reports_created_by_idx" ON "incident_reports" USING btree ("institution_id","created_by_user_id","occurred_at");--> statement-breakpoint
-- Kesinleşmiş kaza tutanağı değişmez ve silinmez (DOM-FIN-146, K-493); taslak düzeltilir. Tanıklar
-- tutanak kesinleşince eklenmez, değişmez, silinmez. Uygulama aynı kuralı 409 ile verir; bu son
-- güvencedir. Bildirim ve ek not satırları hiç değişmez.
CREATE FUNCTION "kampus_guard_incident_report"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'finalized' THEN
    RAISE EXCEPTION 'kampus: finalized incident report is immutable (%)', TG_OP
      USING ERRCODE = '55000', TABLE = TG_TABLE_NAME;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION "kampus_guard_incident_report_witness"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  report_status text;
  row_report uuid;
  row_institution text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    row_report := OLD.report_id;
    row_institution := OLD.institution_id;
  ELSE
    row_report := NEW.report_id;
    row_institution := NEW.institution_id;
  END IF;
  SELECT r.status INTO report_status FROM "incident_reports" r
    WHERE r.institution_id = row_institution AND r.id = row_report;
  IF report_status = 'finalized' THEN
    RAISE EXCEPTION 'kampus: finalized incident report witnesses are immutable (%)', TG_OP
      USING ERRCODE = '55000', TABLE = TG_TABLE_NAME;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "incident_reports_finalized_trigger" BEFORE UPDATE OR DELETE ON "incident_reports" FOR EACH ROW EXECUTE FUNCTION "kampus_guard_incident_report"();--> statement-breakpoint
CREATE TRIGGER "incident_report_witnesses_finalized_trigger" BEFORE INSERT OR UPDATE OR DELETE ON "incident_report_witnesses" FOR EACH ROW EXECUTE FUNCTION "kampus_guard_incident_report_witness"();--> statement-breakpoint
CREATE TRIGGER "incident_report_notifications_immutable_trigger" BEFORE UPDATE OR DELETE ON "incident_report_notifications" FOR EACH ROW EXECUTE FUNCTION "kampus_reject_immutable_change"();--> statement-breakpoint
CREATE TRIGGER "incident_report_notifications_truncate_trigger" BEFORE TRUNCATE ON "incident_report_notifications" FOR EACH STATEMENT EXECUTE FUNCTION "kampus_reject_immutable_change"();--> statement-breakpoint
CREATE TRIGGER "incident_report_addenda_immutable_trigger" BEFORE UPDATE OR DELETE ON "incident_report_addenda" FOR EACH ROW EXECUTE FUNCTION "kampus_reject_immutable_change"();--> statement-breakpoint
CREATE TRIGGER "incident_report_addenda_truncate_trigger" BEFORE TRUNCATE ON "incident_report_addenda" FOR EACH STATEMENT EXECUTE FUNCTION "kampus_reject_immutable_change"();
--> statement-breakpoint
COMMENT ON TABLE "incident_reports" IS 'Kaza ve yaralanma tutanağı (DOM-FIN-146, ON-162, K-493…K-495): yaralanan öğrenci ya da personel, olay anı, yer, tür, şifreli açıklama ve şifreli sağlık grubu (bölge, şiddet, not, ilk müdahale, sevk), sorumlu ve ilk müdahaleyi yapan personel. Taslak açılır, kesinleşince değişmez ve silinmez (tetikleyici); düzeltme ek nottur. Yönetici ve açan personel okur; sağlık grubu açana yalnız taslakta döner; veli kendi çocuğunun kesinleşmiş tutanağının özetini görür. Sağlık profili kopyalanmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "incident_reports"."institution_id" IS 'Kurum; birincil anahtarın ve her indeksin ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "incident_reports"."created_at" IS 'Satırın yazıldığı an (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "incident_reports"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "incident_reports"."archived_at" IS 'Arşiv anı; bu tabloda kullanılmaz (tutanak silinmez), zorunlu kolon.';
--> statement-breakpoint
COMMENT ON COLUMN "incident_reports"."version" IS 'İyimser kilit sürümü (If-Match).';
--> statement-breakpoint
COMMENT ON COLUMN "incident_reports"."id" IS 'Tutanak kimliği (UUID; uygulamada üretilir, şifreli alanların AAD bağıdır).';
--> statement-breakpoint
COMMENT ON COLUMN "incident_reports"."status" IS 'Durum: draft (taslak, düzeltilir) ya da finalized (kesinleşti, değişmez).';
--> statement-breakpoint
COMMENT ON COLUMN "incident_reports"."injured_kind" IS 'Yaralanan türü: student (öğrenci kaydı) ya da staff (personel üyeliği).';
--> statement-breakpoint
COMMENT ON COLUMN "incident_reports"."student_id" IS 'Yaralanan öğrencinin records kimliği (yabancı anahtar yok); yalnız student türünde dolu.';
--> statement-breakpoint
COMMENT ON COLUMN "incident_reports"."injured_membership_id" IS 'Yaralanan personelin kurum üyeliği (memberships); yalnız staff türünde dolu.';
--> statement-breakpoint
COMMENT ON COLUMN "incident_reports"."occurred_at" IS 'Olay anı (UTC); açılışta gelecekte ve 30 günden eski olamaz.';
--> statement-breakpoint
COMMENT ON COLUMN "incident_reports"."location" IS 'Olay yeri (2–200 karakter).';
--> statement-breakpoint
COMMENT ON COLUMN "incident_reports"."kind" IS 'Olay türü: fall (düşme), collision (çarpma), sports (spor), play (oyun), other (diğer).';
--> statement-breakpoint
COMMENT ON COLUMN "incident_reports"."description_ciphertext" IS 'Olay anlatımı, AES-256-GCM şifreli: base64(IV ‖ etiket ‖ şifreli metin); kurum, tablo, kolon, satır ve yaralanana bağlı. Loga ve denetime yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "incident_reports"."description_key_version" IS 'Açıklamayı şifreleyen alan anahtarının sürümü.';
--> statement-breakpoint
COMMENT ON COLUMN "incident_reports"."health_ciphertext" IS 'Özel nitelikli sağlık grubu (KVKK md. 6), AES-256-GCM şifreli JSON: yaralanma bölgeleri, şiddet (minor/moderate/severe), yaralanma notu, ilk müdahalede yapılan, sevk (none/infirmary/hospital/emergency_112).';
--> statement-breakpoint
COMMENT ON COLUMN "incident_reports"."health_key_version" IS 'Sağlık grubunu şifreleyen alan anahtarının sürümü.';
--> statement-breakpoint
COMMENT ON COLUMN "incident_reports"."first_aid_by_membership_id" IS 'İlk müdahaleyi yapan personelin üyeliği; kurum dışından biriyse boş.';
--> statement-breakpoint
COMMENT ON COLUMN "incident_reports"."responsible_membership_id" IS 'Olaydan sorumlu personelin üyeliği (nöbetçi ya da derse giren).';
--> statement-breakpoint
COMMENT ON COLUMN "incident_reports"."created_by_user_id" IS 'Tutanağı açan kullanıcı; açan personelin erişimi bu kolona bağlıdır (K-494).';
--> statement-breakpoint
COMMENT ON COLUMN "incident_reports"."finalized_at" IS 'Kesinleşme anı; yalnız finalized durumunda dolu.';
--> statement-breakpoint
COMMENT ON COLUMN "incident_reports"."finalized_by_user_id" IS 'Kesinleştiren kullanıcı; kesinleşme anıyla birlikte.';
--> statement-breakpoint
COMMENT ON TABLE "incident_report_witnesses" IS 'Kaza tutanağının tanıkları (DOM-FIN-146, K-493): kurumun etkin personel üyeliği; taslakta bütün olarak yeniden yazılır, tutanak kesinleşince eklenmez, değişmez, silinmez (tetikleyici).';
--> statement-breakpoint
COMMENT ON COLUMN "incident_report_witnesses"."institution_id" IS 'Kurum; birincil anahtarın ve her indeksin ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "incident_report_witnesses"."created_at" IS 'Satırın yazıldığı an (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "incident_report_witnesses"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "incident_report_witnesses"."archived_at" IS 'Arşiv anı; bu tabloda kullanılmaz (tutanak silinmez), zorunlu kolon.';
--> statement-breakpoint
COMMENT ON COLUMN "incident_report_witnesses"."version" IS 'İyimser kilit sürümü (If-Match).';
--> statement-breakpoint
COMMENT ON COLUMN "incident_report_witnesses"."report_id" IS 'Tutanak (incident_reports).';
--> statement-breakpoint
COMMENT ON COLUMN "incident_report_witnesses"."membership_id" IS 'Tanık personelin kurum üyeliği.';
--> statement-breakpoint
COMMENT ON COLUMN "incident_report_witnesses"."position" IS 'Tanığın tutanaktaki sırası (0’dan).';
--> statement-breakpoint
COMMENT ON TABLE "incident_report_notifications" IS 'Veli bildirimi kaydı (DOM-FIN-146, K-493): veliye ne zaman, hangi kanaldan, kimin bildirdiği. Dış gönderim yapılmaz; satır yalnız eklenir (kampus_reject_immutable_change). Ağır yaralanan öğrencinin tutanağı bu kayıt olmadan kesinleşmez.';
--> statement-breakpoint
COMMENT ON COLUMN "incident_report_notifications"."institution_id" IS 'Kurum; birincil anahtarın ve her indeksin ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "incident_report_notifications"."created_at" IS 'Satırın yazıldığı an (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "incident_report_notifications"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "incident_report_notifications"."archived_at" IS 'Arşiv anı; bu tabloda kullanılmaz (tutanak silinmez), zorunlu kolon.';
--> statement-breakpoint
COMMENT ON COLUMN "incident_report_notifications"."version" IS 'İyimser kilit sürümü (If-Match).';
--> statement-breakpoint
COMMENT ON COLUMN "incident_report_notifications"."id" IS 'Bildirim kaydı kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "incident_report_notifications"."report_id" IS 'Tutanak (incident_reports); yalnız öğrenci tutanağı.';
--> statement-breakpoint
COMMENT ON COLUMN "incident_report_notifications"."notified_at" IS 'Veliye bildirildiği an (UTC); olaydan önce ve kayıt anından sonra olamaz.';
--> statement-breakpoint
COMMENT ON COLUMN "incident_report_notifications"."channel" IS 'Kanal: phone (telefon), in_person (yüz yüze), message (mesaj).';
--> statement-breakpoint
COMMENT ON COLUMN "incident_report_notifications"."notified_by_membership_id" IS 'Veliye bildiren personelin üyeliği.';
--> statement-breakpoint
COMMENT ON COLUMN "incident_report_notifications"."recorded_by_user_id" IS 'Kaydı yazan kullanıcı.';
--> statement-breakpoint
COMMENT ON TABLE "incident_report_addenda" IS 'Kesinleşmiş kaza tutanağına ek not (DOM-FIN-146, K-493): düzeltme ya da ek bilgi; eski hâl tutanakta korunur. Not şifrelidir, satır yalnız eklenir (kampus_reject_immutable_change). Yalnız yönetici okur ve yazar.';
--> statement-breakpoint
COMMENT ON COLUMN "incident_report_addenda"."institution_id" IS 'Kurum; birincil anahtarın ve her indeksin ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "incident_report_addenda"."created_at" IS 'Satırın yazıldığı an (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "incident_report_addenda"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "incident_report_addenda"."archived_at" IS 'Arşiv anı; bu tabloda kullanılmaz (tutanak silinmez), zorunlu kolon.';
--> statement-breakpoint
COMMENT ON COLUMN "incident_report_addenda"."version" IS 'İyimser kilit sürümü (If-Match).';
--> statement-breakpoint
COMMENT ON COLUMN "incident_report_addenda"."id" IS 'Ek not kimliği (UUID; şifreli notun AAD bağı).';
--> statement-breakpoint
COMMENT ON COLUMN "incident_report_addenda"."report_id" IS 'Tutanak (incident_reports); yalnız kesinleşmiş tutanak.';
--> statement-breakpoint
COMMENT ON COLUMN "incident_report_addenda"."note_ciphertext" IS 'Ek not, AES-256-GCM şifreli: base64(IV ‖ etiket ‖ şifreli metin); sağlık bilgisi taşıyabilir, loga ve denetime yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "incident_report_addenda"."note_key_version" IS 'Notu şifreleyen alan anahtarının sürümü.';
--> statement-breakpoint
COMMENT ON COLUMN "incident_report_addenda"."created_by_user_id" IS 'Notu yazan kullanıcı (yönetici).';
