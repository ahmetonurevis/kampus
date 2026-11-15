CREATE TABLE "free_tuition_applications" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"round_id" uuid NOT NULL,
	"student_id" text NOT NULL,
	"reason" text NOT NULL,
	"documents" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"board_meeting_id" uuid,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "free_tuition_applications_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "free_tuition_applications_reason_check" CHECK ("free_tuition_applications"."reason" in ('financial_need', 'martyr_veteran_relative', 'duty_disabled_parent', 'protection_order', 'parent_loss', 'other')),
	CONSTRAINT "free_tuition_applications_documents_check" CHECK ("free_tuition_applications"."documents" <@ array['application_form', 'income_statement', 'household_statement', 'status_document', 'report_card']::text[]),
	CONSTRAINT "free_tuition_applications_status_check" CHECK ("free_tuition_applications"."status" in ('pending', 'accepted', 'reserve', 'rejected')),
	CONSTRAINT "free_tuition_applications_meeting_check" CHECK (("free_tuition_applications"."status" = 'pending') = ("free_tuition_applications"."board_meeting_id" is null))
);
--> statement-breakpoint
CREATE TABLE "free_tuition_awards" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"round_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"board_meeting_id" uuid NOT NULL,
	"student_id" text NOT NULL,
	"academic_year" integer NOT NULL,
	"accepted_date" date NOT NULL,
	"contract_id" text NOT NULL,
	"contract_ids" text[] NOT NULL,
	"cancelled_invoice_ids" text[] NOT NULL,
	"refunded_invoice_ids" text[] NOT NULL,
	"waived_cents" bigint NOT NULL,
	"refund_cents" bigint NOT NULL,
	"currency" text DEFAULT 'TRY' NOT NULL,
	"refund_due_date" date NOT NULL,
	"refund_paid_date" date,
	"refund_iban" text,
	"refund_account_holder" text,
	"refund_paid_by_user_id" text,
	"refund_bank_account_id" uuid,
	"mebbis_recorded_date" date,
	"awarded_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "free_tuition_awards_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "free_tuition_awards_amounts_check" CHECK ("free_tuition_awards"."waived_cents" >= 0 and "free_tuition_awards"."refund_cents" >= 0),
	CONSTRAINT "free_tuition_awards_currency_check" CHECK ("free_tuition_awards"."currency" = 'TRY'),
	CONSTRAINT "free_tuition_awards_refund_paid_check" CHECK (("free_tuition_awards"."refund_paid_date" is null) = ("free_tuition_awards"."refund_iban" is null)
        and ("free_tuition_awards"."refund_paid_date" is null) = ("free_tuition_awards"."refund_account_holder" is null)
        and ("free_tuition_awards"."refund_paid_date" is null) = ("free_tuition_awards"."refund_paid_by_user_id" is null)
        and ("free_tuition_awards"."refund_paid_date" is null) = ("free_tuition_awards"."refund_bank_account_id" is null)
        and ("free_tuition_awards"."refund_paid_date" is null or "free_tuition_awards"."refund_cents" > 0))
);
--> statement-breakpoint
CREATE TABLE "free_tuition_board_meetings" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"round_id" uuid NOT NULL,
	"meeting_date" date NOT NULL,
	"members" jsonb NOT NULL,
	"decisions" jsonb NOT NULL,
	"recorded_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "free_tuition_board_meetings_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "free_tuition_board_meetings_members_check" CHECK (jsonb_typeof("free_tuition_board_meetings"."members") = 'array' and jsonb_array_length("free_tuition_board_meetings"."members") between 3 and 9),
	CONSTRAINT "free_tuition_board_meetings_decisions_check" CHECK (jsonb_typeof("free_tuition_board_meetings"."decisions") = 'array' and jsonb_array_length("free_tuition_board_meetings"."decisions") > 0)
);
--> statement-breakpoint
CREATE TABLE "free_tuition_rounds" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"academic_year" integer NOT NULL,
	"teaching_start_date" date NOT NULL,
	"student_count" integer,
	"computed_quota" integer,
	"confirmed_quota" integer,
	"quota_confirmed_by_user_id" text,
	"quota_confirmed_at" timestamp with time zone,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "free_tuition_rounds_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "free_tuition_rounds_quota_check" CHECK (("free_tuition_rounds"."confirmed_quota" is null) = ("free_tuition_rounds"."quota_confirmed_at" is null)
        and ("free_tuition_rounds"."confirmed_quota" is null) = ("free_tuition_rounds"."student_count" is null)
        and ("free_tuition_rounds"."confirmed_quota" is null) = ("free_tuition_rounds"."computed_quota" is null)
        and ("free_tuition_rounds"."confirmed_quota" is null) = ("free_tuition_rounds"."quota_confirmed_by_user_id" is null)
        and ("free_tuition_rounds"."confirmed_quota" is null or ("free_tuition_rounds"."student_count" >= 0
          and "free_tuition_rounds"."computed_quota" >= 0 and "free_tuition_rounds"."confirmed_quota" >= "free_tuition_rounds"."computed_quota")))
);
--> statement-breakpoint
ALTER TABLE "free_tuition_applications" ADD CONSTRAINT "free_tuition_applications_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "free_tuition_applications" ADD CONSTRAINT "free_tuition_applications_round_fkey" FOREIGN KEY ("institution_id","round_id") REFERENCES "public"."free_tuition_rounds"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "free_tuition_applications" ADD CONSTRAINT "free_tuition_applications_meeting_fkey" FOREIGN KEY ("institution_id","board_meeting_id") REFERENCES "public"."free_tuition_board_meetings"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "free_tuition_awards" ADD CONSTRAINT "free_tuition_awards_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "free_tuition_awards" ADD CONSTRAINT "free_tuition_awards_round_fkey" FOREIGN KEY ("institution_id","round_id") REFERENCES "public"."free_tuition_rounds"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "free_tuition_awards" ADD CONSTRAINT "free_tuition_awards_application_fkey" FOREIGN KEY ("institution_id","application_id") REFERENCES "public"."free_tuition_applications"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "free_tuition_awards" ADD CONSTRAINT "free_tuition_awards_meeting_fkey" FOREIGN KEY ("institution_id","board_meeting_id") REFERENCES "public"."free_tuition_board_meetings"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "free_tuition_awards" ADD CONSTRAINT "free_tuition_awards_refund_bank_account_fkey" FOREIGN KEY ("institution_id","refund_bank_account_id") REFERENCES "public"."bank_accounts"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "free_tuition_board_meetings" ADD CONSTRAINT "free_tuition_board_meetings_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "free_tuition_board_meetings" ADD CONSTRAINT "free_tuition_board_meetings_round_fkey" FOREIGN KEY ("institution_id","round_id") REFERENCES "public"."free_tuition_rounds"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "free_tuition_rounds" ADD CONSTRAINT "free_tuition_rounds_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "free_tuition_applications_round_idx" ON "free_tuition_applications" USING btree ("institution_id","round_id");--> statement-breakpoint
CREATE UNIQUE INDEX "free_tuition_applications_student_key" ON "free_tuition_applications" USING btree ("institution_id","round_id","student_id") WHERE "free_tuition_applications"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "free_tuition_applications_meeting_idx" ON "free_tuition_applications" USING btree ("institution_id","board_meeting_id") WHERE "free_tuition_applications"."board_meeting_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "free_tuition_awards_application_key" ON "free_tuition_awards" USING btree ("institution_id","application_id");--> statement-breakpoint
CREATE UNIQUE INDEX "free_tuition_awards_student_year_key" ON "free_tuition_awards" USING btree ("institution_id","student_id","academic_year") WHERE "free_tuition_awards"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "free_tuition_awards_round_idx" ON "free_tuition_awards" USING btree ("institution_id","round_id");--> statement-breakpoint
CREATE INDEX "free_tuition_awards_meeting_idx" ON "free_tuition_awards" USING btree ("institution_id","board_meeting_id");--> statement-breakpoint
CREATE INDEX "free_tuition_awards_refund_bank_account_idx" ON "free_tuition_awards" USING btree ("institution_id","refund_bank_account_id") WHERE "free_tuition_awards"."refund_bank_account_id" is not null;--> statement-breakpoint
CREATE INDEX "free_tuition_awards_refund_paid_idx" ON "free_tuition_awards" USING btree ("institution_id","refund_paid_date") WHERE "free_tuition_awards"."refund_paid_date" is not null;--> statement-breakpoint
CREATE INDEX "free_tuition_board_meetings_round_idx" ON "free_tuition_board_meetings" USING btree ("institution_id","round_id");--> statement-breakpoint
CREATE UNIQUE INDEX "free_tuition_rounds_year_key" ON "free_tuition_rounds" USING btree ("institution_id","academic_year") WHERE "free_tuition_rounds"."archived_at" is null;--> statement-breakpoint
COMMENT ON TABLE "free_tuition_rounds" IS 'Ücretsiz okutma dönemi (DOM-FIN-026, ON-284, K-268): kurumun bir eğitim yılı için açtığı dönem ve kesinleşen kontenjan. Eğitim yılı başına bir dönem açılır. Kontenjan öğrenci sayısının %3''üdür (freeQuotaCount, 0,5 yukarı yuvarlanır); yönetici bu sayının ve kabul edilmiş aday sayısının altına inmeden kesinleştirir. Kesinleşmemiş dönemde kurul kararı yazılmaz.';--> statement-breakpoint
COMMENT ON TABLE "free_tuition_applications" IS 'Ücretsiz okutma adayı (DOM-FIN-026, K-269): dönemde öğrenci başına bir başvuru. Gerekçe ve teslim edilen belgeler sabit listedendir; belgenin kendisi ve serbest metin saklanmaz (KVKK, en az veri). Durum kurul kararıyla değişir: değerlendirilmemiş ve yedek aday yeniden karara girer, kabul ve ret kesindir. O yıl bursu olan öğrenci aday olamaz.';--> statement-breakpoint
COMMENT ON TABLE "free_tuition_board_meetings" IS 'Ücretsiz okutma değerlendirme kurulu toplantısı (DOM-FIN-026, K-270): toplantı günü, üyeler (ad ve görev) ve kararı veren kullanıcı. Kararlar free_tuition_applications.board_meeting_id ile bağlanır; tutanak PDF''i web''de bu kayıttan üretilir, sunucuda saklanmaz. Kayıt değişmez.';--> statement-breakpoint
COMMENT ON TABLE "free_tuition_awards" IS 'Ücretsiz okutma hakkı (DOM-FIN-026, K-270, K-271): kurulun kabul ettiği öğrencinin o eğitim yılı için hakkı. Kabulle aynı işlemde öğrencinin o yılki yürürlükteki sözleşmelerinde ödenmemiş öğrenim taksitleri kapanır, öğrenim taksitlerine alınmış tutar iade kaydı olur (ek hizmet girmez). İade öğretim başladıktan sonra iki ay içinde, ayrılış iadesinin kurallarıyla (kurum hesabı, ödeyici, gün sonu) ödenir. MEBBİS''e otomatik gönderim yoktur; işlendiği gün elle işaretlenir (IST-143). Öğrenci yılda bir hak alır.';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_rounds"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_rounds"."created_at" IS 'Oluşturma zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_rounds"."updated_at" IS 'Son değişiklik zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_rounds"."archived_at" IS 'Arşiv zamanı; dönem silinmez, alan ileride geri alma için ayrılmıştır.';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_rounds"."version" IS 'İyimser kilit sürümü; her güncellemede bir artar (If-Match).';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_rounds"."id" IS 'Dönem kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_rounds"."academic_year" IS 'Eğitim yılının başlangıç yılı (2026 → 2026-2027); kurumda arşivlenmemiş tek dönem.';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_rounds"."teaching_start_date" IS 'Okulda öğretimin başladığı gün; iadenin son günü bundan iki ay sonradır.';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_rounds"."student_count" IS 'Kontenjan kesinleşirken kurumdaki etkin öğrenci sayısı; kesinleşmemişse boş.';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_rounds"."computed_quota" IS 'Kesinleşme anında hesaplanan en az kontenjan (öğrenci sayısının %3ü, 0,5 yukarı).';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_rounds"."confirmed_quota" IS 'Yöneticinin kesinleştirdiği kontenjan; hesaplanan sayının altına inemez, kabul sayısı bunu aşamaz.';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_rounds"."quota_confirmed_by_user_id" IS 'Kontenjanı son kesinleştiren kullanıcı (Better Auth kimliği).';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_rounds"."quota_confirmed_at" IS 'Kontenjanın son kesinleştiği zaman (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_rounds"."created_by_user_id" IS 'Dönemi açan yönetici (Better Auth kimliği).';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_applications"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_applications"."created_at" IS 'Oluşturma zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_applications"."updated_at" IS 'Son değişiklik zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_applications"."archived_at" IS 'Arşiv zamanı; aday silinmez.';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_applications"."version" IS 'İyimser kilit sürümü; her güncellemede bir artar (If-Match).';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_applications"."id" IS 'Aday kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_applications"."round_id" IS 'Dönem (free_tuition_rounds).';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_applications"."student_id" IS 'Öğrencinin records kimliği; yabancı anahtar değildir. Dönemde öğrenci başına bir aday.';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_applications"."reason" IS 'Gerekçe kodu, sabit liste: financial_need (maddi durum), martyr_veteran_relative (şehit ya da gazi yakını), duty_disabled_parent (harp ya da vazife malulü çocuğu), protection_order (koruma ya da bakım kararı), parent_loss (anne ya da babasını kaybetmiş), other. Hassas veridir; yalnız yönetici ve ön büroya döner, loglanmaz.';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_applications"."documents" IS 'Teslim edilen belgelerin kodları (application_form, income_statement, household_statement, status_document, report_card); belgenin kendisi saklanmaz. Karar verilene kadar değişir.';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_applications"."status" IS 'pending (değerlendirilmedi), accepted (kabul), reserve (yedek), rejected (ret). Kabul ve ret kesindir.';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_applications"."board_meeting_id" IS 'Son kararı veren kurul toplantısı; değerlendirilmemiş adayda boş.';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_applications"."created_by_user_id" IS 'Adayı kaydeden yönetici.';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_board_meetings"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_board_meetings"."created_at" IS 'Oluşturma zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_board_meetings"."updated_at" IS 'Son değişiklik zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_board_meetings"."archived_at" IS 'Arşiv zamanı; toplantı kaydı silinmez.';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_board_meetings"."version" IS 'İyimser kilit sürümü; her güncellemede bir artar (If-Match).';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_board_meetings"."id" IS 'Toplantı kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_board_meetings"."round_id" IS 'Dönem (free_tuition_rounds).';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_board_meetings"."meeting_date" IS 'Kurulun toplandığı gün; gelecekte olamaz. Kabul edilenlerin kabul günüdür.';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_board_meetings"."members" IS 'Kurul üyeleri: [{name, title}] dizisi, 3–9 kişi; ad kişisel veridir.';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_board_meetings"."decisions" IS 'Bu toplantının kararları: [{applicationId, studentId, decision}] dizisi (accepted, reserve, rejected); tutanak bu listeden üretilir. Yedek aday sonraki toplantıda yeniden karara girerse önceki toplantının kaydı değişmez.';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_board_meetings"."recorded_by_user_id" IS 'Kararı sisteme işleyen yönetici.';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_awards"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_awards"."created_at" IS 'Oluşturma zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_awards"."updated_at" IS 'Son değişiklik zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_awards"."archived_at" IS 'Arşiv zamanı; hak silinmez.';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_awards"."version" IS 'İyimser kilit sürümü; her güncellemede bir artar (If-Match).';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_awards"."id" IS 'Hak kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_awards"."round_id" IS 'Dönem (free_tuition_rounds).';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_awards"."application_id" IS 'Kabul edilen aday; aday başına tek hak.';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_awards"."board_meeting_id" IS 'Kabul kararını veren toplantı.';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_awards"."student_id" IS 'Öğrencinin records kimliği; öğrenci yılda bir hak alır.';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_awards"."academic_year" IS 'Hakkın eğitim yılı; yalnız o yıl için geçerlidir.';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_awards"."accepted_date" IS 'Kabul günü (toplantı günü); iade ve MEBBİS günü bundan önce olamaz.';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_awards"."contract_id" IS 'İadenin ödeyicisini veren en yeni sözleşme (records kimliği).';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_awards"."contract_ids" IS 'Hakkın kapsadığı yürürlükteki sözleşmeler; bunlara ek protokol açılmaz, ayrılışta öğrenim ücreti istenmez ve yeniden iade edilmez.';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_awards"."cancelled_invoice_ids" IS 'Kabulle kapanan (arşivlenen) öğrenim taksitleri.';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_awards"."refunded_invoice_ids" IS 'Tahsilatı iadeye giren taksitler; bunlara dağıtılmış tahsilat iptal edilemez.';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_awards"."waived_cents" IS 'Kapanan taksitlerin tahsil edilmemiş kısmı (vazgeçilen alacak), kuruş.';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_awards"."refund_cents" IS 'Öğrenim taksitlerine alınmış ve iade edilecek tutar, kuruş; kabul anında sabitlenir.';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_awards"."currency" IS 'Para birimi; yalnız TRY.';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_awards"."refund_due_date" IS 'İadenin son günü: öğretim başlangıcından iki ay sonra; kurul daha geç karar verdiyse kabul günü.';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_awards"."refund_paid_date" IS 'İadenin ödendiği gün; o günün gün sonuna iade ödemesi olarak girer. Ödenmemişse boş.';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_awards"."refund_iban" IS 'İadenin gönderildiği IBAN (ödeyicinin); yanıtta yalnız son dört hane döner.';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_awards"."refund_account_holder" IS 'IBAN hesap sahibi; sözleşmedeki ödeyici olmalıdır.';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_awards"."refund_paid_by_user_id" IS 'İadeyi ödenmiş işaretleyen yönetici.';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_awards"."refund_bank_account_id" IS 'İadenin çıktığı kurumun bildirilmiş banka hesabı (bank_accounts).';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_awards"."mebbis_recorded_date" IS 'Hakkın MEBBİS''e işlendiği gün; boşsa işaretlenmemiş listesinde görünür. Gönderim elle yapılır.';--> statement-breakpoint
COMMENT ON COLUMN "free_tuition_awards"."awarded_by_user_id" IS 'Kabul kararını işleyen yönetici.';