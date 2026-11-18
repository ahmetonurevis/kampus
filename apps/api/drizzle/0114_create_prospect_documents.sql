CREATE TABLE "prospect_document_consents" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"prospect_id" text NOT NULL,
	"grantor" text NOT NULL,
	"method" text NOT NULL,
	"granted_at" timestamp with time zone NOT NULL,
	"granted_by_user_id" text NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"withdrawn_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "prospect_document_consents_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "prospect_document_consents_grantor_check" CHECK ("prospect_document_consents"."grantor" in ('guardian', 'self')),
	CONSTRAINT "prospect_document_consents_method_check" CHECK ("prospect_document_consents"."method" in ('wet_signature')),
	CONSTRAINT "prospect_document_consents_withdrawn_check" CHECK (("prospect_document_consents"."withdrawn_at" is null) = ("prospect_document_consents"."withdrawn_by_user_id" is null))
);
--> statement-breakpoint
CREATE TABLE "prospect_document_types" (
	"institution_id" text NOT NULL,
	"id" text NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"required" boolean NOT NULL,
	"stage" text NOT NULL,
	"special_category" boolean NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "prospect_document_types_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "prospect_document_types_id_check" CHECK (char_length("prospect_document_types"."id") between 1 and 64),
	CONSTRAINT "prospect_document_types_kind_check" CHECK ("prospect_document_types"."kind" in ('identity', 'report_card', 'health_report', 'photo', 'other')),
	CONSTRAINT "prospect_document_types_stage_check" CHECK ("prospect_document_types"."stage" in ('application', 'enrollment')),
	CONSTRAINT "prospect_document_types_label_check" CHECK (char_length("prospect_document_types"."label") between 2 and 80),
	CONSTRAINT "prospect_document_types_special_check" CHECK ("prospect_document_types"."kind" <> 'health_report' or "prospect_document_types"."special_category")
);
--> statement-breakpoint
CREATE TABLE "prospect_documents" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"prospect_id" text NOT NULL,
	"document_type_id" text NOT NULL,
	"file_id" uuid NOT NULL,
	"status" text NOT NULL,
	"special_category" boolean NOT NULL,
	"rejection_reason" text,
	"uploaded_by_user_id" text NOT NULL,
	"reviewed_by_user_id" text,
	"reviewed_at" timestamp with time zone,
	"superseded_at" timestamp with time zone,
	"superseded_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "prospect_documents_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "prospect_documents_status_check" CHECK ("prospect_documents"."status" in ('uploaded', 'accepted', 'rejected', 'superseded')),
	CONSTRAINT "prospect_documents_rejection_check" CHECK (("prospect_documents"."status" <> 'rejected' or "prospect_documents"."rejection_reason" is not null) and ("prospect_documents"."rejection_reason" is null or "prospect_documents"."status" in ('rejected', 'superseded'))),
	CONSTRAINT "prospect_documents_rejection_length_check" CHECK ("prospect_documents"."rejection_reason" is null or char_length("prospect_documents"."rejection_reason") between 2 and 300),
	CONSTRAINT "prospect_documents_superseded_check" CHECK (("prospect_documents"."status" = 'superseded') = ("prospect_documents"."superseded_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "prospect_document_consents" ADD CONSTRAINT "prospect_document_consents_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_document_types" ADD CONSTRAINT "prospect_document_types_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_documents" ADD CONSTRAINT "prospect_documents_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_documents" ADD CONSTRAINT "prospect_documents_type_fkey" FOREIGN KEY ("institution_id","document_type_id") REFERENCES "public"."prospect_document_types"("institution_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_documents" ADD CONSTRAINT "prospect_documents_file_fkey" FOREIGN KEY ("institution_id","file_id") REFERENCES "public"."files"("institution_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prospect_document_consents_prospect_idx" ON "prospect_document_consents" USING btree ("institution_id","prospect_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prospect_document_consents_active_key" ON "prospect_document_consents" USING btree ("institution_id","prospect_id") WHERE "prospect_document_consents"."withdrawn_at" is null and "prospect_document_consents"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "prospect_documents_prospect_idx" ON "prospect_documents" USING btree ("institution_id","prospect_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prospect_documents_current_key" ON "prospect_documents" USING btree ("institution_id","prospect_id","document_type_id") WHERE "prospect_documents"."status" <> 'superseded' and "prospect_documents"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "prospect_documents_file_key" ON "prospect_documents" USING btree ("institution_id","file_id");--> statement-breakpoint
CREATE INDEX "prospect_documents_type_idx" ON "prospect_documents" USING btree ("institution_id","document_type_id");--> statement-breakpoint
COMMENT ON TABLE "prospect_document_types" IS 'Aday belge türü listesi (DOM-KAY-043, ON-263, K-320): kurum ayarı. Kurumun ilk okumasında varsayılan türler (kimlik, karne, fotoğraf, sağlık raporu, diğer) yazılır; yönetici tür ekler, düzeltir, arşivler. Ön büro ve yönetici okur.';--> statement-breakpoint
COMMENT ON COLUMN "prospect_document_types"."institution_id" IS 'Kurum; bütün sorgular bu kolonla kapsanır.';--> statement-breakpoint
COMMENT ON COLUMN "prospect_document_types"."id" IS 'Tür kimliği: varsayılan türlerde türün kendisi (identity, report_card, photo, health_report, other), eklenen türde UUID. prospect_documents.document_type_id buna işaret eder.';--> statement-breakpoint
COMMENT ON COLUMN "prospect_document_types"."kind" IS 'Belge türü: identity (kimlik / nüfus kayıt örneği), report_card (karne / transkript), health_report (sağlık raporu), photo (fotoğraf), other (diğer). Sonradan değişmez.';--> statement-breakpoint
COMMENT ON COLUMN "prospect_document_types"."label" IS 'Ekranda görünen belge adı (2–80 karakter); arşivlenmemiş türler arasında büyük/küçük harf duyarsız tekil (serviste denetlenir).';--> statement-breakpoint
COMMENT ON COLUMN "prospect_document_types"."required" IS 'Zorunlu mu; zorunlu türde güncel kabul edilebilir belge yoksa aday eksik belge listesine girer.';--> statement-breakpoint
COMMENT ON COLUMN "prospect_document_types"."stage" IS 'Belgenin istendiği aşama: application (ön başvuru; aday açıkken), enrollment (kesin kayıt; Teklif verildi aşamasından ve kesin kayıttan sonra). Eksik belge kesin kaydı engellemez (K-321).';--> statement-breakpoint
COMMENT ON COLUMN "prospect_document_types"."special_category" IS 'Özel nitelikli kişisel veri işareti (KVKK md. 6). Sağlık raporunda her zaman açık (prospect_document_types_special_check). Açıkken belge yalnız açık rıza kaydıyla yüklenir, yalnız yönetici açar ve her açılış denetime yazılır (K-322).';--> statement-breakpoint
COMMENT ON COLUMN "prospect_document_types"."position" IS 'Listedeki sıra (seyrek tamsayı); yeni tür sona eklenir.';--> statement-breakpoint
COMMENT ON COLUMN "prospect_document_types"."created_at" IS 'Kaydın oluşturulma anı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "prospect_document_types"."updated_at" IS 'Son değişiklik anı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "prospect_document_types"."archived_at" IS 'Arşivlenme anı; doluysa tür listede ve eksik belge hesabında yoktur, yeni belge alınmaz, var olan belgeler adıyla görünür.';--> statement-breakpoint
COMMENT ON COLUMN "prospect_document_types"."version" IS 'İyimser kilit sürümü; If-Match ile karşılaştırılır.';--> statement-breakpoint
COMMENT ON TABLE "prospect_documents" IS 'Adaya eklenen belge (DOM-KAY-043, ON-263): platform dosyasına (files, amaç document) bağ ve inceleme durumu. Aday records''tadır (yabancı anahtar yok). Türde tek güncel belge; aynı türe yeni yükleme öncekini superseded yapar ve eski dosyanın imhası 30 gün sonraya işaretlenir (K-323). Dosya içeriği bu tabloda değildir.';--> statement-breakpoint
COMMENT ON COLUMN "prospect_documents"."institution_id" IS 'Kurum; bütün sorgular bu kolonla kapsanır.';--> statement-breakpoint
COMMENT ON COLUMN "prospect_documents"."id" IS 'Belge kimliği; dosyanın files.attached_id değeri (attached_type prospect_document).';--> statement-breakpoint
COMMENT ON COLUMN "prospect_documents"."prospect_id" IS 'Belgenin adayı (records, collection prospects, id). Kişisel veri sınıfı K.';--> statement-breakpoint
COMMENT ON COLUMN "prospect_documents"."document_type_id" IS 'Belge türü (prospect_document_types.id, aynı kurum).';--> statement-breakpoint
COMMENT ON COLUMN "prospect_documents"."file_id" IS 'Yüklenen dosya (files.id, aynı kurum); bir dosya tek belgeye bağlanır. Özel nitelikli belgede dosya içeriği sınıf Ö''dür; dosya imha edilince satır kalır, belge eksik sayılır.';--> statement-breakpoint
COMMENT ON COLUMN "prospect_documents"."status" IS 'Durum: uploaded (inceleme bekliyor), accepted (kabul), rejected (gerekçeli ret), superseded (yerine yenisi yüklendi).';--> statement-breakpoint
COMMENT ON COLUMN "prospect_documents"."special_category" IS 'Yükleme anında türün özel nitelikli işareti; tür sonradan değişse de bu belgenin erişim kuralı (yalnız yönetici, denetimli açılış) değişmez.';--> statement-breakpoint
COMMENT ON COLUMN "prospect_documents"."rejection_reason" IS 'Ret gerekçesi (2–300 karakter); yalnız rejected (ve sonradan superseded) belgede dolu. Serbest metin, sınıf K; loglanmaz, denetim kaydına yalnız alan adı yazılır.';--> statement-breakpoint
COMMENT ON COLUMN "prospect_documents"."uploaded_by_user_id" IS 'Belgeyi ekleyen kullanıcı (Better Auth users.id).';--> statement-breakpoint
COMMENT ON COLUMN "prospect_documents"."reviewed_by_user_id" IS 'Kabul ya da ret kararını veren kullanıcı; karar yoksa boş.';--> statement-breakpoint
COMMENT ON COLUMN "prospect_documents"."reviewed_at" IS 'Karar anı (UTC); karar yoksa boş.';--> statement-breakpoint
COMMENT ON COLUMN "prospect_documents"."superseded_at" IS 'Yerine yenisi yüklendiği an; yalnız superseded durumunda dolu (prospect_documents_superseded_check).';--> statement-breakpoint
COMMENT ON COLUMN "prospect_documents"."superseded_by_id" IS 'Yerine geçen belgenin kimliği (aynı tablo).';--> statement-breakpoint
COMMENT ON COLUMN "prospect_documents"."created_at" IS 'Belgenin eklendiği an (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "prospect_documents"."updated_at" IS 'Son değişiklik anı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "prospect_documents"."archived_at" IS 'Arşivlenme anı: özel nitelikli belgenin rızası geri çekilince belge arşivlenir ve dosyası hemen imhaya işaretlenir (K-322).';--> statement-breakpoint
COMMENT ON COLUMN "prospect_documents"."version" IS 'İyimser kilit sürümü; inceleme If-Match ile karşılaştırılır.';--> statement-breakpoint
COMMENT ON TABLE "prospect_document_consents" IS 'Özel nitelikli aday belgesi (sağlık raporu) için açık rıza kaydı (DOM-KAY-043, K-322; rıza deseni DOM-YTK-058, DOM-YTK-059). Ön büro velinin ya da yetişkin adayın ıslak imzalı formunu aldığını işaretler; metin saklanmaz. Aday başına tek etkin rıza; geri çekme aynı satıra yazılır ve özel nitelikli belgeleri arşivleyip dosyalarını imhaya işaretler. Personelce kaydın geçerliliği doğrulanmalı (H-50).';--> statement-breakpoint
COMMENT ON COLUMN "prospect_document_consents"."institution_id" IS 'Kurum; bütün sorgular bu kolonla kapsanır.';--> statement-breakpoint
COMMENT ON COLUMN "prospect_document_consents"."id" IS 'Rıza kaydının kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "prospect_document_consents"."prospect_id" IS 'Rızanın ait olduğu aday (records, collection prospects, id). Kişisel veri sınıfı K.';--> statement-breakpoint
COMMENT ON COLUMN "prospect_document_consents"."grantor" IS 'Rızayı veren: guardian (18 yaş altı ve okul adayında veli), self (yetişkin kursiyer adayının kendisi); kayıt anında adaydan türetilir.';--> statement-breakpoint
COMMENT ON COLUMN "prospect_document_consents"."method" IS 'Rızanın alındığı yol: wet_signature (ıslak imzalı açık rıza formu; form kurumda saklanır).';--> statement-breakpoint
COMMENT ON COLUMN "prospect_document_consents"."granted_at" IS 'Rızanın kaydedildiği an (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "prospect_document_consents"."granted_by_user_id" IS 'Rızayı kaydeden personel (Better Auth users.id).';--> statement-breakpoint
COMMENT ON COLUMN "prospect_document_consents"."withdrawn_at" IS 'Geri çekme anı; doluysa rıza geçersizdir ve yeni özel nitelikli belge yüklenmez.';--> statement-breakpoint
COMMENT ON COLUMN "prospect_document_consents"."withdrawn_by_user_id" IS 'Geri çekmeyi kaydeden personel; withdrawn_at ile birlikte dolu.';--> statement-breakpoint
COMMENT ON COLUMN "prospect_document_consents"."created_at" IS 'Kaydın oluşturulma anı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "prospect_document_consents"."updated_at" IS 'Son değişiklik anı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "prospect_document_consents"."archived_at" IS 'Arşivlenme anı; kullanılmıyor, satırlar ispat için silinmez ve arşivlenmez (DOM-YTK-059).';--> statement-breakpoint
COMMENT ON COLUMN "prospect_document_consents"."version" IS 'İyimser kilit sürümü; geri çekme If-Match ile karşılaştırılır.';
