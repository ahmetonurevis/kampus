CREATE TABLE "health_access_reasons" (
	"institution_id" text NOT NULL,
	"audit_log_id" uuid NOT NULL,
	"actor_membership_id" text NOT NULL,
	"student_id" text,
	"reason_code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "health_access_reasons_pkey" PRIMARY KEY("institution_id","audit_log_id"),
	CONSTRAINT "health_access_reasons_reason_code_check" CHECK ("health_access_reasons"."reason_code" in ('emergency', 'first_aid', 'guardian_meeting', 'incident_report', 'official_request', 'other'))
);
--> statement-breakpoint
ALTER TABLE "health_access_reasons" ADD CONSTRAINT "health_access_reasons_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "health_access_reasons_created_idx" ON "health_access_reasons" USING btree ("institution_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "health_access_reasons_actor_idx" ON "health_access_reasons" USING btree ("institution_id","actor_membership_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "health_access_reasons_student_idx" ON "health_access_reasons" USING btree ("institution_id","student_id","created_at" desc) WHERE "health_access_reasons"."student_id" is not null;--> statement-breakpoint
CREATE TRIGGER "health_access_reasons_immutable_trigger" BEFORE UPDATE OR DELETE ON "health_access_reasons" FOR EACH ROW EXECUTE FUNCTION "kampus_reject_immutable_change"();--> statement-breakpoint
CREATE TRIGGER "health_access_reasons_truncate_trigger" BEFORE TRUNCATE ON "health_access_reasons" FOR EACH STATEMENT EXECUTE FUNCTION "kampus_reject_immutable_change"();--> statement-breakpoint
COMMENT ON TABLE "health_access_reasons" IS 'Sağlık verisi okuma gerekçesi (DOM-FIN-156, ON-164, K-523…K-525, DOM-YTK-052): sağlık ayrıntısı dönen her personel okumasının audit_log satırına aynı transaction''da eşlik eder; gerekçe kodu, okuyan üyelik ve kaydın öğrencisi. Kim, ne zaman, hangi eylem ve kayıt audit_log''dadır; "diğer" gerekçenin açıklaması audit_log.reason kolonundadır. audit_log silinmediğinden yabancı anahtar yoktur. Satır yalnız eklenir (kampus_reject_immutable_change); yalnız imha işi siler. Yalnız yönetici okur (sağlık erişim günlüğü); günlük sağlık değeri taşımaz.';--> statement-breakpoint
COMMENT ON COLUMN "health_access_reasons"."institution_id" IS 'Kurum; birincil anahtarın ve her indeksin ilk kolonu.';--> statement-breakpoint
COMMENT ON COLUMN "health_access_reasons"."audit_log_id" IS 'Eşlik edilen audit_log satırının kimliği (eylem, kayıt, okuyan kullanıcı, an ve "diğer" açıklaması orada). Satır başına tek gerekçe.';--> statement-breakpoint
COMMENT ON COLUMN "health_access_reasons"."actor_membership_id" IS 'Sağlık verisini okuyan kurum üyeliği; günlükte kişi süzgeci. Kişisel veri.';--> statement-breakpoint
COMMENT ON COLUMN "health_access_reasons"."student_id" IS 'Okunan kaydın öğrencisi (records students kimliği; yabancı anahtar yok); personel yaralanmasında ve öğrencisiz listede boş. Kişisel veri.';--> statement-breakpoint
COMMENT ON COLUMN "health_access_reasons"."reason_code" IS 'Gerekçe kodu: emergency acil durum, first_aid ilk yardım / revir işlemi, guardian_meeting veli görüşmesi, incident_report tutanak hazırlama, official_request resmî talep, other diğer (açıklama audit_log.reason, 5–200).';--> statement-breakpoint
COMMENT ON COLUMN "health_access_reasons"."created_at" IS 'Okuma anı (UTC); audit_log.created_at ile aynı.';--> statement-breakpoint
COMMENT ON COLUMN "health_access_reasons"."updated_at" IS 'Satır değişmediğinden yazıldığı an.';--> statement-breakpoint
COMMENT ON COLUMN "health_access_reasons"."archived_at" IS 'Kullanılmaz: satır arşivlenmez, saklama süresi dolunca imha işi siler.';--> statement-breakpoint
COMMENT ON COLUMN "health_access_reasons"."version" IS 'Zorunlu kolon; satır değişmediğinden hep 1.';
