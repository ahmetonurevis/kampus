CREATE TABLE "trip_plan_events" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"event" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"note" text,
	"actor_user_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "trip_plan_events_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "trip_plan_events_event_check" CHECK ("trip_plan_events"."event" in ('created', 'submitted', 'approved', 'rejected', 'reopened', 'authority_notified', 'completed', 'cancelled')),
	CONSTRAINT "trip_plan_events_status_check" CHECK ("trip_plan_events"."to_status" in ('draft', 'submitted', 'approved', 'rejected', 'completed', 'cancelled')
        and ("trip_plan_events"."from_status" is null or "trip_plan_events"."from_status" in ('draft', 'submitted', 'approved', 'rejected', 'completed', 'cancelled'))
        and (("trip_plan_events"."event" = 'created') = ("trip_plan_events"."from_status" is null))),
	CONSTRAINT "trip_plan_events_note_check" CHECK ("trip_plan_events"."note" is null or char_length("trip_plan_events"."note") between 1 and 500)
);
--> statement-breakpoint
CREATE TABLE "trip_plan_staff" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"membership_id" text NOT NULL,
	"role" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "trip_plan_staff_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "trip_plan_staff_role_check" CHECK ("trip_plan_staff"."role" in ('lead', 'assistant')),
	CONSTRAINT "trip_plan_staff_position_check" CHECK ("trip_plan_staff"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "trip_plans" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"name" text NOT NULL,
	"purpose" text NOT NULL,
	"departure_at" timestamp with time zone NOT NULL,
	"return_at" timestamp with time zone NOT NULL,
	"expected_student_count" integer NOT NULL,
	"stops" jsonb NOT NULL,
	"transport_type" text NOT NULL,
	"transport_company" text,
	"transport_plate" text,
	"driver_name" text,
	"driver_phone" text,
	"transport_file_id" uuid,
	"risks" jsonb NOT NULL,
	"emergency_contacts" jsonb NOT NULL,
	"paid_activity_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"submitted_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"approved_by_user_id" text,
	"rejected_at" timestamp with time zone,
	"rejection_reason" text,
	"authority_notified_on" date,
	"authority_reference" text,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "trip_plans_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "trip_plans_sequence_check" CHECK ("trip_plans"."sequence" >= 1),
	CONSTRAINT "trip_plans_status_check" CHECK ("trip_plans"."status" in ('draft', 'submitted', 'approved', 'rejected', 'completed', 'cancelled')),
	CONSTRAINT "trip_plans_transport_type_check" CHECK ("trip_plans"."transport_type" in ('bus', 'minibus', 'train', 'plane', 'ship', 'walking', 'other')),
	CONSTRAINT "trip_plans_text_check" CHECK (char_length("trip_plans"."name") between 3 and 120
        and char_length("trip_plans"."purpose") between 10 and 2000
        and ("trip_plans"."transport_company" is null or char_length("trip_plans"."transport_company") between 2 and 120)
        and ("trip_plans"."transport_plate" is null or "trip_plans"."transport_plate" ~ '^[0-9]{2}[A-Z]{1,3}[0-9]{2,5}$')
        and ("trip_plans"."driver_name" is null or char_length("trip_plans"."driver_name") between 2 and 120)
        and ("trip_plans"."driver_phone" is null or "trip_plans"."driver_phone" ~ '^0[0-9]{10}$')
        and ("trip_plans"."authority_reference" is null or char_length("trip_plans"."authority_reference") between 1 and 60)),
	CONSTRAINT "trip_plans_terms_check" CHECK ("trip_plans"."return_at" > "trip_plans"."departure_at"
        and "trip_plans"."expected_student_count" between 1 and 2000
        and jsonb_typeof("trip_plans"."stops") = 'array'
        and jsonb_array_length("trip_plans"."stops") between 1 and 30
        and jsonb_typeof("trip_plans"."risks") = 'array'
        and jsonb_array_length("trip_plans"."risks") <= 30
        and jsonb_typeof("trip_plans"."emergency_contacts") = 'array'
        and jsonb_array_length("trip_plans"."emergency_contacts") <= 5),
	CONSTRAINT "trip_plans_status_fields_check" CHECK (("trip_plans"."status" not in ('approved', 'completed') or "trip_plans"."approved_at" is not null)
        and ("trip_plans"."approved_at" is null or "trip_plans"."status" in ('approved', 'completed', 'cancelled'))
        and (("trip_plans"."approved_at" is null) = ("trip_plans"."approved_by_user_id" is null))
        and ("trip_plans"."status" <> 'rejected' or "trip_plans"."rejected_at" is not null)
        and ("trip_plans"."rejected_at" is null or "trip_plans"."status" in ('rejected', 'cancelled'))
        and (("trip_plans"."rejected_at" is null) = ("trip_plans"."rejection_reason" is null))
        and ("trip_plans"."rejection_reason" is null
          or char_length("trip_plans"."rejection_reason") between 5 and 500)
        and ("trip_plans"."status" = 'draft' or "trip_plans"."status" = 'cancelled' or "trip_plans"."submitted_at" is not null)
        and ("trip_plans"."authority_notified_on" is null or "trip_plans"."approved_at" is not null)
        and ("trip_plans"."authority_reference" is null or "trip_plans"."authority_notified_on" is not null)
        and (("trip_plans"."status" = 'completed') = ("trip_plans"."completed_at" is not null))
        and (("trip_plans"."status" = 'cancelled') = ("trip_plans"."cancelled_at" is not null))
        and (("trip_plans"."cancelled_at" is null) = ("trip_plans"."cancel_reason" is null))
        and ("trip_plans"."cancel_reason" is null
          or char_length("trip_plans"."cancel_reason") between 5 and 500))
);
--> statement-breakpoint
ALTER TABLE "trip_plan_events" ADD CONSTRAINT "trip_plan_events_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_plan_events" ADD CONSTRAINT "trip_plan_events_plan_fkey" FOREIGN KEY ("institution_id","plan_id") REFERENCES "public"."trip_plans"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_plan_staff" ADD CONSTRAINT "trip_plan_staff_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_plan_staff" ADD CONSTRAINT "trip_plan_staff_plan_fkey" FOREIGN KEY ("institution_id","plan_id") REFERENCES "public"."trip_plans"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_plan_staff" ADD CONSTRAINT "trip_plan_staff_membership_fkey" FOREIGN KEY ("institution_id","membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_plans" ADD CONSTRAINT "trip_plans_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_plans" ADD CONSTRAINT "trip_plans_transport_file_fkey" FOREIGN KEY ("institution_id","transport_file_id") REFERENCES "public"."files"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_plans" ADD CONSTRAINT "trip_plans_paid_activity_fkey" FOREIGN KEY ("institution_id","paid_activity_id") REFERENCES "public"."paid_activities"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trip_plan_events_plan_idx" ON "trip_plan_events" USING btree ("institution_id","plan_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_plan_staff_member_key" ON "trip_plan_staff" USING btree ("institution_id","plan_id","membership_id") WHERE "trip_plan_staff"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "trip_plan_staff_plan_idx" ON "trip_plan_staff" USING btree ("institution_id","plan_id","position");--> statement-breakpoint
CREATE INDEX "trip_plan_staff_membership_idx" ON "trip_plan_staff" USING btree ("institution_id","membership_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_plans_sequence_key" ON "trip_plans" USING btree ("institution_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_plans_paid_activity_key" ON "trip_plans" USING btree ("institution_id","paid_activity_id") WHERE "trip_plans"."paid_activity_id" is not null and "trip_plans"."archived_at" is null and "trip_plans"."status" <> 'cancelled';--> statement-breakpoint
CREATE INDEX "trip_plans_status_idx" ON "trip_plans" USING btree ("institution_id","status","departure_at");--> statement-breakpoint
CREATE INDEX "trip_plans_departure_idx" ON "trip_plans" USING btree ("institution_id","departure_at");--> statement-breakpoint
CREATE INDEX "trip_plans_transport_file_idx" ON "trip_plans" USING btree ("institution_id","transport_file_id");--> statement-breakpoint
CREATE INDEX "trip_plans_paid_activity_idx" ON "trip_plans" USING btree ("institution_id","paid_activity_id");--> statement-breakpoint
COMMENT ON TABLE "trip_plans" IS 'Gezi planı ve onay dosyası (DOM-FIN-111, K-366…K-368): ad, amaç ve kazanım, çıkış ve dönüş anı, güzergâh, beklenen öğrenci sayısı, ulaşım, risk değerlendirmesi ve acil iletişim. Taslağı ön büro ya da yönetici yazar ve onaya gönderir; onay ve ret yalnız yöneticidedir. Onaya gönderilmiş, onaylanmış ya da reddedilmiş plan düzeltilince taslağa döner ve yeniden onay ister. Plan silinmez, iptal edilir. Mevzuat karşılığı doğrulanmalıdır (H-72, H-73).';--> statement-breakpoint
COMMENT ON TABLE "trip_plan_staff" IS 'Gezinin görevli öğretmenleri (DOM-FIN-111, K-366): kurumun etkin öğretmen ya da yönetici üyeliği; en az biri sorumlu öğretmendir. Düzeltmede liste bütün olarak değişir; eski satırlar arşivlenir, silinmez.';--> statement-breakpoint
COMMENT ON TABLE "trip_plan_events" IS 'Gezi planı geçmişi (DOM-FIN-111, K-367): taslak, onaya gönderme, onay, ret, yeniden açma, millî eğitim bildirimi işareti, tamamlama ve iptal; kim, ne zaman, not. Satır yalnız eklenir.';--> statement-breakpoint
COMMENT ON COLUMN "trip_plans"."institution_id" IS 'Kurum (institutions.id); birincil anahtarın ilk kolonu.';--> statement-breakpoint
COMMENT ON COLUMN "trip_plans"."id" IS 'Plan kimliği (UUID).';--> statement-breakpoint
COMMENT ON COLUMN "trip_plans"."sequence" IS 'Kurum içi sıra; plan numarası GZ-<sıra> olarak gösterilir, kurumda tekildir.';--> statement-breakpoint
COMMENT ON COLUMN "trip_plans"."name" IS 'Gezinin adı (3–120 karakter).';--> statement-breakpoint
COMMENT ON COLUMN "trip_plans"."purpose" IS 'Gezinin amacı ve kazanımı (10–2000 karakter).';--> statement-breakpoint
COMMENT ON COLUMN "trip_plans"."departure_at" IS 'Çıkış anı (UTC); kurulurken ve onaya gönderirken gelecekte olmalıdır, gösterim Europe/Istanbul.';--> statement-breakpoint
COMMENT ON COLUMN "trip_plans"."return_at" IS 'Dönüş anı (UTC); çıkıştan sonra ve en çok 30 gün sonra. Plan bu andan sonra tamamlanır.';--> statement-breakpoint
COMMENT ON COLUMN "trip_plans"."expected_student_count" IS 'Beklenen öğrenci sayısı (1–2000); görevli oranı uyarısı (her 15 öğrenciye bir görevli, K-366) buradan hesaplanır, saklanmaz.';--> statement-breakpoint
COMMENT ON COLUMN "trip_plans"."stops" IS 'Güzergâh: sıralı durak listesi (jsonb dizi, 1–30; yer ve isteğe bağlı not).';--> statement-breakpoint
COMMENT ON COLUMN "trip_plans"."transport_type" IS 'Ulaşım türü: bus, minibus, train, plane, ship, walking, other. Otobüs ve minibüste onaya gönderirken firma, plaka ve sürücü zorunludur.';--> statement-breakpoint
COMMENT ON COLUMN "trip_plans"."transport_company" IS 'Taşıma firması (serbest metin, isteğe bağlı).';--> statement-breakpoint
COMMENT ON COLUMN "trip_plans"."transport_plate" IS 'Araç plakası; boşluksuz büyük harfle saklanır (34ABC123).';--> statement-breakpoint
COMMENT ON COLUMN "trip_plans"."driver_name" IS 'Sürücünün adı soyadı; kişisel veri (K), listede gösterilmez.';--> statement-breakpoint
COMMENT ON COLUMN "trip_plans"."driver_phone" IS 'Sürücü telefonu (0XXXXXXXXXX); kişisel veri (K), listede gösterilmez.';--> statement-breakpoint
COMMENT ON COLUMN "trip_plans"."transport_file_id" IS 'Ulaşım belgesi dosyası (files; amaç document, bağ türü trip_plan_transport); isteğe bağlı.';--> statement-breakpoint
COMMENT ON COLUMN "trip_plans"."risks" IS 'Risk değerlendirmesi: risk ve önlem maddeleri (jsonb dizi, en çok 30); onaya gönderirken en az bir madde.';--> statement-breakpoint
COMMENT ON COLUMN "trip_plans"."emergency_contacts" IS 'Acil iletişim kişileri (jsonb dizi, en çok 5; ad, telefon, görevi); kişisel veri (K), listede gösterilmez. Onaya gönderirken en az bir kişi.';--> statement-breakpoint
COMMENT ON COLUMN "trip_plans"."paid_activity_id" IS 'İsteğe bağlı ücretli etkinlik (paid_activities, DOM-FIN-098); bir etkinlik iptal edilmemiş tek plana bağlanır, günü gezinin çıkış–dönüş günleri arasındadır.';--> statement-breakpoint
COMMENT ON COLUMN "trip_plans"."status" IS 'Durum: draft, submitted, approved, rejected, completed, cancelled (K-367).';--> statement-breakpoint
COMMENT ON COLUMN "trip_plans"."submitted_at" IS 'Son onaya gönderme anı; taslağa dönünce boşalır.';--> statement-breakpoint
COMMENT ON COLUMN "trip_plans"."approved_at" IS 'Onay anı; düzeltme planı taslağa döndürünce boşalır, iptalde korunur.';--> statement-breakpoint
COMMENT ON COLUMN "trip_plans"."approved_by_user_id" IS 'Onaylayan yönetici (users.id); kişisel veri (K).';--> statement-breakpoint
COMMENT ON COLUMN "trip_plans"."rejected_at" IS 'Ret anı; düzeltme planı taslağa döndürünce boşalır.';--> statement-breakpoint
COMMENT ON COLUMN "trip_plans"."rejection_reason" IS 'Ret gerekçesi (5–500 karakter); denetim kaydına yazılmaz.';--> statement-breakpoint
COMMENT ON COLUMN "trip_plans"."authority_notified_on" IS 'İl/ilçe millî eğitim bildiriminin yapıldığı gün (elle işaret, K-368); onay ister, düzeltmede boşalır.';--> statement-breakpoint
COMMENT ON COLUMN "trip_plans"."authority_reference" IS 'Bildirimin isteğe bağlı evrak sayısı (en çok 60 karakter).';--> statement-breakpoint
COMMENT ON COLUMN "trip_plans"."completed_at" IS 'Tamamlanma anı; dönüş anından sonra, yalnız onaylanmış planda.';--> statement-breakpoint
COMMENT ON COLUMN "trip_plans"."cancelled_at" IS 'İptal anı.';--> statement-breakpoint
COMMENT ON COLUMN "trip_plans"."cancel_reason" IS 'İptal gerekçesi (5–500 karakter); denetim kaydına yazılmaz.';--> statement-breakpoint
COMMENT ON COLUMN "trip_plans"."created_by_user_id" IS 'Taslağı açan kullanıcı (users.id); kişisel veri (K).';--> statement-breakpoint
COMMENT ON COLUMN "trip_plans"."created_at" IS 'Kayıt anı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "trip_plans"."updated_at" IS 'Son değişiklik anı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "trip_plans"."archived_at" IS 'Arşiv anı; plan silinmez, iptal edilir.';--> statement-breakpoint
COMMENT ON COLUMN "trip_plans"."version" IS 'İyimser kilit sürümü (If-Match).';--> statement-breakpoint
COMMENT ON COLUMN "trip_plan_staff"."institution_id" IS 'Kurum (institutions.id); birincil anahtarın ilk kolonu.';--> statement-breakpoint
COMMENT ON COLUMN "trip_plan_staff"."id" IS 'Görev satırı kimliği (UUID).';--> statement-breakpoint
COMMENT ON COLUMN "trip_plan_staff"."plan_id" IS 'Gezi planı (trip_plans).';--> statement-breakpoint
COMMENT ON COLUMN "trip_plan_staff"."membership_id" IS 'Görevlinin kurum üyeliği (memberships; öğretmen ya da yönetici); kişisel veri (K).';--> statement-breakpoint
COMMENT ON COLUMN "trip_plan_staff"."role" IS 'Görev: lead (sorumlu öğretmen) ya da assistant (görevli öğretmen).';--> statement-breakpoint
COMMENT ON COLUMN "trip_plan_staff"."position" IS 'Plandaki sıra (0''dan).';--> statement-breakpoint
COMMENT ON COLUMN "trip_plan_staff"."created_at" IS 'Kayıt anı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "trip_plan_staff"."updated_at" IS 'Son değişiklik anı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "trip_plan_staff"."archived_at" IS 'Görev listesi düzeltilince eski satırın arşiv anı.';--> statement-breakpoint
COMMENT ON COLUMN "trip_plan_staff"."version" IS 'Satır sürümü.';--> statement-breakpoint
COMMENT ON COLUMN "trip_plan_events"."institution_id" IS 'Kurum (institutions.id); birincil anahtarın ilk kolonu.';--> statement-breakpoint
COMMENT ON COLUMN "trip_plan_events"."id" IS 'Geçmiş satırı kimliği (UUID).';--> statement-breakpoint
COMMENT ON COLUMN "trip_plan_events"."plan_id" IS 'Gezi planı (trip_plans).';--> statement-breakpoint
COMMENT ON COLUMN "trip_plan_events"."event" IS 'Adım: created, submitted, approved, rejected, reopened, authority_notified, completed, cancelled.';--> statement-breakpoint
COMMENT ON COLUMN "trip_plan_events"."from_status" IS 'Önceki durum; ilk satırda (created) boş.';--> statement-breakpoint
COMMENT ON COLUMN "trip_plan_events"."to_status" IS 'Sonraki durum.';--> statement-breakpoint
COMMENT ON COLUMN "trip_plan_events"."note" IS 'Adımın notu; retta ve iptalde gerekçe, bildirimde gün ve evrak sayısı (en çok 500 karakter).';--> statement-breakpoint
COMMENT ON COLUMN "trip_plan_events"."actor_user_id" IS 'Adımı yapan kullanıcı (users.id); kişisel veri (K).';--> statement-breakpoint
COMMENT ON COLUMN "trip_plan_events"."occurred_at" IS 'Adımın anı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "trip_plan_events"."created_at" IS 'Kayıt anı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "trip_plan_events"."updated_at" IS 'Kayıt anı (UTC); satır güncellenmez.';--> statement-breakpoint
COMMENT ON COLUMN "trip_plan_events"."archived_at" IS 'Kullanılmaz; satır arşivlenmez.';--> statement-breakpoint
COMMENT ON COLUMN "trip_plan_events"."version" IS 'Satır sürümü.';
