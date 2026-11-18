CREATE TABLE "staff_document_type_settings" (
	"institution_id" text NOT NULL,
	"document_type" text NOT NULL,
	"required" boolean NOT NULL,
	"validity_months" integer,
	"sensitive" boolean NOT NULL,
	"updated_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "staff_document_type_settings_pkey" PRIMARY KEY("institution_id","document_type"),
	CONSTRAINT "staff_document_type_settings_type_check" CHECK ("staff_document_type_settings"."document_type" in ('diploma', 'health_report', 'criminal_record', 'certificate', 'id_copy', 'other')),
	CONSTRAINT "staff_document_type_settings_validity_check" CHECK ("staff_document_type_settings"."validity_months" is null or "staff_document_type_settings"."validity_months" between 1 and 120),
	CONSTRAINT "staff_document_type_settings_sensitive_check" CHECK ("staff_document_type_settings"."sensitive" or "staff_document_type_settings"."document_type" not in ('health_report', 'criminal_record'))
);
--> statement-breakpoint
CREATE TABLE "staff_documents" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"membership_id" text NOT NULL,
	"document_type" text NOT NULL,
	"health_report_kind" text,
	"document_date" date NOT NULL,
	"valid_until" date,
	"valid_until_source" text NOT NULL,
	"file_id" uuid,
	"note" text,
	"replaces_id" uuid,
	"superseded_at" timestamp with time zone,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "staff_documents_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "staff_documents_type_check" CHECK ("staff_documents"."document_type" in ('diploma', 'health_report', 'criminal_record', 'certificate', 'id_copy', 'other')),
	CONSTRAINT "staff_documents_health_kind_check" CHECK ((("staff_documents"."document_type" = 'health_report') = ("staff_documents"."health_report_kind" is not null))
        and ("staff_documents"."health_report_kind" is null or "staff_documents"."health_report_kind" in ('pre_employment', 'periodic'))),
	CONSTRAINT "staff_documents_valid_until_check" CHECK ("staff_documents"."valid_until" is null or "staff_documents"."valid_until" >= "staff_documents"."document_date"),
	CONSTRAINT "staff_documents_valid_until_source_check" CHECK ("staff_documents"."valid_until_source" in ('type', 'manual')
        and ("staff_documents"."valid_until_source" = 'type' or "staff_documents"."valid_until" is not null)),
	CONSTRAINT "staff_documents_note_check" CHECK ("staff_documents"."note" is null or char_length("staff_documents"."note") between 1 and 300),
	CONSTRAINT "staff_documents_sensitive_note_check" CHECK ("staff_documents"."note" is null or "staff_documents"."document_type" not in ('health_report', 'criminal_record'))
);
--> statement-breakpoint
ALTER TABLE "staff_document_type_settings" ADD CONSTRAINT "staff_document_type_settings_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_documents" ADD CONSTRAINT "staff_documents_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_documents" ADD CONSTRAINT "staff_documents_membership_fkey" FOREIGN KEY ("institution_id","membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_documents" ADD CONSTRAINT "staff_documents_file_fkey" FOREIGN KEY ("institution_id","file_id") REFERENCES "public"."files"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_documents" ADD CONSTRAINT "staff_documents_replaces_fkey" FOREIGN KEY ("institution_id","replaces_id") REFERENCES "public"."staff_documents"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_documents_current_key" ON "staff_documents" USING btree ("institution_id","membership_id","document_type") WHERE "staff_documents"."superseded_at" is null and "staff_documents"."document_type" not in ('diploma', 'certificate', 'other');--> statement-breakpoint
CREATE UNIQUE INDEX "staff_documents_file_key" ON "staff_documents" USING btree ("institution_id","file_id") WHERE "staff_documents"."file_id" is not null;--> statement-breakpoint
CREATE INDEX "staff_documents_membership_idx" ON "staff_documents" USING btree ("institution_id","membership_id","document_type");--> statement-breakpoint
CREATE INDEX "staff_documents_valid_until_idx" ON "staff_documents" USING btree ("institution_id","valid_until") WHERE "staff_documents"."superseded_at" is null and "staff_documents"."valid_until" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_documents_replaces_key" ON "staff_documents" USING btree ("institution_id","replaces_id") WHERE "staff_documents"."replaces_id" is not null;--> statement-breakpoint
COMMENT ON TABLE "staff_document_type_settings" IS 'Özlük belgesi tür ayarı (DOM-FIN-113, ON-173, K-372): kurum başına belge türünün zorunlu olup olmadığı, geçerlilik süresi (ay) ve özel nitelikli işareti. Satırı olmayan tür platform varsayılanını kullanır (diploma, sağlık raporu 60 ay, adli sicil 6 ay ve kimlik zorunlu; sertifika ve diğer isteğe bağlı). Ayarı yalnız yönetici yazar; değişiklik kayıtlı belgelerin bitişini değiştirmez.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_document_type_settings"."institution_id" IS 'Kurum.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_document_type_settings"."document_type" IS 'Belge türü: diploma, health_report sağlık raporu, criminal_record adli sicil kaydı, certificate sertifika/kurs belgesi, id_copy kimlik fotokopisi, other diğer.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_document_type_settings"."required" IS 'Her etkin personelde bu türün geçerli (yerine geçilmemiş) belgesi bulunmalı mı; yoksa personel "eksik zorunlu belge" uyarısı alır.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_document_type_settings"."validity_months" IS 'Belge tarihinden itibaren geçerlilik süresi (1–120 ay); boşsa süresiz. Yeni belgenin bitişi elle verilmezse buradan hesaplanır.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_document_type_settings"."sensitive" IS 'Özel nitelikli kişisel veri (KVKK md. 6): dosyayı yalnız yönetici açar, listede yalnız tür ve tarih görünür, not yazılmaz. Adli sicil ve sağlık raporunda kaldırılamaz (denetim).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_document_type_settings"."updated_by_user_id" IS 'Ayarı son yazan yönetici.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_document_type_settings"."created_at" IS 'Satırın açıldığı an (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_document_type_settings"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_document_type_settings"."archived_at" IS 'Kullanılmıyor (zorunlu kolon); ayar silinmez, varsayılana dönmek için değerleri yeniden yazılır.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_document_type_settings"."version" IS 'Sürüm; her yazmada artar.';
--> statement-breakpoint
COMMENT ON TABLE "staff_documents" IS 'Personel özlük belgesi (DOM-FIN-113, ON-173, K-372…K-374): personel üyeliğine bağlı diploma, sağlık raporu (işe giriş/periyodik), adli sicil kaydı, sertifika, kimlik fotokopisi ya da diğer belge; belge tarihi, geçerlilik bitişi, isteğe bağlı dosya ve not. Belge silinmez ve düzeltilmez: aynı türün yeni belgesi eskisinin yerine geçer (tekil türlerde kendiliğinden, diploma/sertifika/diğerde seçilince). Adli sicil ve sağlık raporu özel nitelikli kişisel veridir; dosyasını yalnız yönetici açar ve her açılış denetim kaydına yazılır. Saklama süresi ve imha tanımlı değildir (H-76).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_documents"."institution_id" IS 'Kurum.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_documents"."id" IS 'Belge kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_documents"."membership_id" IS 'Belgenin ait olduğu personelin kurum üyeliği (yönetici, öğretmen ya da ön büro); ayrı personel tablosu yoktur. Üyelik silinirse belge korunur: restrict.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_documents"."document_type" IS 'Belge türü (staff_document_type_settings.document_type ile aynı küme).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_documents"."health_report_kind" IS 'Yalnız sağlık raporunda ve orada zorunlu: pre_employment işe giriş, periodic periyodik muayene.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_documents"."document_date" IS 'Belgenin düzenlendiği gün; bugünden sonra olamaz. Yerine geçtiği belgeden önce olamaz.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_documents"."valid_until" IS 'Geçerlilik bitişi (gün, dahil); boşsa süresiz. Takip bugüne göre süresi geçen ve N gün içinde bitecek belgeleri buradan bulur.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_documents"."valid_until_source" IS 'Bitişin kaynağı: type türün geçerlilik süresinden hesaplandı (süresiz türde boş), manual elle girildi (dolu olmalı).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_documents"."file_id" IS 'Platform dosyası (files; amaç document, bağ türü staff_document); isteğe bağlı. Dosya bağlantısı yalnız GET /finance/staff-documents/:id/file-url ile üretilir ve her üretim denetim kaydına yazılır. Bir dosya tek belgeye bağlanır.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_documents"."note" IS 'İsteğe bağlı not (1–300 karakter); özel nitelikli türde (adli sicil, sağlık raporu) yazılmaz. Denetim kaydına yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_documents"."replaces_id" IS 'Bu belgenin yerine geçtiği önceki belge; bir belgenin yerine en çok bir belge geçer.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_documents"."superseded_at" IS 'Yerine yeni belge geçtiği an; doluysa belge geçmiştir, takibe ve eksik denetimine sayılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_documents"."created_by_user_id" IS 'Belgeyi kaydeden yönetici ya da ön büro.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_documents"."created_at" IS 'Kaydın açıldığı an (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_documents"."updated_at" IS 'Son değişiklik anı (UTC; yerine geçilince güncellenir).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_documents"."archived_at" IS 'Kullanılmıyor (zorunlu kolon); belge silinmez ve arşivlenmez, KVKK imhası ayrı iştir.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_documents"."version" IS 'Sürüm; yerine geçilince artar.';
