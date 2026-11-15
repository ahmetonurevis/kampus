CREATE TABLE "maintenance_inspections" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"done_date" date NOT NULL,
	"performed_by" text NOT NULL,
	"result" text NOT NULL,
	"document_number" text,
	"note" text,
	"recorded_by_user_id" text NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"maintenance_request_id" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"cancelled_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "maintenance_inspections_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "maintenance_inspections_result_check" CHECK ("maintenance_inspections"."result" in ('pass', 'fail', 'partial')),
	CONSTRAINT "maintenance_inspections_text_check" CHECK (char_length("maintenance_inspections"."performed_by") between 2 and 120
        and ("maintenance_inspections"."document_number" is null
          or char_length("maintenance_inspections"."document_number") between 1 and 60)
        and ("maintenance_inspections"."note" is null
          or char_length("maintenance_inspections"."note") between 1 and 1000)
        and ("maintenance_inspections"."result" = 'pass' or char_length(coalesce("maintenance_inspections"."note", '')) >= 5)),
	CONSTRAINT "maintenance_inspections_request_check" CHECK ("maintenance_inspections"."maintenance_request_id" is null or "maintenance_inspections"."result" <> 'pass'),
	CONSTRAINT "maintenance_inspections_cancel_check" CHECK ((("maintenance_inspections"."cancelled_at" is null) = ("maintenance_inspections"."cancel_reason" is null))
        and (("maintenance_inspections"."cancelled_at" is null) = ("maintenance_inspections"."cancelled_by_user_id" is null))
        and ("maintenance_inspections"."cancel_reason" is null
          or char_length("maintenance_inspections"."cancel_reason") between 5 and 500))
);
--> statement-breakpoint
CREATE TABLE "maintenance_plans" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"campus_id" text,
	"location" text NOT NULL,
	"asset_id" uuid,
	"period_months" integer NOT NULL,
	"is_legal" boolean NOT NULL,
	"previous_done_date" date,
	"responsible_type" text,
	"responsible_membership_id" text,
	"responsible_supplier_id" uuid,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "maintenance_plans_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "maintenance_plans_type_check" CHECK ("maintenance_plans"."type" in ('elevator', 'fire_extinguisher', 'generator', 'playground', 'boiler', 'electrical', 'other')),
	CONSTRAINT "maintenance_plans_period_check" CHECK ("maintenance_plans"."period_months" between 1 and 60),
	CONSTRAINT "maintenance_plans_text_check" CHECK (char_length("maintenance_plans"."name") between 3 and 120
        and char_length("maintenance_plans"."location") between 2 and 120),
	CONSTRAINT "maintenance_plans_responsible_check" CHECK (("maintenance_plans"."responsible_type" is null and "maintenance_plans"."responsible_membership_id" is null
          and "maintenance_plans"."responsible_supplier_id" is null)
        or ("maintenance_plans"."responsible_type" in ('staff', 'supplier')
          and ("maintenance_plans"."responsible_type" = 'staff') = ("maintenance_plans"."responsible_membership_id" is not null)
          and ("maintenance_plans"."responsible_type" = 'supplier') = ("maintenance_plans"."responsible_supplier_id" is not null)))
);
--> statement-breakpoint
ALTER TABLE "maintenance_inspections" ADD CONSTRAINT "maintenance_inspections_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_inspections" ADD CONSTRAINT "maintenance_inspections_plan_fkey" FOREIGN KEY ("institution_id","plan_id") REFERENCES "public"."maintenance_plans"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_inspections" ADD CONSTRAINT "maintenance_inspections_request_fkey" FOREIGN KEY ("institution_id","maintenance_request_id") REFERENCES "public"."maintenance_requests"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_asset_fkey" FOREIGN KEY ("institution_id","asset_id") REFERENCES "public"."fixed_assets"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_responsible_membership_fkey" FOREIGN KEY ("institution_id","responsible_membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_responsible_supplier_fkey" FOREIGN KEY ("institution_id","responsible_supplier_id") REFERENCES "public"."suppliers"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "maintenance_inspections_plan_day_key" ON "maintenance_inspections" USING btree ("institution_id","plan_id","done_date") WHERE "maintenance_inspections"."cancelled_at" is null;--> statement-breakpoint
CREATE INDEX "maintenance_inspections_plan_idx" ON "maintenance_inspections" USING btree ("institution_id","plan_id","done_date");--> statement-breakpoint
CREATE UNIQUE INDEX "maintenance_inspections_request_key" ON "maintenance_inspections" USING btree ("institution_id","maintenance_request_id");--> statement-breakpoint
CREATE INDEX "maintenance_plans_name_idx" ON "maintenance_plans" USING btree ("institution_id","name");--> statement-breakpoint
CREATE INDEX "maintenance_plans_asset_idx" ON "maintenance_plans" USING btree ("institution_id","asset_id");--> statement-breakpoint
CREATE INDEX "maintenance_plans_responsible_membership_idx" ON "maintenance_plans" USING btree ("institution_id","responsible_membership_id");--> statement-breakpoint
CREATE INDEX "maintenance_plans_responsible_supplier_idx" ON "maintenance_plans" USING btree ("institution_id","responsible_supplier_id");--> statement-breakpoint
COMMENT ON TABLE "maintenance_plans" IS 'Periyodik bakım planı (DOM-FIN-092, ON-240): düzenli denetlenmesi gereken donanım (asansör, yangın söndürücü, jeneratör, oyun alanı, kazan, elektrik tesisatı, diğer). Sonraki denetim günü saklanmaz; son denetimden (previous_done_date ile iptal edilmemiş maintenance_inspections günlerinin en geçi) periyotla hesaplanır, 30 gün kala yaklaşıyor, geçince gecikti sayılır (K-253). Yönetici yazar, ön büro okur (K-255). Plan silinmez, arşivlenir.';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_plans"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_plans"."id" IS 'Plan kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_plans"."name" IS 'Planın adı, 3–120 karakter (ör. A blok asansörü).';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_plans"."type" IS 'Tür: elevator asansör, fire_extinguisher yangın söndürücü, generator jeneratör, playground oyun alanı, boiler kazan ve kalorifer, electrical elektrik tesisatı, other diğer. Önerilen periyot ve yasal işaret türden gelir (MAINTENANCE_PLAN_TYPE_DEFAULTS, K-252; mevzuat varsayımı doğrulanmalı, H-31).';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_plans"."campus_id" IS 'İsteğe bağlı kampüs: records tablosundaki branches kaydının kimliği. Yabancı anahtar yoktur, yazarken sunucuda denetlenir.';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_plans"."location" IS 'Donanımın yeri, serbest metin, 2–120 karakter; denetimden açılan arıza talebinin yeri olur.';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_plans"."asset_id" IS 'İsteğe bağlı demirbaş (fixed_assets); etiketle bağlanır, bağlanırken hurdaya ayrılmamış olmalıdır. Demirbaş silinemez (restrict).';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_plans"."period_months" IS 'Denetim periyodu, ay (1–60); boş girilirse türün önerisi yazılır.';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_plans"."is_legal" IS 'Yasal zorunlu denetim mi; boş girilirse türün önerisi yazılır. Listede ve CSV''de işaret olarak görünür, kuralı değiştirmez.';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_plans"."previous_done_date" IS 'Plan açılırken girilen, sistemden önceki son denetim günü (Europe/Istanbul); bugünden sonra olamaz. Boşsa ve denetim kaydı yoksa plan "denetim kaydı yok" durumundadır.';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_plans"."responsible_type" IS 'Sorumlunun türü: staff personel üyeliği, supplier dış tedarikçi; sorumlusuz planda boş.';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_plans"."responsible_membership_id" IS 'Personel sorumlunun kurum üyeliği (memberships; yazarken etkin yönetici, öğretmen ya da ön büro). Üyelik silinemez (restrict).';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_plans"."responsible_supplier_id" IS 'Tedarikçi sorumlu (suppliers; yazarken etkin). Tedarikçi silinemez (restrict).';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_plans"."created_by_user_id" IS 'Planı açan kullanıcı.';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_plans"."created_at" IS 'Oluşturma zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_plans"."updated_at" IS 'Son değişiklik zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_plans"."archived_at" IS 'Arşiv zamanı; arşivli plan listede ve uyarıda görünmez, denetim kayıtları kalır.';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_plans"."version" IS 'İyimser kilit sürümü (If-Match; düzeltme ve arşivde artar).';--> statement-breakpoint
COMMENT ON TABLE "maintenance_inspections" IS 'Periyodik denetim kaydı (DOM-FIN-092, K-254): gün, yapan, sonuç (uygun, uygunsuz, kısmen uygun), belge no ve not. Kayıt değiştirilmez; yanlış giriş gerekçeyle iptal edilir ve takvime sayılmaz. Uygunsuz ya da kısmen uygun denetimden açılan arıza talebi maintenance_request_id ile bağlanır.';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_inspections"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_inspections"."id" IS 'Denetim kaydı kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_inspections"."plan_id" IS 'Bakım planı (maintenance_plans); plan silinemez (restrict).';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_inspections"."done_date" IS 'Denetim günü (Europe/Istanbul); bugünden sonra olamaz. Bir planda aynı güne iptal edilmemiş tek denetim (maintenance_inspections_plan_day_key).';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_inspections"."performed_by" IS 'Denetimi yapan kişi ya da kuruluş, serbest metin, 2–120 karakter (kişi adı olabilir; kvkk K).';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_inspections"."result" IS 'Sonuç: pass uygun, fail uygunsuz, partial kısmen uygun. Uygunsuz ve kısmen uygun sonuçta not zorunludur.';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_inspections"."document_number" IS 'İsteğe bağlı muayene raporu ya da belge numarası, en çok 60 karakter. Belge dosyası saklanmaz.';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_inspections"."note" IS 'Not, en çok 1000 karakter; uygunsuz ve kısmen uygun sonuçta en az 5 karakter ve arıza talebinin açıklamasına girer.';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_inspections"."recorded_by_user_id" IS 'Denetimi kaydeden kullanıcı (yönetici).';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_inspections"."recorded_at" IS 'Kayıt zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_inspections"."maintenance_request_id" IS 'Bu denetimden açılan arıza talebi (maintenance_requests, DOM-FIN-089); yalnız uygunsuz ya da kısmen uygun denetimde, denetim başına bir talep. Talep silinemez (restrict).';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_inspections"."cancelled_at" IS 'İptal zamanı (UTC); iptal edilen denetim takvime sayılmaz, aynı güne yeni denetim yazılabilir.';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_inspections"."cancel_reason" IS 'İptal gerekçesi, 5–500 karakter; iptalde zorunlu.';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_inspections"."cancelled_by_user_id" IS 'İptal eden kullanıcı.';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_inspections"."created_at" IS 'Oluşturma zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_inspections"."updated_at" IS 'Son değişiklik zamanı (UTC); talep bağlanınca ve iptalde güncellenir.';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_inspections"."archived_at" IS 'Arşiv zamanı; denetim kaydı arşivlenmez, iptal edilir.';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_inspections"."version" IS 'Sürüm; talep bağlanınca ve iptalde artar.';
