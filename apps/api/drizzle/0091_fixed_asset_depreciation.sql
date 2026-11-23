ALTER TABLE "fixed_assets" ADD COLUMN "useful_life_years" integer;--> statement-breakpoint
-- Mevcut demirbaşlara kategorinin önerilen ömrü yazılır (core DEFAULT_USEFUL_LIFE, K-224); yeni kayıtta
-- ömür boşsa servis aynı tabloyu kullanır. Elle eklenmiştir: snapshot yalnız son durumu (not null) izler.
UPDATE "fixed_assets" SET "useful_life_years" = CASE "category"
  WHEN 'it' THEN 4
  WHEN 'kitchen' THEN 10
  ELSE 5
END;--> statement-breakpoint
ALTER TABLE "fixed_assets" ALTER COLUMN "useful_life_years" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD COLUMN "depreciation_method" text DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_useful_life_check" CHECK ("fixed_assets"."useful_life_years" between 1 and 50);--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_depreciation_method_check" CHECK ("fixed_assets"."depreciation_method" in ('normal', 'declining'));--> statement-breakpoint
COMMENT ON TABLE "fixed_assets" IS 'Demirbaş (DOM-FIN-085, ON-235): kurumun kalıcı kullanımdaki tek varlığı. Etiket numarası kurumda tekildir; boş bırakılırsa DB-<yıl>-<sıra> verilir, elle de girilir (K-185). Silinmez; hurdaya ayırma gerekçe ve gün ister, geri alınmaz (K-188). Zimmet (ON-236) ve sayım (ON-237) ayrı kayıtlardır. Amortisman ön hesabı (DOM-FIN-088, ON-238) faydalı ömür ve yöntemden her okumada hesaplanır, saklanmaz; yönetim raporudur, defter kaydı üretmez (IST-142).';--> statement-breakpoint
COMMENT ON COLUMN "fixed_assets"."useful_life_years" IS 'Amortisman ön hesabı için faydalı ömür, tam yıl, 1–50 (DOM-FIN-088). Kayıtta boş bırakılırsa kategorinin önerisi yazılır (bilgisayar 4, mutfak 10, diğerleri 5 yıl; VUK amortisman listesinden, mali müşavir doğrulaması bekler: M-31, K-224). Bu migration öncesindeki kayıtlara aynı öneri yazıldı.';--> statement-breakpoint
COMMENT ON COLUMN "fixed_assets"."depreciation_method" IS 'Amortisman yöntemi: normal doğrusal (VUK md. 315), declining azalan bakiyeler (VUK md. 316; oran normalin iki katı, en çok yüzde 50, son yılda kalan değer ayrılır). Alım yılı tam yıl sayılır, kıst yok (K-225).';
