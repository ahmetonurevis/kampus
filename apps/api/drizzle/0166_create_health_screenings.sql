CREATE TABLE "health_screening_notifications" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"result_id" uuid NOT NULL,
	"student_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "health_screening_notifications_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "health_screening_notifications_status_check" CHECK ("health_screening_notifications"."status" in ('pending'))
);
--> statement-breakpoint
CREATE TABLE "health_screening_results" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"student_id" text NOT NULL,
	"class_id" text NOT NULL,
	"outcome" text NOT NULL,
	"referral_recommended" boolean NOT NULL,
	"health_ciphertext" text NOT NULL,
	"health_key_version" integer NOT NULL,
	"recorded_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "health_screening_results_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "health_screening_results_outcome_check" CHECK ("health_screening_results"."outcome" in ('screened', 'absent', 'refused')),
	CONSTRAINT "health_screening_results_referral_check" CHECK ("health_screening_results"."outcome" = 'screened' or not "health_screening_results"."referral_recommended"),
	CONSTRAINT "health_screening_results_key_version_check" CHECK ("health_screening_results"."health_key_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "health_screening_sessions" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"screened_on" date NOT NULL,
	"class_ids" text[] NOT NULL,
	"performer_membership_id" text,
	"performer_name" text,
	"thresholds" jsonb NOT NULL,
	"created_by_user_id" text NOT NULL,
	"published_at" timestamp with time zone,
	"published_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "health_screening_sessions_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "health_screening_sessions_kind_check" CHECK ("health_screening_sessions"."kind" in ('growth', 'vision')),
	CONSTRAINT "health_screening_sessions_status_check" CHECK ("health_screening_sessions"."status" in ('open', 'published')),
	CONSTRAINT "health_screening_sessions_classes_check" CHECK (cardinality("health_screening_sessions"."class_ids") between 1 and 40),
	CONSTRAINT "health_screening_sessions_performer_check" CHECK (("health_screening_sessions"."performer_membership_id" is null) <> ("health_screening_sessions"."performer_name" is null)
        and ("health_screening_sessions"."performer_name" is null or char_length("health_screening_sessions"."performer_name") between 2 and 120)),
	CONSTRAINT "health_screening_sessions_published_check" CHECK ((("health_screening_sessions"."status" = 'published') = ("health_screening_sessions"."published_at" is not null))
        and (("health_screening_sessions"."published_at" is null) = ("health_screening_sessions"."published_by_user_id" is null)))
);
--> statement-breakpoint
ALTER TABLE "health_screening_notifications" ADD CONSTRAINT "health_screening_notifications_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_screening_notifications" ADD CONSTRAINT "health_screening_notifications_session_fkey" FOREIGN KEY ("institution_id","session_id") REFERENCES "public"."health_screening_sessions"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_screening_notifications" ADD CONSTRAINT "health_screening_notifications_result_fkey" FOREIGN KEY ("institution_id","result_id") REFERENCES "public"."health_screening_results"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_screening_results" ADD CONSTRAINT "health_screening_results_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_screening_results" ADD CONSTRAINT "health_screening_results_session_fkey" FOREIGN KEY ("institution_id","session_id") REFERENCES "public"."health_screening_sessions"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_screening_sessions" ADD CONSTRAINT "health_screening_sessions_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_screening_sessions" ADD CONSTRAINT "health_screening_sessions_performer_fkey" FOREIGN KEY ("institution_id","performer_membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "health_screening_notifications_result_key" ON "health_screening_notifications" USING btree ("institution_id","result_id");--> statement-breakpoint
CREATE INDEX "health_screening_notifications_session_idx" ON "health_screening_notifications" USING btree ("institution_id","session_id","status");--> statement-breakpoint
CREATE INDEX "health_screening_notifications_student_idx" ON "health_screening_notifications" USING btree ("institution_id","student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "health_screening_results_student_key" ON "health_screening_results" USING btree ("institution_id","session_id","student_id");--> statement-breakpoint
CREATE INDEX "health_screening_results_student_idx" ON "health_screening_results" USING btree ("institution_id","student_id");--> statement-breakpoint
CREATE INDEX "health_screening_results_class_idx" ON "health_screening_results" USING btree ("institution_id","session_id","class_id");--> statement-breakpoint
CREATE INDEX "health_screening_sessions_screened_idx" ON "health_screening_sessions" USING btree ("institution_id","screened_on");--> statement-breakpoint
CREATE INDEX "health_screening_sessions_performer_idx" ON "health_screening_sessions" USING btree ("institution_id","performer_membership_id") WHERE "health_screening_sessions"."performer_membership_id" is not null;
--> statement-breakpoint
-- Yayımlanmış tarama oturumu değişmez ve oturum silinmez (DOM-FIN-153, K-515). Yayımlanmış
-- oturumun sonucu eklenmez, değişmez; sonuç hiç silinmez. Veli bildirim kaydı silinmez. Uygulama
-- aynı kuralları 409 ile verir; bunlar son güvencedir.
CREATE FUNCTION "kampus_guard_health_screening_session"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'kampus: health screening session is not deleted (%)', TG_OP
      USING ERRCODE = '55000', TABLE = TG_TABLE_NAME;
  END IF;
  IF OLD.status = 'published' THEN
    RAISE EXCEPTION 'kampus: published health screening session is immutable (%)', TG_OP
      USING ERRCODE = '55000', TABLE = TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION "kampus_guard_health_screening_result"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'kampus: health screening result is not deleted (%)', TG_OP
      USING ERRCODE = '55000', TABLE = TG_TABLE_NAME;
  END IF;
  IF EXISTS (
    SELECT 1 FROM "health_screening_sessions" s
    WHERE s.institution_id = NEW.institution_id AND s.id = NEW.session_id AND s.status = 'published'
  ) OR (TG_OP = 'UPDATE' AND EXISTS (
    SELECT 1 FROM "health_screening_sessions" s
    WHERE s.institution_id = OLD.institution_id AND s.id = OLD.session_id AND s.status = 'published'
  )) THEN
    RAISE EXCEPTION 'kampus: result of published health screening is immutable (%)', TG_OP
      USING ERRCODE = '55000', TABLE = TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "health_screening_sessions_published_trigger" BEFORE UPDATE OR DELETE ON "health_screening_sessions" FOR EACH ROW EXECUTE FUNCTION "kampus_guard_health_screening_session"();--> statement-breakpoint
CREATE TRIGGER "health_screening_results_published_trigger" BEFORE INSERT OR UPDATE OR DELETE ON "health_screening_results" FOR EACH ROW EXECUTE FUNCTION "kampus_guard_health_screening_result"();--> statement-breakpoint
CREATE TRIGGER "health_screening_notifications_delete_trigger" BEFORE DELETE ON "health_screening_notifications" FOR EACH ROW EXECUTE FUNCTION "kampus_reject_immutable_change"();--> statement-breakpoint
CREATE TRIGGER "health_screening_notifications_truncate_trigger" BEFORE TRUNCATE ON "health_screening_notifications" FOR EACH STATEMENT EXECUTE FUNCTION "kampus_reject_immutable_change"();
--> statement-breakpoint
COMMENT ON TABLE "health_screening_sessions" IS 'Okul sağlığı tarama oturumu (DOM-FIN-153, ON-163, K-514…K-516): tür (boy-kilo, görme), tarama günü, hedef sınıflar, yapan (kurum personeli ya da dış sağlık personelinin adı) ve kurumun eşikleri. Oturum açık başlar; yayımlanınca kendisi ve sonuçları değişmez, oturum silinmez (tetikleyici). Persentil hesabı yapılmaz (H-110). Yönetici ve ön büro yürütür.';
--> statement-breakpoint
COMMENT ON COLUMN "health_screening_sessions"."institution_id" IS 'Kurum; birincil anahtarın ve her indeksin ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "health_screening_sessions"."id" IS 'Oturum kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "health_screening_sessions"."kind" IS 'Tarama türü: growth boy-kilo, vision görme (liste genişletilebilir).';
--> statement-breakpoint
COMMENT ON COLUMN "health_screening_sessions"."status" IS 'Durum: open açık (sonuç girilir), published yayımlandı (veli görür, değişmez).';
--> statement-breakpoint
COMMENT ON COLUMN "health_screening_sessions"."screened_on" IS 'Tarama günü (Europe/Istanbul takvim günü); açılışta 180 gün geriden 90 gün ileriye.';
--> statement-breakpoint
COMMENT ON COLUMN "health_screening_sessions"."class_ids" IS 'Hedef sınıflar (records classes kimlikleri, 1–40; yabancı anahtar yok). Sonuç girilmiş sınıf çıkarılamaz.';
--> statement-breakpoint
COMMENT ON COLUMN "health_screening_sessions"."performer_membership_id" IS 'Taramayı yapan kurum personelinin üyeliği; dış personelde boş. Kişisel veri.';
--> statement-breakpoint
COMMENT ON COLUMN "health_screening_sessions"."performer_name" IS 'Taramayı yapan dış sağlık personelinin adı ve kurumu (2–120); personel üyeliğinde boş. Kişisel veri.';
--> statement-breakpoint
COMMENT ON COLUMN "health_screening_sessions"."thresholds" IS 'Kurumun bu tarama için tanımladığı eşikler (JSON): boy-kiloda bmiBelow/bmiAbove (kg/m²), görmede acuityBelow (ondalık keskinlik); boş eşik yok sayılır. Sonuç girildikten sonra değişmez. Kişisel veri değil.';
--> statement-breakpoint
COMMENT ON COLUMN "health_screening_sessions"."created_by_user_id" IS 'Oturumu açan kullanıcı. Kişisel veri.';
--> statement-breakpoint
COMMENT ON COLUMN "health_screening_sessions"."published_at" IS 'Yayım anı (UTC); yalnız yayımlanmış oturumda.';
--> statement-breakpoint
COMMENT ON COLUMN "health_screening_sessions"."published_by_user_id" IS 'Yayımlayan kullanıcı; yayım anıyla birlikte dolar. Kişisel veri.';
--> statement-breakpoint
COMMENT ON COLUMN "health_screening_sessions"."created_at" IS 'Kaydın oluşturulma anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "health_screening_sessions"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "health_screening_sessions"."archived_at" IS 'Arşiv anı; bu tabloda kullanılmaz (kayıt silinmez ve arşivlenmez), ortak kolon kuralı gereği vardır.';
--> statement-breakpoint
COMMENT ON COLUMN "health_screening_sessions"."version" IS 'İyimser kilit sürümü; her değişiklikte bir artar (If-Match).';
--> statement-breakpoint
COMMENT ON TABLE "health_screening_results" IS 'Tarama sonucu (DOM-FIN-153, K-514): oturumda öğrenci başına tek satır (tekil indeks). Durum ve ileri değerlendirme işareti düz tutulur (sınıf raporu ve bildirim için); ölçüm ve kısa not şifrelidir. Yayımlanmış oturumun sonucu eklenmez ve değişmez, sonuç silinmez (tetikleyici). Veli yalnız yayımlanmış sonucu görür; her ayrıntı okuması denetime düşer.';
--> statement-breakpoint
COMMENT ON COLUMN "health_screening_results"."institution_id" IS 'Kurum; birincil anahtarın ve her indeksin ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "health_screening_results"."id" IS 'Sonuç kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "health_screening_results"."session_id" IS 'Tarama oturumu (health_screening_sessions).';
--> statement-breakpoint
COMMENT ON COLUMN "health_screening_results"."student_id" IS 'Taranan öğrenci kaydı (records students kimliği; yabancı anahtar yok). Kişisel veri.';
--> statement-breakpoint
COMMENT ON COLUMN "health_screening_results"."class_id" IS 'Sonuç girildiği andaki sınıf (records classes kimliği); sınıf raporu buna göre gruplanır.';
--> statement-breakpoint
COMMENT ON COLUMN "health_screening_results"."outcome" IS 'Durum: screened tarandı (ölçümle), absent katılmadı, refused reddetti.';
--> statement-breakpoint
COMMENT ON COLUMN "health_screening_results"."referral_recommended" IS 'İleri değerlendirme önerilir işareti: kurumun eşiği aşılınca kendiliğinden, ya da taramayı yapanın kararıyla. Taranmayanda false. Sağlık verisi niteliğindedir (özel nitelikli); düz tutulması rapor ve bildirim içindir.';
--> statement-breakpoint
COMMENT ON COLUMN "health_screening_results"."health_ciphertext" IS 'Şifreli sağlık grubu: ölçüm (boy mm, kilo 100 g; ya da iki göz yüzdelik keskinlik ve gözlük) ve kısa not (JSON); base64(IV ‖ GCM etiketi ‖ şifreli metin), AES-256-GCM, değer kurum, satır, oturum ve öğrenciye bağlı. Özel nitelikli veri; düz metin yok.';
--> statement-breakpoint
COMMENT ON COLUMN "health_screening_results"."health_key_version" IS 'Şifre anahtarının sürümü (anahtar yenileme için). Kişisel veri değil.';
--> statement-breakpoint
COMMENT ON COLUMN "health_screening_results"."recorded_by_user_id" IS 'Sonucu son yazan kullanıcı. Kişisel veri.';
--> statement-breakpoint
COMMENT ON COLUMN "health_screening_results"."created_at" IS 'Kaydın oluşturulma anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "health_screening_results"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "health_screening_results"."archived_at" IS 'Arşiv anı; bu tabloda kullanılmaz (kayıt silinmez ve arşivlenmez), ortak kolon kuralı gereği vardır.';
--> statement-breakpoint
COMMENT ON COLUMN "health_screening_results"."version" IS 'İyimser kilit sürümü; her değişiklikte bir artar (If-Match).';
--> statement-breakpoint
COMMENT ON TABLE "health_screening_notifications" IS 'Veli bildirim kaydı (DOM-FIN-153, K-515): yayımlamada ileri değerlendirme önerilen her sonuç için bir satır, durum gönderilecek. Gerçek gönderim yoktur; satır silinmez (tetikleyici). Satırın varlığı öneriyi gösterir; erişim taramayı yürüten rollerle sınırlıdır.';
--> statement-breakpoint
COMMENT ON COLUMN "health_screening_notifications"."institution_id" IS 'Kurum; birincil anahtarın ve her indeksin ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "health_screening_notifications"."id" IS 'Bildirim kaydı kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "health_screening_notifications"."session_id" IS 'Tarama oturumu (health_screening_sessions).';
--> statement-breakpoint
COMMENT ON COLUMN "health_screening_notifications"."result_id" IS 'İleri değerlendirme önerilen sonuç (health_screening_results); sonuç başına tek kayıt.';
--> statement-breakpoint
COMMENT ON COLUMN "health_screening_notifications"."student_id" IS 'Bildirimi alacak velinin çocuğu (records students kimliği). Kişisel veri.';
--> statement-breakpoint
COMMENT ON COLUMN "health_screening_notifications"."status" IS 'Durum: pending gönderilecek (gönderim işi yazılınca genişler).';
--> statement-breakpoint
COMMENT ON COLUMN "health_screening_notifications"."created_at" IS 'Kaydın oluşturulma anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "health_screening_notifications"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "health_screening_notifications"."archived_at" IS 'Arşiv anı; bu tabloda kullanılmaz (kayıt silinmez ve arşivlenmez), ortak kolon kuralı gereği vardır.';
--> statement-breakpoint
COMMENT ON COLUMN "health_screening_notifications"."version" IS 'İyimser kilit sürümü; her değişiklikte bir artar (If-Match).';
