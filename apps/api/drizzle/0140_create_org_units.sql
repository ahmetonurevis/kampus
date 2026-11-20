CREATE TABLE "org_assignments" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"position_id" uuid NOT NULL,
	"membership_id" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "org_assignments_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "org_assignments_dates_check" CHECK ("org_assignments"."end_date" is null or "org_assignments"."end_date" >= "org_assignments"."start_date")
);
--> statement-breakpoint
CREATE TABLE "org_positions" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"title" text NOT NULL,
	"headcount" integer NOT NULL,
	"reports_to_position_id" uuid,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "org_positions_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "org_positions_title_check" CHECK (char_length("org_positions"."title") between 2 and 120),
	CONSTRAINT "org_positions_headcount_check" CHECK ("org_positions"."headcount" between 1 and 500),
	CONSTRAINT "org_positions_reports_to_check" CHECK ("org_positions"."reports_to_position_id" is null or "org_positions"."reports_to_position_id" <> "org_positions"."id")
);
--> statement-breakpoint
CREATE TABLE "org_units" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"kind" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "org_units_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "org_units_kind_check" CHECK ("org_units"."kind" in ('management', 'academic_department', 'administrative', 'support')),
	CONSTRAINT "org_units_name_check" CHECK (char_length("org_units"."name") between 2 and 120),
	CONSTRAINT "org_units_parent_check" CHECK ("org_units"."parent_id" is null or "org_units"."parent_id" <> "org_units"."id")
);
--> statement-breakpoint
ALTER TABLE "org_assignments" ADD CONSTRAINT "org_assignments_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_assignments" ADD CONSTRAINT "org_assignments_position_fkey" FOREIGN KEY ("institution_id","position_id") REFERENCES "public"."org_positions"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_assignments" ADD CONSTRAINT "org_assignments_membership_fkey" FOREIGN KEY ("institution_id","membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_positions" ADD CONSTRAINT "org_positions_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_positions" ADD CONSTRAINT "org_positions_unit_fkey" FOREIGN KEY ("institution_id","unit_id") REFERENCES "public"."org_units"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_positions" ADD CONSTRAINT "org_positions_reports_to_fkey" FOREIGN KEY ("institution_id","reports_to_position_id") REFERENCES "public"."org_positions"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_units" ADD CONSTRAINT "org_units_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_units" ADD CONSTRAINT "org_units_parent_fkey" FOREIGN KEY ("institution_id","parent_id") REFERENCES "public"."org_units"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "org_assignments_position_idx" ON "org_assignments" USING btree ("institution_id","position_id","start_date");--> statement-breakpoint
CREATE INDEX "org_assignments_membership_idx" ON "org_assignments" USING btree ("institution_id","membership_id");--> statement-breakpoint
CREATE INDEX "org_positions_unit_idx" ON "org_positions" USING btree ("institution_id","unit_id");--> statement-breakpoint
CREATE INDEX "org_positions_reports_to_idx" ON "org_positions" USING btree ("institution_id","reports_to_position_id");--> statement-breakpoint
CREATE INDEX "org_units_parent_idx" ON "org_units" USING btree ("institution_id","parent_id");--> statement-breakpoint
COMMENT ON TABLE "org_units" IS 'Organizasyon birimi (DOM-FIN-129, ON-187, K-442). Üst birimle ağaç kurar; döngü ve derinlik sınırı (10 düzey) kurum kilidi altında school-core assertUnitPlacement ile denetlenir. Aynı üst birimde aynı ad bir kez. Birim silinmez, pasife alınır.';
--> statement-breakpoint
COMMENT ON COLUMN "org_units"."institution_id" IS 'Kurum; birincil anahtarın ve her indeksin ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "org_units"."id" IS 'Birim kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "org_units"."name" IS 'Birim adı (2–120 karakter); aynı üst birimde büyük/küçük harf farkı gözetmeden tekil.';
--> statement-breakpoint
COMMENT ON COLUMN "org_units"."parent_id" IS 'Üst birim (org_units, aynı kurum); boşsa kök birim. Kendisi ya da kendi alt birimi olamaz.';
--> statement-breakpoint
COMMENT ON COLUMN "org_units"."kind" IS 'Tür: management (yönetim), academic_department (akademik zümre), administrative (idari), support (destek).';
--> statement-breakpoint
COMMENT ON COLUMN "org_units"."is_active" IS 'Etkin mi. Pasif birime pozisyon açılmaz, atama yapılmaz; etkin alt birimi ya da süren/başlayacak ataması olan birim pasife alınamaz.';
--> statement-breakpoint
COMMENT ON COLUMN "org_units"."created_by_user_id" IS 'Birimi ekleyen yönetici kullanıcı.';
--> statement-breakpoint
COMMENT ON COLUMN "org_units"."created_at" IS 'Oluşturulma anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "org_units"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "org_units"."archived_at" IS 'Kullanılmaz (birim silinmez, pasife alınır); zorunlu kolon.';
--> statement-breakpoint
COMMENT ON COLUMN "org_units"."version" IS 'İyimser kilit sürümü (If-Match).';
--> statement-breakpoint
COMMENT ON TABLE "org_positions" IS 'Organizasyon pozisyonu (DOM-FIN-129, ON-187, K-443): birimde unvan, kadro sayısı ve raporladığı pozisyon (raporlama hattı; döngü school-core assertReportingLine ile engellenir). Kadro planındaki açık pozisyon (staffing_positions, DOM-FIN-126) işe alım ihtiyacıdır, burada tekrar tanımlanmaz. Kaldırılan pozisyon arşivlenir.';
--> statement-breakpoint
COMMENT ON COLUMN "org_positions"."institution_id" IS 'Kurum; birincil anahtarın ve her indeksin ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "org_positions"."id" IS 'Pozisyon kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "org_positions"."unit_id" IS 'Pozisyonun birimi (org_units, aynı kurum); açılış ve taşımada etkin olmalı.';
--> statement-breakpoint
COMMENT ON COLUMN "org_positions"."title" IS 'Unvan (2–120 karakter); aynı birimde arşivsiz pozisyonlar arasında tekil. Yetki rolü değildir (IST-006).';
--> statement-breakpoint
COMMENT ON COLUMN "org_positions"."headcount" IS 'Kadro sayısı (1–500): aynı gün pozisyonda sürebilecek en çok atama. Bugünden sonraki atama sayısının altına indirilemez.';
--> statement-breakpoint
COMMENT ON COLUMN "org_positions"."reports_to_position_id" IS 'Raporladığı pozisyon (org_positions, aynı kurum, arşivsiz); boşsa en üst. Kendisi ya da kendisine raporlayan pozisyon olamaz.';
--> statement-breakpoint
COMMENT ON COLUMN "org_positions"."created_by_user_id" IS 'Pozisyonu açan yönetici kullanıcı.';
--> statement-breakpoint
COMMENT ON COLUMN "org_positions"."created_at" IS 'Oluşturulma anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "org_positions"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "org_positions"."archived_at" IS 'Kaldırılma anı (UTC); doluysa pozisyon şemada ve listelerde görünmez. Kendisine raporlayan ya da süren/başlayacak ataması olan pozisyon kaldırılamaz.';
--> statement-breakpoint
COMMENT ON COLUMN "org_positions"."version" IS 'İyimser kilit sürümü (If-Match).';
--> statement-breakpoint
COMMENT ON TABLE "org_assignments" IS 'Personelin pozisyona ataması (DOM-FIN-129, ON-187, K-444). Personel kurum üyeliğidir (ayrı personel tablosu yok). Gün aralığı uçlar dahil; aynı personel aynı pozisyona çakışan aralıkla bir kez, aynı gün atama sayısı kadro sayısını aşmaz (kurum kilidi altında school-core assertAssignmentRange).';
--> statement-breakpoint
COMMENT ON COLUMN "org_assignments"."institution_id" IS 'Kurum; birincil anahtarın ve her indeksin ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "org_assignments"."id" IS 'Atama kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "org_assignments"."position_id" IS 'Atanan pozisyon (org_positions, aynı kurum).';
--> statement-breakpoint
COMMENT ON COLUMN "org_assignments"."membership_id" IS 'Atanan personelin kurum üyeliği (memberships, aynı kurum; kişisel veri). Atamada etkin yönetici, öğretmen ya da ön büro.';
--> statement-breakpoint
COMMENT ON COLUMN "org_assignments"."start_date" IS 'Başlangıç günü (dahil, Europe/Istanbul takvimi).';
--> statement-breakpoint
COMMENT ON COLUMN "org_assignments"."end_date" IS 'Bitiş günü (dahil); boşsa süresiz. Başlangıçtan önce olamaz.';
--> statement-breakpoint
COMMENT ON COLUMN "org_assignments"."created_by_user_id" IS 'Atamayı kaydeden yönetici kullanıcı.';
--> statement-breakpoint
COMMENT ON COLUMN "org_assignments"."created_at" IS 'Oluşturulma anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "org_assignments"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "org_assignments"."archived_at" IS 'Yanlış girilen atamanın kaldırılma anı (UTC); doluysa atama kadroya ve geçmişe sayılmaz. Biten atama arşivlenmez, bitiş günü taşır.';
--> statement-breakpoint
COMMENT ON COLUMN "org_assignments"."version" IS 'İyimser kilit sürümü (If-Match).';
