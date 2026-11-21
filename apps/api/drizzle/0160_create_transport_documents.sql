CREATE TABLE "transport_document_settings" (
	"institution_id" text PRIMARY KEY NOT NULL,
	"warning_days" integer DEFAULT 30 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "transport_document_settings_warning_days_check" CHECK ("transport_document_settings"."warning_days" between 1 and 180)
);
--> statement-breakpoint
CREATE TABLE "transport_documents" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"subject_kind" text NOT NULL,
	"vehicle_id" uuid,
	"membership_id" text,
	"driver_name" text,
	"document_type" text NOT NULL,
	"document_number" text,
	"license_class" text,
	"start_date" date NOT NULL,
	"end_date" date,
	"file_id" uuid,
	"replaces_id" uuid,
	"superseded_at" timestamp with time zone,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "transport_documents_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "transport_documents_subject_check" CHECK ("transport_documents"."subject_kind" in ('vehicle', 'driver', 'staff')
        and (("transport_documents"."subject_kind" in ('vehicle', 'driver')) = ("transport_documents"."vehicle_id" is not null))
        and (("transport_documents"."subject_kind" = 'staff') = ("transport_documents"."membership_id" is not null))
        and (("transport_documents"."subject_kind" = 'driver') = ("transport_documents"."driver_name" is not null))),
	CONSTRAINT "transport_documents_driver_name_check" CHECK ("transport_documents"."driver_name" is null or char_length("transport_documents"."driver_name") between 2 and 120),
	CONSTRAINT "transport_documents_type_check" CHECK ("transport_documents"."document_type" in ('inspection', 'traffic_insurance', 'seat_insurance', 'school_bus_permit', 'driving_license', 'src_certificate', 'psychotechnical', 'criminal_record', 'other')
        and ("transport_documents"."document_type" = 'other'
          or ("transport_documents"."subject_kind" = 'vehicle') = ("transport_documents"."document_type" in ('inspection', 'traffic_insurance', 'seat_insurance', 'school_bus_permit')))
        and ("transport_documents"."document_type" = 'other'
          or ("transport_documents"."subject_kind" <> 'vehicle') = ("transport_documents"."document_type" in ('driving_license', 'src_certificate', 'psychotechnical', 'criminal_record')))),
	CONSTRAINT "transport_documents_license_check" CHECK ((("transport_documents"."document_type" = 'driving_license') = ("transport_documents"."license_class" is not null))
        and ("transport_documents"."license_class" is null or "transport_documents"."license_class" in ('M', 'A1', 'A2', 'A', 'B1', 'B', 'BE', 'C1', 'C1E', 'C', 'CE', 'D1', 'D1E', 'D', 'DE', 'F', 'G'))),
	CONSTRAINT "transport_documents_number_check" CHECK ("transport_documents"."document_number" is null
        or ("transport_documents"."subject_kind" = 'vehicle'
          and char_length("transport_documents"."document_number") between 1 and 50)),
	CONSTRAINT "transport_documents_end_date_check" CHECK (("transport_documents"."end_date" is null or "transport_documents"."end_date" >= "transport_documents"."start_date")
        and ("transport_documents"."end_date" is not null or not "transport_documents"."document_type" in ('inspection', 'traffic_insurance', 'seat_insurance', 'school_bus_permit', 'driving_license', 'psychotechnical')))
);
--> statement-breakpoint
ALTER TABLE "transport_document_settings" ADD CONSTRAINT "transport_document_settings_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_documents" ADD CONSTRAINT "transport_documents_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_documents" ADD CONSTRAINT "transport_documents_vehicle_fkey" FOREIGN KEY ("institution_id","vehicle_id") REFERENCES "public"."transport_vehicles"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_documents" ADD CONSTRAINT "transport_documents_membership_fkey" FOREIGN KEY ("institution_id","membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_documents" ADD CONSTRAINT "transport_documents_file_fkey" FOREIGN KEY ("institution_id","file_id") REFERENCES "public"."files"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_documents" ADD CONSTRAINT "transport_documents_replaces_fkey" FOREIGN KEY ("institution_id","replaces_id") REFERENCES "public"."transport_documents"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "transport_documents_vehicle_current_key" ON "transport_documents" USING btree ("institution_id","vehicle_id","subject_kind","document_type") WHERE "transport_documents"."superseded_at" is null and "transport_documents"."document_type" <> 'other' and "transport_documents"."vehicle_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "transport_documents_membership_current_key" ON "transport_documents" USING btree ("institution_id","membership_id","document_type") WHERE "transport_documents"."superseded_at" is null and "transport_documents"."document_type" <> 'other' and "transport_documents"."membership_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "transport_documents_file_key" ON "transport_documents" USING btree ("institution_id","file_id") WHERE "transport_documents"."file_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "transport_documents_replaces_key" ON "transport_documents" USING btree ("institution_id","replaces_id") WHERE "transport_documents"."replaces_id" is not null;--> statement-breakpoint
CREATE INDEX "transport_documents_vehicle_idx" ON "transport_documents" USING btree ("institution_id","vehicle_id");--> statement-breakpoint
CREATE INDEX "transport_documents_membership_idx" ON "transport_documents" USING btree ("institution_id","membership_id");--> statement-breakpoint
CREATE INDEX "transport_documents_end_date_idx" ON "transport_documents" USING btree ("institution_id","end_date") WHERE "transport_documents"."superseded_at" is null and "transport_documents"."end_date" is not null;--> statement-breakpoint
COMMENT ON TABLE "transport_document_settings" IS 'Servis belgesi uyarı ayarı (DOM-FIN-147, ON-147, K-498): kurum başına bir satır; bitişine kaç gün kalan belgenin "süresi yaklaşıyor" sayılacağı. Satır yoksa varsayılan 30 gün ve ayar sürümü 1. Ayarı yalnız yönetici yazar.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_document_settings"."institution_id" IS 'Kurum (birincil anahtar).';
--> statement-breakpoint
COMMENT ON COLUMN "transport_document_settings"."warning_days" IS 'Uyarı penceresi (1–180 gün, varsayılan 30): bitişine bu kadar gün (dahil) kalan geçerli belge "süresi yaklaşıyor" listesine girer.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_document_settings"."created_at" IS 'Satırın açıldığı an (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "transport_document_settings"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "transport_document_settings"."archived_at" IS 'Kullanılmıyor (zorunlu kolon); ayar silinmez, değeri yeniden yazılır.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_document_settings"."version" IS 'If-Match sürümü; satır ilk yazmada 2 ile açılır (yokken sürüm 1 sayılır), her yazmada artar.';
--> statement-breakpoint
COMMENT ON TABLE "transport_documents" IS 'Servis aracı ve personeli belgesi (DOM-FIN-147, ON-147, K-496…K-498): araç (muayene, zorunlu trafik sigortası, koltuk sigortası, okul servis aracı uygunluk/izin belgesi), aracın kayıtlı sürücüsü ya da kurum üyesi personel (rehber, üye sürücü) belgesi; kişi belgesinde ehliyet, SRC, psikoteknik, adli sicil. Kişi belgesinde içerik ve numara saklanmaz; yalnız tür, tarihler, ehliyet sınıfı ve dosya (KVKK en az veri). Belge silinmez ve düzeltilmez: aynı öznenin aynı türdeki yeni belgesi eskisinin yerine geçer (Diğer hariç). Zorunlu belgesi süresi geçmiş araç uygun değil işaretlenir; atama engellenmez.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_documents"."institution_id" IS 'Kurum.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_documents"."id" IS 'Belge kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "transport_documents"."subject_kind" IS 'Belgenin öznesi: vehicle araç, driver aracın kayıtlı sürücüsü (kurum üyesi değil), staff kurum üyesi personel (rehber ya da üye sürücü).';
--> statement-breakpoint
COMMENT ON COLUMN "transport_documents"."vehicle_id" IS 'Araç ve sürücü belgesinde servis aracı (transport_vehicles); personel belgesinde boş. Araç silinmez, arşivlenir: restrict. Arşivli aracın belgeleri listeye ve uyarılara girmez.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_documents"."membership_id" IS 'Personel belgesinde kurum üyeliği (yönetici, öğretmen ya da ön büro; rehber ya da üye sürücü); diğerlerinde boş. Ayrı personel tablosu yoktur: restrict.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_documents"."driver_name" IS 'Yalnız sürücü belgesinde ve orada zorunlu: kayıt anındaki araç sürücüsünün adı. Araçta sürücü değişince belge önceki sürücüde kalır, uyarı ve uygunluğa sayılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_documents"."document_type" IS 'Tür: araçta inspection muayene, traffic_insurance zorunlu trafik sigortası, seat_insurance koltuk sigortası, school_bus_permit okul servis aracı uygunluk/izin belgesi; kişide driving_license ehliyet, src_certificate mesleki yeterlilik (SRC), psychotechnical psikoteknik raporu, criminal_record adli sicil kaydı; ikisinde other diğer. Adli sicil ve psikoteknik özel nitelikli kişisel veridir: yalnız yönetici kaydeder ve dosyasını açar.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_documents"."document_number" IS 'Yalnız araç belgesinde, isteğe bağlı belge ya da poliçe numarası (1–50). Kişi belgesinde numara tutulmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_documents"."license_class" IS 'Yalnız ehliyette ve orada zorunlu: ehliyet sınıfı (M, A1 … D, DE, F, G).';
--> statement-breakpoint
COMMENT ON COLUMN "transport_documents"."start_date" IS 'Belgenin düzenlendiği ya da başladığı gün (adli sicilde kayıt tarihi); bugünden sonra olamaz, yerine geçtiği belgeden önce olamaz.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_documents"."end_date" IS 'Geçerlilik bitişi (gün, dahil). Muayene, sigortalar, izin belgesi, ehliyet ve psikoteknikte zorunlu; SRC, adli sicil ve diğerde boşsa süresiz. Uyarılar bugüne göre buradan hesaplanır.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_documents"."file_id" IS 'Platform dosyası (files; amaç document PDF ya da question_image görsel, uçta en çok 10 MB; bağ türü transport_document); isteğe bağlı. Bağlantı yalnız GET /finance/transport/documents/:id/file-url ile üretilir ve her üretim denetime yazılır. Bir dosya tek belgeye bağlanır.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_documents"."replaces_id" IS 'Bu belgenin yerine geçtiği önceki belge; bir belgenin yerine en çok bir belge geçer.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_documents"."superseded_at" IS 'Yerine yeni belge geçtiği an; doluysa belge geçmiştir, uyarı ve uygunluğa sayılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_documents"."created_by_user_id" IS 'Belgeyi kaydeden yönetici ya da ön büro.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_documents"."created_at" IS 'Kaydın açıldığı an (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "transport_documents"."updated_at" IS 'Son değişiklik anı (UTC; yerine geçilince güncellenir).';
--> statement-breakpoint
COMMENT ON COLUMN "transport_documents"."archived_at" IS 'Kullanılmıyor (zorunlu kolon); belge silinmez ve arşivlenmez, KVKK imhası ayrı iştir.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_documents"."version" IS 'Sürüm; yerine geçilince artar.';
