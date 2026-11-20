CREATE TABLE "teacher_mentorship_checklist_items" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"mentorship_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"label" text NOT NULL,
	"required" boolean NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "teacher_mentorship_checklist_items_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "teacher_mentorship_checklist_items_label_check" CHECK (char_length("teacher_mentorship_checklist_items"."label") between 2 and 120),
	CONSTRAINT "teacher_mentorship_checklist_items_completed_check" CHECK (("teacher_mentorship_checklist_items"."completed_at" is null) = ("teacher_mentorship_checklist_items"."completed_by_user_id" is null))
);
--> statement-breakpoint
CREATE TABLE "teacher_mentorship_meetings" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"mentorship_id" uuid NOT NULL,
	"meeting_date" date NOT NULL,
	"duration_minutes" integer NOT NULL,
	"topic" text NOT NULL,
	"note" text,
	"next_step" text,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "teacher_mentorship_meetings_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "teacher_mentorship_meetings_duration_check" CHECK ("teacher_mentorship_meetings"."duration_minutes" between 5 and 480),
	CONSTRAINT "teacher_mentorship_meetings_text_check" CHECK (char_length("teacher_mentorship_meetings"."topic") between 2 and 200
        and ("teacher_mentorship_meetings"."note" is null or char_length("teacher_mentorship_meetings"."note") between 1 and 4000)
        and ("teacher_mentorship_meetings"."next_step" is null
          or char_length("teacher_mentorship_meetings"."next_step") between 1 and 500))
);
--> statement-breakpoint
CREATE TABLE "teacher_mentorship_settings" (
	"institution_id" text PRIMARY KEY NOT NULL,
	"max_active_per_mentor" integer NOT NULL,
	"checklist_items" jsonb NOT NULL,
	"updated_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "teacher_mentorship_settings_load_check" CHECK ("teacher_mentorship_settings"."max_active_per_mentor" between 1 and 10),
	CONSTRAINT "teacher_mentorship_settings_items_check" CHECK (jsonb_typeof("teacher_mentorship_settings"."checklist_items") = 'array'
        and jsonb_array_length("teacher_mentorship_settings"."checklist_items") <= 20)
);
--> statement-breakpoint
CREATE TABLE "teacher_mentorships" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"mentor_membership_id" text NOT NULL,
	"mentee_membership_id" text NOT NULL,
	"onboarding_offer_id" uuid,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"closed_on" date,
	"end_reason" text,
	"closed_by_user_id" text,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "teacher_mentorships_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "teacher_mentorships_status_check" CHECK ("teacher_mentorships"."status" in ('active', 'completed', 'ended_early')),
	CONSTRAINT "teacher_mentorships_people_check" CHECK ("teacher_mentorships"."mentor_membership_id" <> "teacher_mentorships"."mentee_membership_id"),
	CONSTRAINT "teacher_mentorships_dates_check" CHECK ("teacher_mentorships"."end_date" > "teacher_mentorships"."start_date"
        and ("teacher_mentorships"."closed_on" is null or "teacher_mentorships"."closed_on" >= "teacher_mentorships"."start_date")),
	CONSTRAINT "teacher_mentorships_closed_check" CHECK ((("teacher_mentorships"."status" = 'active') = ("teacher_mentorships"."closed_on" is null))
        and (("teacher_mentorships"."closed_on" is null) = ("teacher_mentorships"."closed_by_user_id" is null))
        and (("teacher_mentorships"."status" = 'ended_early') = ("teacher_mentorships"."end_reason" is not null))
        and ("teacher_mentorships"."end_reason" is null
          or char_length("teacher_mentorships"."end_reason") between 5 and 500))
);
--> statement-breakpoint
ALTER TABLE "teacher_mentorship_checklist_items" ADD CONSTRAINT "teacher_mentorship_checklist_items_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_mentorship_checklist_items" ADD CONSTRAINT "teacher_mentorship_checklist_items_mentorship_fkey" FOREIGN KEY ("institution_id","mentorship_id") REFERENCES "public"."teacher_mentorships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_mentorship_meetings" ADD CONSTRAINT "teacher_mentorship_meetings_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_mentorship_meetings" ADD CONSTRAINT "teacher_mentorship_meetings_mentorship_fkey" FOREIGN KEY ("institution_id","mentorship_id") REFERENCES "public"."teacher_mentorships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_mentorship_settings" ADD CONSTRAINT "teacher_mentorship_settings_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_mentorships" ADD CONSTRAINT "teacher_mentorships_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_mentorships" ADD CONSTRAINT "teacher_mentorships_mentor_fkey" FOREIGN KEY ("institution_id","mentor_membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_mentorships" ADD CONSTRAINT "teacher_mentorships_mentee_fkey" FOREIGN KEY ("institution_id","mentee_membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_mentorships" ADD CONSTRAINT "teacher_mentorships_offer_fkey" FOREIGN KEY ("institution_id","onboarding_offer_id") REFERENCES "public"."staff_job_offers"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "teacher_mentorship_checklist_items_position_key" ON "teacher_mentorship_checklist_items" USING btree ("institution_id","mentorship_id","position");--> statement-breakpoint
CREATE INDEX "teacher_mentorship_meetings_mentorship_idx" ON "teacher_mentorship_meetings" USING btree ("institution_id","mentorship_id","meeting_date");--> statement-breakpoint
CREATE UNIQUE INDEX "teacher_mentorships_mentee_active_key" ON "teacher_mentorships" USING btree ("institution_id","mentee_membership_id") WHERE "teacher_mentorships"."status" = 'active' and "teacher_mentorships"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "teacher_mentorships_mentor_idx" ON "teacher_mentorships" USING btree ("institution_id","mentor_membership_id","status");--> statement-breakpoint
CREATE INDEX "teacher_mentorships_mentee_idx" ON "teacher_mentorships" USING btree ("institution_id","mentee_membership_id");--> statement-breakpoint
CREATE INDEX "teacher_mentorships_offer_idx" ON "teacher_mentorships" USING btree ("institution_id","onboarding_offer_id");--> statement-breakpoint
CREATE INDEX "teacher_mentorships_status_idx" ON "teacher_mentorships" USING btree ("institution_id","status","start_date");--> statement-breakpoint
COMMENT ON TABLE "teacher_mentorship_settings" IS 'Mentorluk kurum ayarı (DOM-FIN-136, ON-219; K-463, K-465): mentor başına süren eşleşme sınırı ve yeni eşleşmelere kopyalanan kontrol listesi. Satır yoksa varsayılan (3 eşleşme, core DEFAULT_MENTORSHIP_CHECKLIST) kullanılır; ayar değişikliği açılmış eşleşmeleri değiştirmez. Yalnız yönetici yazar.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_mentorship_settings"."institution_id" IS 'Kurum; birincil anahtar (kurum başına tek ayar).';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_mentorship_settings"."max_active_per_mentor" IS 'Bir mentorun aynı anda süren en çok eşleşme sayısı (1–10); yeni eşleşmede aşılırsa 422 mentorship_mentor_limit.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_mentorship_settings"."checklist_items" IS 'Kontrol listesi şablonu, sırasıyla: [{label (2–120), required}], en çok 20; aynı madde iki kez olmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_mentorship_settings"."updated_by_user_id" IS 'Ayarı son yazan yönetici.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_mentorship_settings"."created_at" IS 'Oluşturulma anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_mentorship_settings"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_mentorship_settings"."archived_at" IS 'Kullanılmaz (ayar silinmez); zorunlu kolon.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_mentorship_settings"."version" IS 'Satır sürümü; ayar yazımında If-Match ile denetlenir.';
--> statement-breakpoint
COMMENT ON TABLE "teacher_mentorships" IS 'Yeni öğretmen mentorluk eşleşmesi (DOM-FIN-136, ON-219; K-463): mentor ve yeni öğretmen kurum üyeliğidir, aynı kişi olamaz. Sürüyor → tamamlandı ya da erken sonlandı (gerekçeli); kapanan eşleşme değişmez, görüşme ve madde işareti alınmaz. Yeni öğretmenin aynı anda tek süren eşleşmesi olur. Kişisel veri: yalnız yönetici okur, okuma audit_log''a düşer (K-465).';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_mentorships"."institution_id" IS 'Kurum; birincil anahtarın ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_mentorships"."id" IS 'Eşleşme kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_mentorships"."mentor_membership_id" IS 'Mentorun kurum üyeliği (memberships, aynı kurum); açılışta etkin öğretmen ya da yönetici.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_mentorships"."mentee_membership_id" IS 'Yeni öğretmenin kurum üyeliği (memberships, aynı kurum); açılışta etkin öğretmen, mentordan farklı kişi.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_mentorships"."onboarding_offer_id" IS 'İsteğe bağlı işe başlama listesi (staff_job_offers, DOM-FIN-121); açılışta kabul edilmiş ve hesabı yeni öğretmene bağlı teklif.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_mentorships"."start_date" IS 'Eşleşmenin başlangıç günü; görüşme takibi görüşme yokken bu günden sayılır.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_mentorships"."end_date" IS 'Planlanan bitiş günü; başlangıçtan sonra, en çok 366 gün.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_mentorships"."status" IS 'Durum: active (sürüyor), completed (tamamlandı), ended_early (erken sonlandı).';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_mentorships"."closed_on" IS 'Tamamlanma ya da erken sonlanma günü; yalnız kapanmış eşleşmede dolu, başlangıçtan önce olamaz.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_mentorships"."end_reason" IS 'Erken sonlanma gerekçesi (5–500); yalnız ended_early iken dolu, loglanmaz ve denetime yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_mentorships"."closed_by_user_id" IS 'Eşleşmeyi kapatan yönetici; closed_on ile birlikte dolar.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_mentorships"."created_by_user_id" IS 'Eşleşmeyi açan yönetici.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_mentorships"."created_at" IS 'Oluşturulma anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_mentorships"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_mentorships"."archived_at" IS 'Kullanılmaz (eşleşme silinmez); zorunlu kolon.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_mentorships"."version" IS 'Satır sürümü; görüşme, madde işareti ve kapanış If-Match ile bu sürüme göre yapılır.';
--> statement-breakpoint
COMMENT ON TABLE "teacher_mentorship_meetings" IS 'Mentorluk görüşmesi (DOM-FIN-136, K-464): gün, süre, konu, not ve sonraki adım. Yalnız süren eşleşmeye eklenir; gün başlangıçtan önce ve bugünden sonra olamaz. Yanlış kayıt eşleşme sürerken arşivlenir.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_mentorship_meetings"."institution_id" IS 'Kurum; birincil anahtarın ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_mentorship_meetings"."id" IS 'Görüşme kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_mentorship_meetings"."mentorship_id" IS 'Eşleşme (teacher_mentorships, aynı kurum).';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_mentorship_meetings"."meeting_date" IS 'Görüşme günü; son görüşme günü 30 gün takibinin dayanağıdır.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_mentorship_meetings"."duration_minutes" IS 'Süre, dakika (5–480).';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_mentorship_meetings"."topic" IS 'Konu (2–200).';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_mentorship_meetings"."note" IS 'Görüşme notu (1–4000, isteğe bağlı); kişisel veri, loglanmaz ve denetime yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_mentorship_meetings"."next_step" IS 'Sonraki adım (1–500, isteğe bağlı); denetime yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_mentorship_meetings"."created_by_user_id" IS 'Görüşmeyi kaydeden yönetici.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_mentorship_meetings"."created_at" IS 'Oluşturulma anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_mentorship_meetings"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_mentorship_meetings"."archived_at" IS 'Arşiv anı; arşivli görüşme listede görünmez ve takipte sayılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_mentorship_meetings"."version" IS 'Satır sürümü.';
--> statement-breakpoint
COMMENT ON TABLE "teacher_mentorship_checklist_items" IS 'Eşleşmenin kontrol listesi maddesi (DOM-FIN-136, K-465): kurum ayarından açılışta kopyalanır, silinmez. Tamamlanma anı ve işaretleyen birlikte yazılır, geri alınınca birlikte silinir; zorunlu maddeler bitmeden eşleşme tamamlanmaz. Tamamlanma oranı saklanmaz, maddelerden hesaplanır.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_mentorship_checklist_items"."institution_id" IS 'Kurum; birincil anahtarın ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_mentorship_checklist_items"."id" IS 'Madde kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_mentorship_checklist_items"."mentorship_id" IS 'Eşleşme (teacher_mentorships, aynı kurum).';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_mentorship_checklist_items"."position" IS 'Eşleşme içinde sıra (0, 1, …); eşleşmede tekil.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_mentorship_checklist_items"."label" IS 'Madde (2–120); ayardan kopyalanır, sonradan değişmez.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_mentorship_checklist_items"."required" IS 'Eşleşmenin tamamlanması için şart mı.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_mentorship_checklist_items"."completed_at" IS 'Tamamlanma anı (UTC); işaretsizse boş.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_mentorship_checklist_items"."completed_by_user_id" IS 'Maddeyi işaretleyen kullanıcı; completed_at ile birlikte dolar.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_mentorship_checklist_items"."created_at" IS 'Oluşturulma anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_mentorship_checklist_items"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_mentorship_checklist_items"."archived_at" IS 'Kullanılmaz (madde silinmez); zorunlu kolon.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_mentorship_checklist_items"."version" IS 'Satır sürümü.';
