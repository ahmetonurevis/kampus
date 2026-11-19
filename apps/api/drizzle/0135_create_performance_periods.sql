CREATE TABLE "performance_periods" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" text DEFAULT 'planning' NOT NULL,
	"created_by_user_id" text NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "performance_periods_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "performance_periods_status_check" CHECK ("performance_periods"."status" in ('planning', 'active', 'interim', 'evaluation', 'closed')),
	CONSTRAINT "performance_periods_name_check" CHECK (char_length("performance_periods"."name") between 2 and 120),
	CONSTRAINT "performance_periods_dates_check" CHECK ("performance_periods"."end_date" >= "performance_periods"."start_date"),
	CONSTRAINT "performance_periods_closed_check" CHECK ((("performance_periods"."status" = 'closed') = ("performance_periods"."closed_at" is not null))
        and (("performance_periods"."closed_at" is null) = ("performance_periods"."closed_by_user_id" is null)))
);
--> statement-breakpoint
CREATE TABLE "performance_reviews" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"membership_id" text NOT NULL,
	"goals" jsonb NOT NULL,
	"interim_note" text,
	"interim_date" date,
	"evaluator_user_id" text,
	"evaluator_name" text,
	"evaluated_at" timestamp with time zone,
	"staff_comment" text,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "performance_reviews_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "performance_reviews_goals_check" CHECK (jsonb_typeof("performance_reviews"."goals") = 'array' and jsonb_array_length("performance_reviews"."goals") between 1 and 10),
	CONSTRAINT "performance_reviews_notes_check" CHECK (("performance_reviews"."interim_note" is null or char_length("performance_reviews"."interim_note") between 1 and 2000)
        and ("performance_reviews"."staff_comment" is null or char_length("performance_reviews"."staff_comment") between 1 and 2000)),
	CONSTRAINT "performance_reviews_evaluator_check" CHECK ((("performance_reviews"."evaluator_user_id" is null) = ("performance_reviews"."evaluated_at" is null))
        and (("performance_reviews"."evaluator_user_id" is null) = ("performance_reviews"."evaluator_name" is null)))
);
--> statement-breakpoint
ALTER TABLE "performance_periods" ADD CONSTRAINT "performance_periods_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_period_fkey" FOREIGN KEY ("institution_id","period_id") REFERENCES "public"."performance_periods"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_membership_fkey" FOREIGN KEY ("institution_id","membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "performance_periods_start_idx" ON "performance_periods" USING btree ("institution_id","start_date");--> statement-breakpoint
CREATE UNIQUE INDEX "performance_reviews_member_key" ON "performance_reviews" USING btree ("institution_id","period_id","membership_id");--> statement-breakpoint
CREATE INDEX "performance_reviews_membership_idx" ON "performance_reviews" USING btree ("institution_id","membership_id");--> statement-breakpoint
COMMENT ON TABLE "performance_periods" IS 'Personel performans dönemi (DOM-FIN-124, ON-211): ad, başlangıç–bitiş ve aşama. Aşama yalnız ileri gider (planning → active → interim → evaluation → closed; K-427); kapanınca dönemin kayıtları kilitlenir (K-428).';
--> statement-breakpoint
COMMENT ON COLUMN "performance_periods"."institution_id" IS 'Kurum; birincil anahtarın ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "performance_periods"."id" IS 'Dönem kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "performance_periods"."name" IS 'Dönem adı (2–120 karakter).';
--> statement-breakpoint
COMMENT ON COLUMN "performance_periods"."start_date" IS 'Dönemin ilk günü.';
--> statement-breakpoint
COMMENT ON COLUMN "performance_periods"."end_date" IS 'Dönemin son günü (dahil); başlangıçtan önce olamaz. Ara görüşme günü bu aralıktadır.';
--> statement-breakpoint
COMMENT ON COLUMN "performance_periods"."status" IS 'Aşama: planning (hedef belirleme), active (yürürlükte), interim (ara görüşme), evaluation (dönem sonu değerlendirme), closed (kapandı, kilitli).';
--> statement-breakpoint
COMMENT ON COLUMN "performance_periods"."created_by_user_id" IS 'Dönemi açan yönetici.';
--> statement-breakpoint
COMMENT ON COLUMN "performance_periods"."closed_at" IS 'Kapanış anı (UTC); yalnız closed aşamasında dolu.';
--> statement-breakpoint
COMMENT ON COLUMN "performance_periods"."closed_by_user_id" IS 'Dönemi kapatan yönetici; closed_at ile birlikte dolar.';
--> statement-breakpoint
COMMENT ON COLUMN "performance_periods"."created_at" IS 'Oluşturulma anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "performance_periods"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "performance_periods"."archived_at" IS 'Kullanılmaz (dönem silinmez); zorunlu kolon.';
--> statement-breakpoint
COMMENT ON COLUMN "performance_periods"."version" IS 'Satır sürümü; aşama geçişinde If-Match ile denetlenir.';
--> statement-breakpoint
COMMENT ON TABLE "performance_reviews" IS 'Personel × dönem performans kaydı (DOM-FIN-124, ON-211): hedefler, ara görüşme, dönem sonu puanları, değerlendiren ve personel görüşü. Dönemde personel başına tek kayıt; genel puan saklanmaz, hedeflerden hesaplanır. Kişisel veri: yalnız yönetici okur, her okuma audit_log''a düşer (K-429).';
--> statement-breakpoint
COMMENT ON COLUMN "performance_reviews"."institution_id" IS 'Kurum; birincil anahtarın ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "performance_reviews"."id" IS 'Kayıt kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "performance_reviews"."period_id" IS 'Performans dönemi (performance_periods, aynı kurum).';
--> statement-breakpoint
COMMENT ON COLUMN "performance_reviews"."membership_id" IS 'Değerlendirilen personelin kurum üyeliği (memberships, aynı kurum); personel tablosu ayrı değildir.';
--> statement-breakpoint
COMMENT ON COLUMN "performance_reviews"."goals" IS 'Hedefler, sırasıyla: [{title, criterion, weight (%), score (1–5 ya da null)}] dizisi, 1–10 hedef, ağırlıklar toplamı 100. Hedef değişince puanlar sıfırlanır.';
--> statement-breakpoint
COMMENT ON COLUMN "performance_reviews"."interim_note" IS 'Ara görüşme notu (1–2000); ara görüşme ve değerlendirmede yazılır, denetim kaydına yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "performance_reviews"."interim_date" IS 'Ara görüşmenin yapıldığı gün; dönem içinde, bugünden sonra olamaz.';
--> statement-breakpoint
COMMENT ON COLUMN "performance_reviews"."evaluator_user_id" IS 'Dönem sonu puanını son yazan yönetici (değerlendiren).';
--> statement-breakpoint
COMMENT ON COLUMN "performance_reviews"."evaluator_name" IS 'Değerlendirenin puan anındaki adı.';
--> statement-breakpoint
COMMENT ON COLUMN "performance_reviews"."evaluated_at" IS 'Puanın son yazıldığı an (UTC); değerlendiren ile birlikte dolar.';
--> statement-breakpoint
COMMENT ON COLUMN "performance_reviews"."staff_comment" IS 'Personelin değerlendirmeye görüşü (1–2000); yönetici personel adına girer (K-428), denetim kaydına yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "performance_reviews"."created_by_user_id" IS 'Kaydı açan yönetici.';
--> statement-breakpoint
COMMENT ON COLUMN "performance_reviews"."created_at" IS 'Oluşturulma anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "performance_reviews"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "performance_reviews"."archived_at" IS 'Kullanılmaz (kayıt silinmez); zorunlu kolon.';
--> statement-breakpoint
COMMENT ON COLUMN "performance_reviews"."version" IS 'Satır sürümü; düzeltmede If-Match ile denetlenir.';
