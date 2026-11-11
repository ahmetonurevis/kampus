CREATE TABLE "maintenance_request_events" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"event" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"note" text,
	"assignee_type" text,
	"assignee_membership_id" text,
	"assignee_supplier_id" uuid,
	"actor_user_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "maintenance_request_events_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "maintenance_request_events_event_check" CHECK ("maintenance_request_events"."event" in ('reported', 'assigned', 'started', 'resolved', 'closed', 'cancelled')),
	CONSTRAINT "maintenance_request_events_status_check" CHECK ("maintenance_request_events"."to_status" in ('open', 'assigned', 'in_progress', 'resolved', 'closed', 'cancelled')
        and ("maintenance_request_events"."from_status" is null or "maintenance_request_events"."from_status" in ('open', 'assigned', 'in_progress', 'resolved', 'closed', 'cancelled'))
        and (("maintenance_request_events"."event" = 'reported') = ("maintenance_request_events"."from_status" is null))),
	CONSTRAINT "maintenance_request_events_assignee_check" CHECK ((("maintenance_request_events"."event" = 'assigned') = ("maintenance_request_events"."assignee_type" is not null))
        and ("maintenance_request_events"."assignee_type" is null or "maintenance_request_events"."assignee_type" in ('staff', 'supplier'))
        and (("maintenance_request_events"."assignee_type" = 'staff') = ("maintenance_request_events"."assignee_membership_id" is not null))
        and (("maintenance_request_events"."assignee_type" = 'supplier') = ("maintenance_request_events"."assignee_supplier_id" is not null))),
	CONSTRAINT "maintenance_request_events_note_check" CHECK ("maintenance_request_events"."note" is null or char_length("maintenance_request_events"."note") between 1 and 1000)
);--> statement-breakpoint
CREATE TABLE "maintenance_requests" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"campus_id" text,
	"location" text NOT NULL,
	"asset_id" uuid,
	"priority" text NOT NULL,
	"status" text NOT NULL,
	"reported_by_user_id" text NOT NULL,
	"reported_at" timestamp with time zone NOT NULL,
	"assignee_type" text,
	"assignee_membership_id" text,
	"assignee_supplier_id" uuid,
	"assigned_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"resolved_date" date,
	"resolution" text,
	"resolution_cost_cents" bigint,
	"currency" text DEFAULT 'TRY' NOT NULL,
	"resolution_supplier_id" uuid,
	"closed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "maintenance_requests_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "maintenance_requests_sequence_check" CHECK ("maintenance_requests"."sequence" >= 1),
	CONSTRAINT "maintenance_requests_priority_check" CHECK ("maintenance_requests"."priority" in ('low', 'normal', 'urgent')),
	CONSTRAINT "maintenance_requests_status_check" CHECK ("maintenance_requests"."status" in ('open', 'assigned', 'in_progress', 'resolved', 'closed', 'cancelled')),
	CONSTRAINT "maintenance_requests_currency_check" CHECK ("maintenance_requests"."currency" = 'TRY'),
	CONSTRAINT "maintenance_requests_text_check" CHECK (char_length("maintenance_requests"."title") between 3 and 120
        and char_length("maintenance_requests"."description") between 5 and 2000
        and char_length("maintenance_requests"."location") between 2 and 120),
	CONSTRAINT "maintenance_requests_assignee_check" CHECK ((("maintenance_requests"."assignee_type" is null) = ("maintenance_requests"."assigned_at" is null))
        and (("maintenance_requests"."assignee_type" is null and "maintenance_requests"."assignee_membership_id" is null
            and "maintenance_requests"."assignee_supplier_id" is null)
          or ("maintenance_requests"."assignee_type" = 'staff' and "maintenance_requests"."assignee_membership_id" is not null
            and "maintenance_requests"."assignee_supplier_id" is null)
          or ("maintenance_requests"."assignee_type" = 'supplier' and "maintenance_requests"."assignee_supplier_id" is not null
            and "maintenance_requests"."assignee_membership_id" is null))
        and ("maintenance_requests"."status" in ('open', 'cancelled') or "maintenance_requests"."assignee_type" is not null)
        and ("maintenance_requests"."status" <> 'open' or "maintenance_requests"."assignee_type" is null)),
	CONSTRAINT "maintenance_requests_resolution_check" CHECK ((("maintenance_requests"."resolved_at" is null) = ("maintenance_requests"."resolved_date" is null))
        and (("maintenance_requests"."resolved_at" is null) = ("maintenance_requests"."resolution" is null))
        and (("maintenance_requests"."status" in ('resolved', 'closed')) = ("maintenance_requests"."resolved_at" is not null))
        and ("maintenance_requests"."resolution" is null
          or char_length("maintenance_requests"."resolution") between 5 and 1000)
        and ("maintenance_requests"."resolution_cost_cents" is null or ("maintenance_requests"."resolved_at" is not null
          and "maintenance_requests"."resolution_cost_cents" between 1 and 1000000000))
        and ("maintenance_requests"."resolution_supplier_id" is null or "maintenance_requests"."resolved_at" is not null)),
	CONSTRAINT "maintenance_requests_close_check" CHECK ((("maintenance_requests"."status" = 'closed') = ("maintenance_requests"."closed_at" is not null))
        and (("maintenance_requests"."status" = 'cancelled') = ("maintenance_requests"."cancelled_at" is not null))
        and (("maintenance_requests"."cancelled_at" is null) = ("maintenance_requests"."cancel_reason" is null))
        and ("maintenance_requests"."cancel_reason" is null
          or char_length("maintenance_requests"."cancel_reason") between 5 and 500)
        and ("maintenance_requests"."started_at" is null or "maintenance_requests"."status" <> 'open'))
);--> statement-breakpoint
ALTER TABLE "maintenance_request_events" ADD CONSTRAINT "maintenance_request_events_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_request_events" ADD CONSTRAINT "maintenance_request_events_request_fkey" FOREIGN KEY ("institution_id","request_id") REFERENCES "public"."maintenance_requests"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_request_events" ADD CONSTRAINT "maintenance_request_events_assignee_membership_fkey" FOREIGN KEY ("institution_id","assignee_membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_request_events" ADD CONSTRAINT "maintenance_request_events_assignee_supplier_fkey" FOREIGN KEY ("institution_id","assignee_supplier_id") REFERENCES "public"."suppliers"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_asset_fkey" FOREIGN KEY ("institution_id","asset_id") REFERENCES "public"."fixed_assets"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_assignee_membership_fkey" FOREIGN KEY ("institution_id","assignee_membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_assignee_supplier_fkey" FOREIGN KEY ("institution_id","assignee_supplier_id") REFERENCES "public"."suppliers"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_resolution_supplier_fkey" FOREIGN KEY ("institution_id","resolution_supplier_id") REFERENCES "public"."suppliers"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "maintenance_request_events_request_idx" ON "maintenance_request_events" USING btree ("institution_id","request_id","occurred_at");--> statement-breakpoint
CREATE INDEX "maintenance_request_events_assignee_membership_idx" ON "maintenance_request_events" USING btree ("institution_id","assignee_membership_id");--> statement-breakpoint
CREATE INDEX "maintenance_request_events_assignee_supplier_idx" ON "maintenance_request_events" USING btree ("institution_id","assignee_supplier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "maintenance_requests_sequence_key" ON "maintenance_requests" USING btree ("institution_id","sequence");--> statement-breakpoint
CREATE INDEX "maintenance_requests_status_idx" ON "maintenance_requests" USING btree ("institution_id","status","reported_at");--> statement-breakpoint
CREATE INDEX "maintenance_requests_asset_idx" ON "maintenance_requests" USING btree ("institution_id","asset_id");--> statement-breakpoint
CREATE INDEX "maintenance_requests_reported_by_idx" ON "maintenance_requests" USING btree ("institution_id","reported_by_user_id");--> statement-breakpoint
CREATE INDEX "maintenance_requests_assignee_membership_idx" ON "maintenance_requests" USING btree ("institution_id","assignee_membership_id");--> statement-breakpoint
CREATE INDEX "maintenance_requests_assignee_supplier_idx" ON "maintenance_requests" USING btree ("institution_id","assignee_supplier_id");--> statement-breakpoint
CREATE INDEX "maintenance_requests_resolution_supplier_idx" ON "maintenance_requests" USING btree ("institution_id","resolution_supplier_id");--> statement-breakpoint
COMMENT ON TABLE "maintenance_requests" IS 'Arıza ve bakım talebi, iş emri (DOM-FIN-089, ON-239): kurum üyesinin (yönetici, ön büro, öğretmen) bildirdiği arıza. Yönetici personele ya da tedarikçiye atar, işe başlatır, çözer ve kapatır; açık talep gerekçeyle iptal edilir (K-237). Talep silinmez; her geçiş maintenance_request_events tablosuna yazılır. Öğretmen yalnız kendi bildirimini, maliyeti yalnız yönetici görür (K-238).';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_requests"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_requests"."id" IS 'Talep kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_requests"."sequence" IS 'Kurum içi talep sırası; numara AT-<sıra> biçiminde bundan türetilir, saklanmaz. Kurum kilidi altında en büyük sıranın bir fazlası verilir.';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_requests"."title" IS 'Arızanın kısa adı, 3–120 karakter (ör. Projektör açılmıyor).';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_requests"."description" IS 'Arızanın açıklaması, 5–2000 karakter.';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_requests"."campus_id" IS 'İsteğe bağlı kampüs: records tablosundaki branches kaydının kimliği. Yabancı anahtar yoktur, bildirim anında sunucuda denetlenir.';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_requests"."location" IS 'Arızanın yeri (oda ya da yer), serbest metin, 2–120 karakter; demirbaş seçilince form onun konumunu önerir.';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_requests"."asset_id" IS 'İsteğe bağlı demirbaş (fixed_assets); bildirimde etiketle bulunur, kurumun hurdaya ayrılmamış demirbaşı olmalıdır (K-236). Demirbaş silinemez (restrict).';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_requests"."priority" IS 'Öncelik: low düşük, normal, urgent acil. Liste acil talepleri önce gösterir.';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_requests"."status" IS 'Durum: open açık, assigned atandı, in_progress çalışılıyor, resolved çözüldü, closed kapatıldı, cancelled iptal edildi. Geçişler school-core maintenanceTransition kuralıyla yapılır (K-237).';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_requests"."reported_by_user_id" IS 'Bildiren kullanıcı; öğretmenin görme kapsamı ve bildirenin kendi açık talebini iptal etmesi buna bakar (K-238).';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_requests"."reported_at" IS 'Bildirim zamanı (UTC); çözüm günü bunun Europe/Istanbul gününden önce olamaz.';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_requests"."assignee_type" IS 'Şimdiki sorumlunun türü: staff personel üyeliği, supplier dış tedarikçi; atanmamış talepte boş.';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_requests"."assignee_membership_id" IS 'Personel sorumlunun kurum üyeliği (memberships; atama anında etkin yönetici, öğretmen ya da ön büro). Üyelik silinemez (restrict).';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_requests"."assignee_supplier_id" IS 'Tedarikçi sorumlu (suppliers; atama anında etkin). Tedarikçi silinemez (restrict).';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_requests"."assigned_at" IS 'Son atamanın zamanı (UTC); yeniden atamada güncellenir, önceki atamalar geçmiş satırlarındadır.';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_requests"."started_at" IS 'İşe başlanma zamanı (UTC); atanmış talep in_progress olunca dolar.';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_requests"."resolved_at" IS 'Çözüm işleminin zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_requests"."resolved_date" IS 'Çözüm günü, Europe/Istanbul; bildirim gününden önce, işlem gününden sonra olamaz.';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_requests"."resolution" IS 'Yapılan işin açıklaması, 5–1000 karakter; çözümde zorunlu.';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_requests"."resolution_cost_cents" IS 'İsteğe bağlı onarım maliyeti, KDV dahil, kuruş (1 kuruş – 10 milyon TL). Yalnız yöneticiye döner (K-238); muhasebeye aktarılmaz.';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_requests"."currency" IS 'Para birimi; yalnız TRY.';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_requests"."resolution_supplier_id" IS 'İsteğe bağlı, işi yapan tedarikçi (suppliers; pasif tedarikçi de olabilir). Tedarikçi silinemez (restrict).';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_requests"."closed_at" IS 'Kapatma zamanı (UTC); yalnız çözülmüş talep kapatılır, kapatılan talep yeniden açılmaz.';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_requests"."cancelled_at" IS 'İptal zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_requests"."cancel_reason" IS 'İptal gerekçesi, 5–500 karakter; iptalde zorunlu.';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_requests"."created_at" IS 'Oluşturma zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_requests"."updated_at" IS 'Son değişiklik zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_requests"."archived_at" IS 'Arşiv zamanı; talep arşivlenmez, iptal edilir.';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_requests"."version" IS 'İyimser kilit sürümü (If-Match; her geçişte artar).';--> statement-breakpoint
COMMENT ON TABLE "maintenance_request_events" IS 'İş emri geçmişi (DOM-FIN-089, K-237): arıza talebinin her durum değişikliği bir satırdır (kim, ne zaman, hangi durumdan hangisine, not). Satır yalnız eklenir; depo güncelleme ve silme sunmaz.';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_request_events"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_request_events"."id" IS 'Geçmiş satırı kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_request_events"."request_id" IS 'Arıza talebi (maintenance_requests); talep silinemez (restrict).';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_request_events"."event" IS 'Olay: reported bildirildi, assigned atandı, started işe başlandı, resolved çözüldü, closed kapatıldı, cancelled iptal edildi.';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_request_events"."from_status" IS 'Önceki durum; bildirim satırında boş.';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_request_events"."to_status" IS 'Yeni durum.';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_request_events"."note" IS 'Adımın notu: atama, başlatma ve kapatmada isteğe bağlı not, çözümde yapılan iş, iptalde gerekçe; en çok 1000 karakter. Maliyet yazılmaz.';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_request_events"."assignee_type" IS 'Atama satırında o anki sorumlunun türü (staff ya da supplier); başka olaylarda boş.';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_request_events"."assignee_membership_id" IS 'Atama satırında personel sorumlunun üyeliği (memberships, restrict).';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_request_events"."assignee_supplier_id" IS 'Atama satırında tedarikçi sorumlu (suppliers, restrict).';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_request_events"."actor_user_id" IS 'Adımı yapan kullanıcı.';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_request_events"."occurred_at" IS 'Adımın zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_request_events"."created_at" IS 'Oluşturma zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_request_events"."updated_at" IS 'Son değişiklik zamanı (UTC); satır değişmez, oluşturma zamanına eşittir.';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_request_events"."archived_at" IS 'Arşiv zamanı; geçmiş satırı arşivlenmez.';--> statement-breakpoint
COMMENT ON COLUMN "maintenance_request_events"."version" IS 'Sürüm; satır değişmediği için 1 kalır.';