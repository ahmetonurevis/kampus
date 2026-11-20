ALTER TABLE "performance_reports" ADD COLUMN "development_goals" jsonb;--> statement-breakpoint
ALTER TABLE "performance_reports" ADD COLUMN "feedback_threshold" integer;--> statement-breakpoint
ALTER TABLE "performance_reports" ADD CONSTRAINT "performance_reports_goals_check" CHECK ("performance_reports"."development_goals" is null or jsonb_typeof("performance_reports"."development_goals") = 'array');--> statement-breakpoint
ALTER TABLE "performance_reports" ADD CONSTRAINT "performance_reports_feedback_threshold_check" CHECK ("performance_reports"."feedback_threshold" is null or "performance_reports"."feedback_threshold" between 3 and 10);--> statement-breakpoint
-- Kesinleşmiş performans raporu değişmez (DOM-FIN-137, K-467, K-468; ON-350): kesinleştirmede
-- yazılan gelişim hedefi özeti ve geri bildirim eşiği de güvenceye girer. Kolonlar 0146'daki
-- işlevle aynı kurala eklenir; uygulama aynı kuralı 409 ile verir, bu son güvencedir.
CREATE OR REPLACE FUNCTION "kampus_guard_performance_report"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.acknowledged_date IS NULL
    AND (NEW.institution_id, NEW.id, NEW.review_id, NEW.manager_opinion, NEW.finalized_at,
      NEW.finalized_by_user_id, NEW.finalized_by_name, NEW.development_goals,
      NEW.feedback_threshold, NEW.created_at, NEW.archived_at)
      IS NOT DISTINCT FROM (OLD.institution_id, OLD.id, OLD.review_id, OLD.manager_opinion,
      OLD.finalized_at, OLD.finalized_by_user_id, OLD.finalized_by_name, OLD.development_goals,
      OLD.feedback_threshold, OLD.created_at, OLD.archived_at) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'kampus: finalized performance report is immutable (%)', TG_OP
    USING ERRCODE = '55000', TABLE = TG_TABLE_NAME;
END;
$$;
--> statement-breakpoint
COMMENT ON TABLE "performance_reports" IS 'Performans raporu kesinleştirme ve "okudum" kaydı (DOM-FIN-137, ON-220, ON-350): yönetici görüşü, kesinleştiren ve personelin okuma kaydı. Rapor içeriği dönem sonu değerlendirmesi, öz değerlendirme, ders gözlemleri ve çok kaynaklı geri bildirimden okunur (K-466); kaynağı sonradan değişebilen gelişim hedefi özeti ve geri bildirim eşiği kesinleştirmede bu satıra yazılır (K-468). Satır dönem kapandıktan sonra kesinleştirmede açılır, sonra değişmez (K-467). Kişisel veri: yönetici ve personelin kendisi okur, her okuma audit_log''a düşer (K-468).';
--> statement-breakpoint
COMMENT ON COLUMN "performance_reports"."development_goals" IS 'Kesinleştirme anındaki gelişim hedefi özeti (K-468): personelin bu döneme bağlı açık, süren ve ulaşılan hedefleri; her öğe kimlik, hedef, başarı ölçütü, kaynak, gözlem günü, takip tarihi ve durum. Hedef sonradan düzenlense, dönem bağı kaldırılsa ya da durumu değişse de rapor bu görüntüden okunur. Boşsa (ON-350 öncesi kesinleşen rapor) hedefler kaynaktan kesinleştirme anındaki durumuyla okunur. Denetim kaydına ve loga yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "performance_reports"."feedback_threshold" IS 'Kesinleştirme anındaki meslektaş anonimlik eşiği (3–10, K-459, K-468): kesinleşen raporun geri bildirim bölümü kurum ayarı sonradan değişse de bu eşikle hesaplanır. Boşsa (ON-350 öncesi kesinleşen rapor) güncel kurum ayarı kullanılır.';
