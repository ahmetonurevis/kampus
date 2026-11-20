CREATE TABLE "performance_reports" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"manager_opinion" text NOT NULL,
	"finalized_at" timestamp with time zone NOT NULL,
	"finalized_by_user_id" text NOT NULL,
	"finalized_by_name" text NOT NULL,
	"acknowledged_date" date,
	"acknowledgement_channel" text,
	"acknowledgement_recorded_at" timestamp with time zone,
	"acknowledgement_recorded_by_user_id" text,
	"acknowledgement_recorded_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "performance_reports_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "performance_reports_opinion_check" CHECK (char_length("performance_reports"."manager_opinion") between 10 and 2000),
	CONSTRAINT "performance_reports_channel_check" CHECK ("performance_reports"."acknowledgement_channel" is null or "performance_reports"."acknowledgement_channel" in ('paper', 'email', 'in_person')),
	CONSTRAINT "performance_reports_ack_check" CHECK ((("performance_reports"."acknowledged_date" is null) = ("performance_reports"."acknowledgement_channel" is null))
        and (("performance_reports"."acknowledged_date" is null) = ("performance_reports"."acknowledgement_recorded_at" is null))
        and (("performance_reports"."acknowledged_date" is null) = ("performance_reports"."acknowledgement_recorded_by_user_id" is null))
        and (("performance_reports"."acknowledged_date" is null) = ("performance_reports"."acknowledgement_recorded_by_name" is null)))
);
--> statement-breakpoint
ALTER TABLE "performance_reports" ADD CONSTRAINT "performance_reports_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_reports" ADD CONSTRAINT "performance_reports_review_fkey" FOREIGN KEY ("institution_id","review_id") REFERENCES "public"."performance_reviews"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "performance_reports_review_key" ON "performance_reports" USING btree ("institution_id","review_id");--> statement-breakpoint
-- Kesinleşmiş performans raporu değişmez (DOM-FIN-137, K-467): görüş ve kesinleştirme bilgisi
-- güncellenmez, satır silinmez; "okudum" kaydı (gün, kanal, giren) yalnız bir kez yazılır. Uygulama
-- aynı kuralı 409 ile verir; bu son güvencedir.
CREATE FUNCTION "kampus_guard_performance_report"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.acknowledged_date IS NULL
    AND (NEW.institution_id, NEW.id, NEW.review_id, NEW.manager_opinion, NEW.finalized_at,
      NEW.finalized_by_user_id, NEW.finalized_by_name, NEW.created_at, NEW.archived_at)
      IS NOT DISTINCT FROM (OLD.institution_id, OLD.id, OLD.review_id, OLD.manager_opinion,
      OLD.finalized_at, OLD.finalized_by_user_id, OLD.finalized_by_name, OLD.created_at,
      OLD.archived_at) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'kampus: finalized performance report is immutable (%)', TG_OP
    USING ERRCODE = '55000', TABLE = TG_TABLE_NAME;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "performance_reports_immutable_trigger" BEFORE UPDATE OR DELETE ON "performance_reports" FOR EACH ROW EXECUTE FUNCTION "kampus_guard_performance_report"();
--> statement-breakpoint
COMMENT ON TABLE "performance_reports" IS 'Performans raporu kesinleştirme ve "okudum" kaydı (DOM-FIN-137, ON-220): yönetici görüşü, kesinleştiren ve personelin okuma kaydı. Rapor içeriği saklanmaz; dönem sonu değerlendirmesi, öz değerlendirme ve ders gözlemlerinden okunur (K-466). Satır dönem kapandıktan sonra kesinleştirmede açılır, sonra değişmez (K-467). Kişisel veri: yönetici ve personelin kendisi okur, her okuma audit_log''a düşer (K-468).';
--> statement-breakpoint
COMMENT ON COLUMN "performance_reports"."institution_id" IS 'Kurum; birincil anahtarın ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "performance_reports"."id" IS 'Rapor kaydı kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "performance_reports"."review_id" IS 'Raporun ait olduğu personel × dönem performans kaydı (performance_reviews, aynı kurum); kayıt başına tek rapor.';
--> statement-breakpoint
COMMENT ON COLUMN "performance_reports"."manager_opinion" IS 'Yöneticinin dönem görüşü (10–2000); kesinleştirmede yazılır, sonra değişmez. Denetim kaydına ve loga yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "performance_reports"."finalized_at" IS 'Kesinleştirme anı (UTC); rapora bu ana kadar tamamlanmış gözlemler girer.';
--> statement-breakpoint
COMMENT ON COLUMN "performance_reports"."finalized_by_user_id" IS 'Raporu kesinleştiren yönetici; raporun sahibi olamaz.';
--> statement-breakpoint
COMMENT ON COLUMN "performance_reports"."finalized_by_name" IS 'Kesinleştiren yöneticinin o anki adı (rapor ve PDF için).';
--> statement-breakpoint
COMMENT ON COLUMN "performance_reports"."acknowledged_date" IS 'Personelin raporu okuduğunu bildirdiği gün; kesinleştirme gününden önce ve kayıt gününden sonra olamaz. Boşsa okuma kaydı yok.';
--> statement-breakpoint
COMMENT ON COLUMN "performance_reports"."acknowledgement_channel" IS '"Okudum" kaydının kanalı (yönetici personel adına girer): paper ıslak imzalı nüsha, email e-posta, in_person yüz yüze görüşme.';
--> statement-breakpoint
COMMENT ON COLUMN "performance_reports"."acknowledgement_recorded_at" IS '"Okudum" kaydının girildiği an (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "performance_reports"."acknowledgement_recorded_by_user_id" IS '"Okudum" kaydını personel adına giren yönetici.';
--> statement-breakpoint
COMMENT ON COLUMN "performance_reports"."acknowledgement_recorded_by_name" IS '"Okudum" kaydını girenin o anki adı.';
--> statement-breakpoint
COMMENT ON COLUMN "performance_reports"."created_at" IS 'Oluşturulma anı (UTC); kesinleştirme anıdır.';
--> statement-breakpoint
COMMENT ON COLUMN "performance_reports"."updated_at" IS 'Son değişiklik anı (UTC); "okudum" kaydında değişir.';
--> statement-breakpoint
COMMENT ON COLUMN "performance_reports"."archived_at" IS 'Kullanılmaz (kesinleşmiş rapor silinmez); zorunlu kolon.';
--> statement-breakpoint
COMMENT ON COLUMN "performance_reports"."version" IS 'Satır sürümü; "okudum" kaydında artar.';
