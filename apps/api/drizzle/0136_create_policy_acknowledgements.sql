CREATE TABLE "policy_acknowledgements" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"policy_document_id" uuid NOT NULL,
	"membership_id" text NOT NULL,
	"acknowledged_on" date NOT NULL,
	"channel" text NOT NULL,
	"scan_file_id" uuid,
	"recorded_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "policy_acknowledgements_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "policy_acknowledgements_channel_check" CHECK ("policy_acknowledgements"."channel" in ('self_service', 'wet_signature', 'email', 'in_person'))
);
--> statement-breakpoint
CREATE TABLE "policy_documents" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"series_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"title" text NOT NULL,
	"policy_type" text NOT NULL,
	"audience" text NOT NULL,
	"published_on" date NOT NULL,
	"file_id" uuid NOT NULL,
	"replaces_id" uuid,
	"superseded_at" timestamp with time zone,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "policy_documents_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "policy_documents_type_check" CHECK ("policy_documents"."policy_type" in ('staff_regulation', 'kvkk_commitment', 'occupational_safety', 'discipline', 'other')),
	CONSTRAINT "policy_documents_audience_check" CHECK ("policy_documents"."audience" in ('all_staff', 'teachers', 'administrative')),
	CONSTRAINT "policy_documents_version_check" CHECK ("policy_documents"."version_number" >= 1),
	CONSTRAINT "policy_documents_title_check" CHECK (char_length("policy_documents"."title") between 2 and 160),
	CONSTRAINT "policy_documents_first_version_check" CHECK (("policy_documents"."version_number" = 1) = ("policy_documents"."replaces_id" is null))
);
--> statement-breakpoint
ALTER TABLE "policy_acknowledgements" ADD CONSTRAINT "policy_acknowledgements_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_acknowledgements" ADD CONSTRAINT "policy_acknowledgements_document_fkey" FOREIGN KEY ("institution_id","policy_document_id") REFERENCES "public"."policy_documents"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_acknowledgements" ADD CONSTRAINT "policy_acknowledgements_membership_fkey" FOREIGN KEY ("institution_id","membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_acknowledgements" ADD CONSTRAINT "policy_acknowledgements_scan_file_fkey" FOREIGN KEY ("institution_id","scan_file_id") REFERENCES "public"."files"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_documents" ADD CONSTRAINT "policy_documents_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_documents" ADD CONSTRAINT "policy_documents_file_fkey" FOREIGN KEY ("institution_id","file_id") REFERENCES "public"."files"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_documents" ADD CONSTRAINT "policy_documents_replaces_fkey" FOREIGN KEY ("institution_id","replaces_id") REFERENCES "public"."policy_documents"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "policy_acknowledgements_member_key" ON "policy_acknowledgements" USING btree ("institution_id","policy_document_id","membership_id");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_acknowledgements_scan_file_key" ON "policy_acknowledgements" USING btree ("institution_id","scan_file_id") WHERE "policy_acknowledgements"."scan_file_id" is not null;--> statement-breakpoint
CREATE INDEX "policy_acknowledgements_membership_idx" ON "policy_acknowledgements" USING btree ("institution_id","membership_id");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_documents_series_version_key" ON "policy_documents" USING btree ("institution_id","series_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_documents_current_key" ON "policy_documents" USING btree ("institution_id","series_id") WHERE "policy_documents"."superseded_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "policy_documents_file_key" ON "policy_documents" USING btree ("institution_id","file_id");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_documents_replaces_key" ON "policy_documents" USING btree ("institution_id","replaces_id") WHERE "policy_documents"."replaces_id" is not null;--> statement-breakpoint
-- Onay kaydı değişmez ve silinmez (DOM-FIN-127, K-437): ortak `kampus_reject_immutable_change()` (migration 0013, 55000).
CREATE TRIGGER "policy_acknowledgements_immutable_trigger" BEFORE UPDATE OR DELETE ON "policy_acknowledgements" FOR EACH ROW EXECUTE FUNCTION "kampus_reject_immutable_change"();--> statement-breakpoint
CREATE TRIGGER "policy_acknowledgements_truncate_trigger" BEFORE TRUNCATE ON "policy_acknowledgements" FOR EACH STATEMENT EXECUTE FUNCTION "kampus_reject_immutable_change"();--> statement-breakpoint
COMMENT ON TABLE "policy_documents" IS 'Politika belgesi sürümü (DOM-FIN-127, ON-190, K-436…K-438): personel yönetmeliği, KVKK taahhüdü, iş güvenliği, disiplin ya da diğer kurum belgesi; ad, tür, hedef kitle, yayın günü ve PDF dosyası. Her satır bir sürümdür; yeni sürüm öncekinin yerine geçer ve önceki sürümün onayları geçersiz sayılır (personel yeniden onaylar). Belge silinmez.';
--> statement-breakpoint
COMMENT ON COLUMN "policy_documents"."institution_id" IS 'Kurum.';
--> statement-breakpoint
COMMENT ON COLUMN "policy_documents"."id" IS 'Sürüm kimliği (UUID); onay kaydı bu kimliğe bağlanır.';
--> statement-breakpoint
COMMENT ON COLUMN "policy_documents"."series_id" IS 'Aynı belgenin sürümlerini bağlayan kimlik; ilk sürümde kendi kimliğidir. Seri başına yerine geçilmemiş tek sürüm vardır.';
--> statement-breakpoint
COMMENT ON COLUMN "policy_documents"."version_number" IS 'Sürüm numarası; ilk sürüm 1, her yeni sürüm bir artar.';
--> statement-breakpoint
COMMENT ON COLUMN "policy_documents"."title" IS 'Belge adı (2–160 karakter).';
--> statement-breakpoint
COMMENT ON COLUMN "policy_documents"."policy_type" IS 'Belge türü: staff_regulation personel yönetmeliği, kvkk_commitment KVKK taahhüdü, occupational_safety iş güvenliği, discipline disiplin, other diğer.';
--> statement-breakpoint
COMMENT ON COLUMN "policy_documents"."audience" IS 'Hedef kitle: all_staff tüm personel (yönetici, öğretmen, ön büro), teachers öğretmenler, administrative idari personel (yönetici ve ön büro). Takip yalnız etkin personelde yapılır.';
--> statement-breakpoint
COMMENT ON COLUMN "policy_documents"."published_on" IS 'Yayın günü; bugünden sonra olamaz, yeni sürümde öncekinden önce olamaz. Onay günü bundan önce olamaz.';
--> statement-breakpoint
COMMENT ON COLUMN "policy_documents"."file_id" IS 'Belgenin PDF dosyası (files; amaç document, bağ türü policy_document); zorunlu, bir dosya tek sürüme bağlanır.';
--> statement-breakpoint
COMMENT ON COLUMN "policy_documents"."replaces_id" IS 'Bu sürümün yerine geçtiği önceki sürüm; ilk sürümde boş. Bir sürümün yerine en çok bir sürüm geçer.';
--> statement-breakpoint
COMMENT ON COLUMN "policy_documents"."superseded_at" IS 'Yerine yeni sürüm yayımlandığı an; doluysa sürüm geçmiştir, onay alınmaz ve onayları takipte sayılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "policy_documents"."created_by_user_id" IS 'Sürümü yayımlayan yönetici.';
--> statement-breakpoint
COMMENT ON COLUMN "policy_documents"."created_at" IS 'Kaydın açıldığı an (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "policy_documents"."updated_at" IS 'Son değişiklik anı (UTC; yerine geçilince güncellenir).';
--> statement-breakpoint
COMMENT ON COLUMN "policy_documents"."archived_at" IS 'Kullanılmıyor (zorunlu kolon); belge silinmez ve arşivlenmez, yeni sürümle yerine geçilir.';
--> statement-breakpoint
COMMENT ON COLUMN "policy_documents"."version" IS 'İyimser kilit sürümü; yerine geçilince artar.';
--> statement-breakpoint
COMMENT ON TABLE "policy_acknowledgements" IS 'Politika belgesi okundu onayı (DOM-FIN-127, ON-190, K-436, K-437): personel üyeliği × belge sürümü başına tek satır; onay günü, kanal, isteğe bağlı ıslak imza taraması ve kaydı giren. Satır değişmez ve silinmez (kampus_reject_immutable_change).';
--> statement-breakpoint
COMMENT ON COLUMN "policy_acknowledgements"."institution_id" IS 'Kurum.';
--> statement-breakpoint
COMMENT ON COLUMN "policy_acknowledgements"."id" IS 'Onay kaydı kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "policy_acknowledgements"."policy_document_id" IS 'Onaylanan belge sürümü (policy_documents); kayıt anında geçerli sürüm olmalıdır. Silinemez: restrict.';
--> statement-breakpoint
COMMENT ON COLUMN "policy_acknowledgements"."membership_id" IS 'Onaylayan personelin kurum üyeliği (yönetici, öğretmen ya da ön büro; etkin ve hedef kitlede); ayrı personel tablosu yoktur. Restrict.';
--> statement-breakpoint
COMMENT ON COLUMN "policy_acknowledgements"."acknowledged_on" IS 'Personelin okuyup imzaladığı gün; yayın gününden önce ve kayıt gününden sonra olamaz.';
--> statement-breakpoint
COMMENT ON COLUMN "policy_acknowledgements"."channel" IS 'Onay kanalı: self_service personelin kendi ekranı, wet_signature ıslak imzalı form, email e-posta ile onay, in_person yüz yüze beyan. Yönetici/ön büro kaydında self_service seçilemez.';
--> statement-breakpoint
COMMENT ON COLUMN "policy_acknowledgements"."scan_file_id" IS 'İsteğe bağlı ıslak imza taraması (files; amaç document, bağ türü policy_acknowledgement); bir dosya tek onaya bağlanır.';
--> statement-breakpoint
COMMENT ON COLUMN "policy_acknowledgements"."recorded_by_user_id" IS 'Kaydı giren kullanıcı (personel adına yönetici ya da ön büro).';
--> statement-breakpoint
COMMENT ON COLUMN "policy_acknowledgements"."created_at" IS 'Kaydın girildiği an (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "policy_acknowledgements"."updated_at" IS 'Kayıt anı (UTC); satır değişmez.';
--> statement-breakpoint
COMMENT ON COLUMN "policy_acknowledgements"."archived_at" IS 'Kullanılmıyor (zorunlu kolon); onay silinmez ve arşivlenmez.';
--> statement-breakpoint
COMMENT ON COLUMN "policy_acknowledgements"."version" IS 'Sürüm; satır değişmediğinden 1 kalır.';
