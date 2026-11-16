-- Gezi ve etkinlik ücreti (DOM-FIN-098, ON-142, K-300…K-303). Tablolar yenidir; kısıtları `not valid`
-- adımı olmadan tek adımda eklenir. Numara birleştirmede değişebilir.
-- Elle düzenlendi: `invoices_fee_kind_check` `activity` türüyle genişler (K-301). `invoices` büyüyen
-- tablodur (ON-318): eski kısıt düşer, yenisi `not valid` eklenir, eski satırları taramaz, kilidi
-- kısa sürer; yeni kısıt eskisinden geniştir, var olan satırların hepsi ona uyar. Doğrulama ayrı
-- migration'dadır (0105, `validate constraint`). Drizzle şeması `not valid`'i ifade etmez; snapshot
-- kısıtı tam tutar, `db:generate` fark üretmez.
CREATE TABLE "paid_activities" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"activity_date" date NOT NULL,
	"fee_cents" bigint NOT NULL,
	"currency" text DEFAULT 'TRY' NOT NULL,
	"join_deadline" date NOT NULL,
	"cancel_deadline" date NOT NULL,
	"capacity" integer NOT NULL,
	"late_refund_rule" text NOT NULL,
	"late_refund_percent" integer,
	"late_cost_cents" bigint,
	"external_ref" text,
	"status" text DEFAULT 'open' NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"cancelled_by_user_id" text,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "paid_activities_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "paid_activities_kind_check" CHECK ("paid_activities"."kind" in ('trip', 'event')),
	CONSTRAINT "paid_activities_status_check" CHECK ("paid_activities"."status" in ('open', 'cancelled')),
	CONSTRAINT "paid_activities_rule_check" CHECK ("paid_activities"."late_refund_rule" in ('percent', 'cost')),
	CONSTRAINT "paid_activities_currency_check" CHECK ("paid_activities"."currency" = 'TRY'),
	CONSTRAINT "paid_activities_amounts_check" CHECK ("paid_activities"."fee_cents" > 0 and "paid_activities"."capacity" > 0
        and ("paid_activities"."late_cost_cents" is null or "paid_activities"."late_cost_cents" between 0 and "paid_activities"."fee_cents")
        and ("paid_activities"."late_refund_percent" is null or "paid_activities"."late_refund_percent" between 0 and 100)),
	CONSTRAINT "paid_activities_rule_terms_check" CHECK (("paid_activities"."late_refund_rule" = 'percent') = ("paid_activities"."late_refund_percent" is not null)
        and ("paid_activities"."late_refund_rule" = 'cost') = ("paid_activities"."late_cost_cents" is not null)),
	CONSTRAINT "paid_activities_dates_check" CHECK ("paid_activities"."join_deadline" <= "paid_activities"."activity_date" and "paid_activities"."cancel_deadline" <= "paid_activities"."activity_date"),
	CONSTRAINT "paid_activities_cancel_check" CHECK (("paid_activities"."status" = 'cancelled') = ("paid_activities"."cancelled_at" is not null)
        and ("paid_activities"."cancelled_at" is null) = ("paid_activities"."cancel_reason" is null)
        and ("paid_activities"."cancelled_at" is null) = ("paid_activities"."cancelled_by_user_id" is null))
);
--> statement-breakpoint
CREATE TABLE "paid_activity_participants" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"activity_id" uuid NOT NULL,
	"student_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"fee_cents" bigint NOT NULL,
	"currency" text DEFAULT 'TRY' NOT NULL,
	"joined_date" date NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"cancel_kind" text,
	"cancelled_date" date,
	"paid_cents" bigint,
	"retained_cents" bigint,
	"refund_cents" bigint DEFAULT 0 NOT NULL,
	"closed_invoice_id" text,
	"debt_invoice_id" text,
	"refund_paid_date" date,
	"refund_iban" text,
	"refund_account_holder" text,
	"refund_paid_by_user_id" text,
	"refund_bank_account_id" uuid,
	"created_by_user_id" text NOT NULL,
	"cancelled_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "paid_activity_participants_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "paid_activity_participants_status_check" CHECK ("paid_activity_participants"."status" in ('active', 'cancelled')),
	CONSTRAINT "paid_activity_participants_cancel_kind_check" CHECK ("paid_activity_participants"."cancel_kind" in ('participant', 'activity')),
	CONSTRAINT "paid_activity_participants_currency_check" CHECK ("paid_activity_participants"."currency" = 'TRY'),
	CONSTRAINT "paid_activity_participants_cancel_check" CHECK (("paid_activity_participants"."status" = 'cancelled') = ("paid_activity_participants"."cancelled_date" is not null)
        and ("paid_activity_participants"."cancelled_date" is null) = ("paid_activity_participants"."cancel_kind" is null)
        and ("paid_activity_participants"."cancelled_date" is null) = ("paid_activity_participants"."paid_cents" is null)
        and ("paid_activity_participants"."cancelled_date" is null) = ("paid_activity_participants"."retained_cents" is null)
        and ("paid_activity_participants"."cancelled_date" is null) = ("paid_activity_participants"."cancelled_by_user_id" is null)
        and ("paid_activity_participants"."cancelled_date" is not null or "paid_activity_participants"."refund_cents" = 0)),
	CONSTRAINT "paid_activity_participants_amounts_check" CHECK ("paid_activity_participants"."fee_cents" > 0 and "paid_activity_participants"."refund_cents" >= 0
        and ("paid_activity_participants"."paid_cents" is null or "paid_activity_participants"."paid_cents" >= 0)
        and ("paid_activity_participants"."retained_cents" is null or "paid_activity_participants"."retained_cents" between 0 and "paid_activity_participants"."fee_cents")),
	CONSTRAINT "paid_activity_participants_refund_paid_check" CHECK (("paid_activity_participants"."refund_paid_date" is null) = ("paid_activity_participants"."refund_iban" is null)
        and ("paid_activity_participants"."refund_paid_date" is null) = ("paid_activity_participants"."refund_account_holder" is null)
        and ("paid_activity_participants"."refund_paid_date" is null) = ("paid_activity_participants"."refund_paid_by_user_id" is null)
        and ("paid_activity_participants"."refund_paid_date" is null) = ("paid_activity_participants"."refund_bank_account_id" is null)
        and ("paid_activity_participants"."refund_paid_date" is null or "paid_activity_participants"."refund_cents" > 0))
);
--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_fee_kind_check";--> statement-breakpoint
ALTER TABLE "paid_activities" ADD CONSTRAINT "paid_activities_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paid_activity_participants" ADD CONSTRAINT "paid_activity_participants_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paid_activity_participants" ADD CONSTRAINT "paid_activity_participants_activity_fkey" FOREIGN KEY ("institution_id","activity_id") REFERENCES "public"."paid_activities"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paid_activity_participants" ADD CONSTRAINT "paid_activity_participants_refund_bank_account_fkey" FOREIGN KEY ("institution_id","refund_bank_account_id") REFERENCES "public"."bank_accounts"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "paid_activities_date_idx" ON "paid_activities" USING btree ("institution_id","activity_date");--> statement-breakpoint
CREATE UNIQUE INDEX "paid_activity_participants_student_key" ON "paid_activity_participants" USING btree ("institution_id","activity_id","student_id") WHERE "paid_activity_participants"."status" = 'active' and "paid_activity_participants"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "paid_activity_participants_activity_idx" ON "paid_activity_participants" USING btree ("institution_id","activity_id");--> statement-breakpoint
CREATE INDEX "paid_activity_participants_student_idx" ON "paid_activity_participants" USING btree ("institution_id","student_id");--> statement-breakpoint
CREATE INDEX "paid_activity_participants_refund_bank_account_idx" ON "paid_activity_participants" USING btree ("institution_id","refund_bank_account_id") WHERE "paid_activity_participants"."refund_bank_account_id" is not null;--> statement-breakpoint
CREATE INDEX "paid_activity_participants_refund_paid_idx" ON "paid_activity_participants" USING btree ("institution_id","refund_paid_date") WHERE "paid_activity_participants"."refund_paid_date" is not null;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_fee_kind_check" CHECK ("invoices"."fee_kind" in ('tuition', 'breakfast', 'meal', 'transport', 'dormitory', 'stationery', 'uniform', 'tutoring', 'activity')) NOT VALID;--> statement-breakpoint
COMMENT ON TABLE "paid_activities" IS 'Ücretli gezi ya da etkinlik (DOM-FIN-098, K-300): finans tarafındaki hafif kayıt; ad, tür, gün, kişi başı ücret, son katılım ve son iptal günü, kontenjan ve geç iptalin iade kuralı. Ücret, gün ve iade koşulları katılımcıları bağladığı için kurulduktan sonra değişmez; ad, kontenjan, son katılım günü ve dış referans düzeltilir. Kurum iptal ederse bütün katılımlar tam iadeyle kapanır. Bilet ve oturma düzeni bu tablonun işi değildir.';--> statement-breakpoint
COMMENT ON TABLE "paid_activity_participants" IS 'Gezi ya da etkinlik katılımı (DOM-FIN-098, K-301, K-302): öğrenciye açılan sözleşmesiz taksitle (invoices.fee_kind = activity) bağlıdır. Öğrencinin bir etkinlikte tek iptal edilmemiş katılımı olur. İptalde kesinti, iade ve kapanan ya da yeni açılan taksit kayda yazılır; iade ayrılış iadesinin kurallarıyla ödenir ve gün sonuna iade ödemesi olarak girer (K-303).';--> statement-breakpoint
COMMENT ON COLUMN "paid_activities"."institution_id" IS 'Kurum (institutions.id); birincil anahtarın ilk kolonu.';--> statement-breakpoint
COMMENT ON COLUMN "paid_activities"."id" IS 'Etkinlik kimliği (UUID).';--> statement-breakpoint
COMMENT ON COLUMN "paid_activities"."kind" IS 'Tür: trip (gezi) ya da event (etkinlik; gösteri ve tören bileti ayrı iştir).';--> statement-breakpoint
COMMENT ON COLUMN "paid_activities"."name" IS 'Etkinlik adı (2–120 karakter).';--> statement-breakpoint
COMMENT ON COLUMN "paid_activities"."activity_date" IS 'Etkinlik günü (Europe/Istanbul); kurulurken geçmiş gün olamaz.';--> statement-breakpoint
COMMENT ON COLUMN "paid_activities"."fee_cents" IS 'Kişi başı ücret, kuruş; katılımda taksit tutarı olur, sonradan değişmez.';--> statement-breakpoint
COMMENT ON COLUMN "paid_activities"."currency" IS 'Para birimi; yalnız TRY.';--> statement-breakpoint
COMMENT ON COLUMN "paid_activities"."join_deadline" IS 'Son katılım günü (dahil); etkinlik gününden sonra olamaz. Katılım taksitinin vadesidir.';--> statement-breakpoint
COMMENT ON COLUMN "paid_activities"."cancel_deadline" IS 'Son iptal günü (dahil); bu güne kadar katılımcı iptalinde tam iade yapılır.';--> statement-breakpoint
COMMENT ON COLUMN "paid_activities"."capacity" IS 'Kontenjan; iptal edilmemiş katılımlar bunu aşamaz, düzeltmede katılımcı sayısının altına inemez.';--> statement-breakpoint
COMMENT ON COLUMN "paid_activities"."late_refund_rule" IS 'Son iptal gününden sonraki iptalin kuralı: percent (ücretin late_refund_percent kadarı iade) ya da cost (late_cost_cents düşülür).';--> statement-breakpoint
COMMENT ON COLUMN "paid_activities"."late_refund_percent" IS 'Oran kuralında geç iptalde iade edilen yüzde (0–100); cost kuralında boş.';--> statement-breakpoint
COMMENT ON COLUMN "paid_activities"."late_cost_cents" IS 'Masraf kuralında kişi başı gerçekleşen masraf, kuruş (en çok ücret); percent kuralında boş.';--> statement-breakpoint
COMMENT ON COLUMN "paid_activities"."external_ref" IS 'Dış referans: gezi planı (ON-155) ya da başka kaynak kaydının kimliği; plan gelince bağlanır, boş olabilir.';--> statement-breakpoint
COMMENT ON COLUMN "paid_activities"."status" IS 'Durum: open (açık) ya da cancelled (kurum iptal etti).';--> statement-breakpoint
COMMENT ON COLUMN "paid_activities"."cancelled_at" IS 'Kurumun etkinliği iptal ettiği an; açıkken boş.';--> statement-breakpoint
COMMENT ON COLUMN "paid_activities"."cancel_reason" IS 'Kurumun iptal gerekçesi (5–500 karakter); loglanmaz.';--> statement-breakpoint
COMMENT ON COLUMN "paid_activities"."cancelled_by_user_id" IS 'İptal eden kullanıcı (Better Auth user.id).';--> statement-breakpoint
COMMENT ON COLUMN "paid_activities"."created_by_user_id" IS 'Etkinliği tanımlayan kullanıcı (Better Auth user.id).';--> statement-breakpoint
COMMENT ON COLUMN "paid_activities"."created_at" IS 'Kaydın oluşturulma anı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "paid_activities"."updated_at" IS 'Son değişiklik anı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "paid_activities"."archived_at" IS 'Arşiv anı; kayıt silinmez, bugün arşivleme ucu yoktur.';--> statement-breakpoint
COMMENT ON COLUMN "paid_activities"."version" IS 'İyimser kilit sürümü (If-Match).';--> statement-breakpoint
COMMENT ON COLUMN "paid_activity_participants"."institution_id" IS 'Kurum (institutions.id); birincil anahtarın ilk kolonu.';--> statement-breakpoint
COMMENT ON COLUMN "paid_activity_participants"."id" IS 'Katılım kimliği (UUID).';--> statement-breakpoint
COMMENT ON COLUMN "paid_activity_participants"."activity_id" IS 'Etkinlik (paid_activities.id, kurum içi yabancı anahtar).';--> statement-breakpoint
COMMENT ON COLUMN "paid_activity_participants"."student_id" IS 'Öğrenci (records students kimliği; yabancı anahtar değil).';--> statement-breakpoint
COMMENT ON COLUMN "paid_activity_participants"."invoice_id" IS 'Katılımın açtığı sözleşmesiz taksit (invoices.id, fee_kind activity).';--> statement-breakpoint
COMMENT ON COLUMN "paid_activity_participants"."fee_cents" IS 'Katılım anındaki kişi başı ücret, kuruş.';--> statement-breakpoint
COMMENT ON COLUMN "paid_activity_participants"."currency" IS 'Para birimi; yalnız TRY.';--> statement-breakpoint
COMMENT ON COLUMN "paid_activity_participants"."joined_date" IS 'Katılımın yazıldığı gün (Europe/Istanbul).';--> statement-breakpoint
COMMENT ON COLUMN "paid_activity_participants"."status" IS 'Durum: active ya da cancelled.';--> statement-breakpoint
COMMENT ON COLUMN "paid_activity_participants"."cancel_kind" IS 'İptal türü: participant (katılımcı iptali, iade kuralı uygulanır) ya da activity (kurum etkinliği iptal etti, tam iade).';--> statement-breakpoint
COMMENT ON COLUMN "paid_activity_participants"."cancelled_date" IS 'İptal günü (Europe/Istanbul); iade ödemesi bu günden önce olamaz.';--> statement-breakpoint
COMMENT ON COLUMN "paid_activity_participants"."paid_cents" IS 'İptal anına dek taksite alınmış tutar, kuruş.';--> statement-breakpoint
COMMENT ON COLUMN "paid_activity_participants"."retained_cents" IS 'Katılımcıda kalan kesinti, kuruş (son iptal gününden sonra kurala göre; kurum iptalinde 0).';--> statement-breakpoint
COMMENT ON COLUMN "paid_activity_participants"."refund_cents" IS 'İade edilecek tutar: alınan tutarın kesintiyi aşan kısmı, kuruş; iptal edilmemişte 0.';--> statement-breakpoint
COMMENT ON COLUMN "paid_activity_participants"."closed_invoice_id" IS 'İptalde kapanan (listeden düşen) taksit; tam ödenmiş taksit kalır, alan boştur.';--> statement-breakpoint
COMMENT ON COLUMN "paid_activity_participants"."debt_invoice_id" IS 'Kesinti alınandan fazlaysa farkın iptal gününde açılan yeni taksiti; yoksa boş.';--> statement-breakpoint
COMMENT ON COLUMN "paid_activity_participants"."refund_paid_date" IS 'İadenin ödendiği gün; ödenmemişse boş.';--> statement-breakpoint
COMMENT ON COLUMN "paid_activity_participants"."refund_iban" IS 'İadenin gönderildiği IBAN; yanıtta yalnız son dört hane döner, loglanmaz.';--> statement-breakpoint
COMMENT ON COLUMN "paid_activity_participants"."refund_account_holder" IS 'İade hesabının sahibi: öğrencinin kayıtlı velisi, velisi yoksa kendisi (K-303).';--> statement-breakpoint
COMMENT ON COLUMN "paid_activity_participants"."refund_paid_by_user_id" IS 'İadeyi işleyen kullanıcı (Better Auth user.id).';--> statement-breakpoint
COMMENT ON COLUMN "paid_activity_participants"."refund_bank_account_id" IS 'İadenin çıktığı kurum banka hesabı (bank_accounts.id, silme kısıtlı).';--> statement-breakpoint
COMMENT ON COLUMN "paid_activity_participants"."created_by_user_id" IS 'Katılımı yazan kullanıcı (Better Auth user.id).';--> statement-breakpoint
COMMENT ON COLUMN "paid_activity_participants"."cancelled_by_user_id" IS 'Katılımı iptal eden kullanıcı (Better Auth user.id).';--> statement-breakpoint
COMMENT ON COLUMN "paid_activity_participants"."created_at" IS 'Kaydın oluşturulma anı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "paid_activity_participants"."updated_at" IS 'Son değişiklik anı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "paid_activity_participants"."archived_at" IS 'Arşiv anı; katılım silinmez, iptal edilir.';--> statement-breakpoint
COMMENT ON COLUMN "paid_activity_participants"."version" IS 'İyimser kilit sürümü (If-Match).';--> statement-breakpoint
COMMENT ON COLUMN "invoices"."fee_kind" IS 'Kalem türü anahtarı: tuition (öğrenim), breakfast, meal, transport, dormitory, stationery, uniform, tutoring (core FEE_ITEM_KINDS, DOM-FIN-004) ya da activity (gezi ve etkinlik katılımı, DOM-FIN-098; tarife kalemi değildir); core INVOICE_FEE_KINDS. Core kaydında alan yoksa boş (eski kayıt, öğrenim sayılır).';--> statement-breakpoint
COMMENT ON CONSTRAINT "invoices_fee_kind_check" ON "invoices" IS 'Kalem türü core INVOICE_FEE_KINDS listesindedir (FEE_ITEM_KINDS ve activity) ya da boştur; liste değişirse kısıt yeni migration ile güncellenir (ON-316, ON-142).';