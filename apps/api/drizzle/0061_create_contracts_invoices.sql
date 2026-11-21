CREATE TABLE "contract_invoices" (
	"institution_id" text NOT NULL,
	"contract_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "contract_invoices_pkey" PRIMARY KEY("institution_id","contract_id","invoice_id")
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"institution_id" text NOT NULL,
	"id" text NOT NULL,
	"student_id" text NOT NULL,
	"root_contract_id" text NOT NULL,
	"amends_contract_id" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"academic_year" integer,
	"class_id" text,
	"title" text NOT NULL,
	"contract_at" timestamp with time zone NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" text DEFAULT 'TRY' NOT NULL,
	"tariff_id" uuid,
	"tariff_version" integer,
	"gross_cents" bigint,
	"net_cents" bigint,
	"discounts" jsonb,
	"extras" jsonb,
	"terms_approved_by_user_id" text,
	"payer" text,
	"scholarship_program_id" uuid,
	"scholarship_cents" bigint,
	"signatory_name" text,
	"signatory_role" text,
	"signatory_recorded_at" timestamp with time zone,
	"signatory_recorded_by_user_id" text,
	"approval_method" text,
	"approved_at" timestamp with time zone,
	"approved_by_user_id" text,
	"approval_payer_name" text,
	"approval_plan" jsonb,
	"amendment_reason" text,
	"proposed_plan" jsonb,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_user_id" text,
	"cancel_reason" text,
	"has_invoice_list" boolean DEFAULT true NOT NULL,
	"position" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "contracts_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "contracts_id_root_key" UNIQUE("institution_id","id","root_contract_id"),
	CONSTRAINT "contracts_currency_check" CHECK ("contracts"."currency" = 'TRY'),
	CONSTRAINT "contracts_amounts_check" CHECK ("contracts"."amount_cents" >= 0 and ("contracts"."gross_cents" is null or "contracts"."gross_cents" >= 0) and ("contracts"."net_cents" is null or "contracts"."net_cents" >= 0) and ("contracts"."scholarship_cents" is null or "contracts"."scholarship_cents" >= 0)),
	CONSTRAINT "contracts_payer_check" CHECK ("contracts"."payer" in ('guardian', 'student')),
	CONSTRAINT "contracts_signatory_role_check" CHECK ("contracts"."signatory_role" in ('founder', 'founder_representative')),
	CONSTRAINT "contracts_approval_method_check" CHECK ("contracts"."approval_method" in ('wet_signature', 'electronic')),
	CONSTRAINT "contracts_revision_check" CHECK ("contracts"."revision" >= 1 and ("contracts"."amends_contract_id" is null) = ("contracts"."revision" = 1) and ("contracts"."amends_contract_id" is null) = ("contracts"."root_contract_id" = "contracts"."id")),
	CONSTRAINT "contracts_terms_check" CHECK (("contracts"."tariff_id" is not null and "contracts"."tariff_version" is not null and "contracts"."gross_cents" is not null and "contracts"."net_cents" is not null and "contracts"."discounts" is not null and "contracts"."extras" is not null and "contracts"."terms_approved_by_user_id" is not null and "contracts"."payer" is not null) or ("contracts"."tariff_id" is null and "contracts"."tariff_version" is null and "contracts"."gross_cents" is null and "contracts"."net_cents" is null and "contracts"."discounts" is null and "contracts"."extras" is null and "contracts"."terms_approved_by_user_id" is null and "contracts"."payer" is null)),
	CONSTRAINT "contracts_scholarship_check" CHECK (("contracts"."scholarship_program_id" is null) = ("contracts"."scholarship_cents" is null) and ("contracts"."scholarship_program_id" is null or "contracts"."tariff_id" is not null)),
	CONSTRAINT "contracts_signatory_check" CHECK (("contracts"."signatory_name" is not null and "contracts"."signatory_role" is not null and "contracts"."signatory_recorded_at" is not null and "contracts"."signatory_recorded_by_user_id" is not null) or ("contracts"."signatory_name" is null and "contracts"."signatory_role" is null and "contracts"."signatory_recorded_at" is null and "contracts"."signatory_recorded_by_user_id" is null)),
	CONSTRAINT "contracts_approval_check" CHECK (("contracts"."approval_method" is not null and "contracts"."approved_at" is not null and "contracts"."approved_by_user_id" is not null and "contracts"."approval_payer_name" is not null and "contracts"."approval_plan" is not null) or ("contracts"."approval_method" is null and "contracts"."approved_at" is null and "contracts"."approved_by_user_id" is null and "contracts"."approval_payer_name" is null and "contracts"."approval_plan" is null)),
	CONSTRAINT "contracts_cancel_check" CHECK ((("contracts"."cancelled_at" is not null and "contracts"."cancelled_by_user_id" is not null and "contracts"."cancel_reason" is not null) or ("contracts"."cancelled_at" is null and "contracts"."cancelled_by_user_id" is null and "contracts"."cancel_reason" is null)) and ("contracts"."cancelled_at" is null or "contracts"."amends_contract_id" is not null)),
	CONSTRAINT "contracts_approval_requires_signatory_check" CHECK ("contracts"."approved_at" is null or "contracts"."signatory_recorded_at" is not null),
	CONSTRAINT "contracts_approved_or_cancelled_check" CHECK ("contracts"."approved_at" is null or "contracts"."cancelled_at" is null),
	CONSTRAINT "contracts_proposed_plan_check" CHECK ("contracts"."proposed_plan" is null or ("contracts"."amends_contract_id" is not null and "contracts"."approved_at" is null))
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"institution_id" text NOT NULL,
	"id" text NOT NULL,
	"student_id" text NOT NULL,
	"contract_id" text,
	"root_contract_id" text,
	"academic_year" integer,
	"installment" integer NOT NULL,
	"fee_kind" text,
	"amount_cents" bigint NOT NULL,
	"currency" text DEFAULT 'TRY' NOT NULL,
	"due_date" date NOT NULL,
	"paid_at" timestamp with time zone,
	"payment_method" text,
	"reminder_at" timestamp with time zone,
	"core_created_at" timestamp with time zone,
	"core_updated_at" timestamp with time zone,
	"position" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "invoices_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "invoices_amount_cents_check" CHECK ("invoices"."amount_cents" > 0),
	CONSTRAINT "invoices_installment_check" CHECK ("invoices"."installment" > 0),
	CONSTRAINT "invoices_currency_check" CHECK ("invoices"."currency" = 'TRY'),
	CONSTRAINT "invoices_payment_method_check" CHECK ("invoices"."payment_method" in ('bank_transfer', 'cash', 'card', 'promissory_note')),
	CONSTRAINT "invoices_paid_check" CHECK (("invoices"."paid_at" is null) = ("invoices"."payment_method" is null)),
	CONSTRAINT "invoices_contract_root_check" CHECK (("invoices"."contract_id" is null) = ("invoices"."root_contract_id" is null))
);
--> statement-breakpoint
ALTER TABLE "contract_invoices" ADD CONSTRAINT "contract_invoices_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_invoices" ADD CONSTRAINT "contract_invoices_contract_fkey" FOREIGN KEY ("institution_id","contract_id") REFERENCES "public"."contracts"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_invoices" ADD CONSTRAINT "contract_invoices_invoice_fkey" FOREIGN KEY ("institution_id","invoice_id") REFERENCES "public"."invoices"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_amends_contract_fkey" FOREIGN KEY ("institution_id","amends_contract_id","root_contract_id") REFERENCES "public"."contracts"("institution_id","id","root_contract_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_root_contract_fkey" FOREIGN KEY ("institution_id","root_contract_id") REFERENCES "public"."contracts"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_tariff_fkey" FOREIGN KEY ("institution_id","tariff_id") REFERENCES "public"."fee_tariffs"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_scholarship_program_fkey" FOREIGN KEY ("institution_id","scholarship_program_id") REFERENCES "public"."scholarship_programs"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_contract_fkey" FOREIGN KEY ("institution_id","contract_id","root_contract_id") REFERENCES "public"."contracts"("institution_id","id","root_contract_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contract_invoices_invoice_idx" ON "contract_invoices" USING btree ("institution_id","invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contracts_amendment_open_key" ON "contracts" USING btree ("institution_id","amends_contract_id") WHERE "contracts"."amends_contract_id" is not null and "contracts"."cancelled_at" is null and "contracts"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "contracts_student_idx" ON "contracts" USING btree ("institution_id","student_id");--> statement-breakpoint
CREATE INDEX "contracts_root_idx" ON "contracts" USING btree ("institution_id","root_contract_id");--> statement-breakpoint
CREATE INDEX "contracts_amends_contract_idx" ON "contracts" USING btree ("institution_id","amends_contract_id","root_contract_id") WHERE "contracts"."amends_contract_id" is not null;--> statement-breakpoint
CREATE INDEX "contracts_tariff_idx" ON "contracts" USING btree ("institution_id","tariff_id") WHERE "contracts"."tariff_id" is not null;--> statement-breakpoint
CREATE INDEX "contracts_scholarship_program_idx" ON "contracts" USING btree ("institution_id","scholarship_program_id") WHERE "contracts"."scholarship_program_id" is not null;--> statement-breakpoint
CREATE INDEX "contracts_position_idx" ON "contracts" USING btree ("institution_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_installment_key" ON "invoices" USING btree ("institution_id","root_contract_id","installment") WHERE "invoices"."archived_at" is null and "invoices"."root_contract_id" is not null;--> statement-breakpoint
CREATE INDEX "invoices_student_due_idx" ON "invoices" USING btree ("institution_id","student_id","due_date");--> statement-breakpoint
CREATE INDEX "invoices_contract_idx" ON "invoices" USING btree ("institution_id","contract_id","root_contract_id") WHERE "invoices"."contract_id" is not null;--> statement-breakpoint
CREATE INDEX "invoices_open_due_idx" ON "invoices" USING btree ("institution_id","due_date") WHERE "invoices"."archived_at" is null and "invoices"."paid_at" is null;--> statement-breakpoint
CREATE INDEX "invoices_position_idx" ON "invoices" USING btree ("institution_id","position");--> statement-breakpoint
-- Elle yazıldı (ADR 0010 karar 4, ON-046c): Drizzle şeması ve snapshot tetikleyici, fonksiyon ve
-- yorumu izlemez; drizzle-kit yeniden üretirse bu blok yeniden eklenir. Tablolar boş açılır;
-- kopyalama ve çift yazma ON-046e'dedir, 0056'nın `records` tetikleyicisi daralt adımına kadar kalır.
--
-- Onaylı ya da iptal edilmiş sözleşme sürümünde yalnız canlı bağlar değişir: `class_id` (sınıf
-- arşivi planlı yenilemenin sınıfını aktarır), `position` (core dizi sırası; yeniden numaralama),
-- `version` ve `updated_at` (taksit bağı `contract_invoices`'ta değişir, sürüme yalnız sürüm artışı
-- olarak yansır). Öteki kolonlar açıkça sayılır; değişen satır 0013'teki ortak fonksiyonla 55000 alır.
CREATE TRIGGER "contracts_settled_immutable_trigger" BEFORE UPDATE ON "contracts" FOR EACH ROW
WHEN (
  (OLD."approved_at" IS NOT NULL OR OLD."cancelled_at" IS NOT NULL)
  AND (
    OLD."institution_id", OLD."id", OLD."student_id", OLD."root_contract_id", OLD."amends_contract_id",
    OLD."revision", OLD."academic_year", OLD."title", OLD."contract_at", OLD."amount_cents",
    OLD."currency", OLD."tariff_id", OLD."tariff_version", OLD."gross_cents", OLD."net_cents",
    OLD."discounts", OLD."extras", OLD."terms_approved_by_user_id", OLD."payer",
    OLD."scholarship_program_id", OLD."scholarship_cents", OLD."signatory_name", OLD."signatory_role",
    OLD."signatory_recorded_at", OLD."signatory_recorded_by_user_id", OLD."approval_method",
    OLD."approved_at", OLD."approved_by_user_id", OLD."approval_payer_name", OLD."approval_plan",
    OLD."amendment_reason", OLD."proposed_plan", OLD."cancelled_at", OLD."cancelled_by_user_id",
    OLD."cancel_reason", OLD."has_invoice_list", OLD."created_at", OLD."archived_at"
  ) IS DISTINCT FROM (
    NEW."institution_id", NEW."id", NEW."student_id", NEW."root_contract_id", NEW."amends_contract_id",
    NEW."revision", NEW."academic_year", NEW."title", NEW."contract_at", NEW."amount_cents",
    NEW."currency", NEW."tariff_id", NEW."tariff_version", NEW."gross_cents", NEW."net_cents",
    NEW."discounts", NEW."extras", NEW."terms_approved_by_user_id", NEW."payer",
    NEW."scholarship_program_id", NEW."scholarship_cents", NEW."signatory_name", NEW."signatory_role",
    NEW."signatory_recorded_at", NEW."signatory_recorded_by_user_id", NEW."approval_method",
    NEW."approved_at", NEW."approved_by_user_id", NEW."approval_payer_name", NEW."approval_plan",
    NEW."amendment_reason", NEW."proposed_plan", NEW."cancelled_at", NEW."cancelled_by_user_id",
    NEW."cancel_reason", NEW."has_invoice_list", NEW."created_at", NEW."archived_at"
  )
)
EXECUTE FUNCTION "kampus_reject_immutable_change"();
--> statement-breakpoint
-- Taksitin koşulları yalnız onaylı bir sözleşme sürümüne bağlıysa donar (ADR 0010 cevap 6,
-- DOM-FIN-010): onaylanmamış sürümün taksiti onaydan önce düzeltilebilir. Bağ ya taksiti açan sürüm
-- (`contract_id`) ya da onu `invoiceIds`'inde taşıyan sürümdür (`contract_invoices`, arşivli bağ
-- dahil). Koşul başka tabloya baktığı için `WHEN` yerine fonksiyondadır; hata ortak fonksiyonla
-- aynı koddur (55000). İmha istisnası yalnız `delete` içindir, bu tetikleyici `update`'tedir.
CREATE FUNCTION "kampus_reject_settled_invoice_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "contracts" c
    WHERE c."institution_id" = OLD."institution_id"
      AND c."approved_at" IS NOT NULL
      AND (
        c."id" = OLD."contract_id"
        OR EXISTS (
          SELECT 1 FROM "contract_invoices" ci
          WHERE ci."institution_id" = OLD."institution_id"
            AND ci."contract_id" = c."id"
            AND ci."invoice_id" = OLD."id"
        )
      )
  ) THEN
    RAISE EXCEPTION 'kampus: % rows of an approved contract are immutable (%)', TG_TABLE_NAME, TG_OP
      USING ERRCODE = '55000', TABLE = TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "invoices_terms_immutable_trigger" BEFORE UPDATE ON "invoices" FOR EACH ROW
WHEN (
  (
    OLD."institution_id", OLD."id", OLD."student_id", OLD."contract_id", OLD."root_contract_id",
    OLD."academic_year", OLD."installment", OLD."fee_kind", OLD."amount_cents", OLD."currency",
    OLD."due_date"
  ) IS DISTINCT FROM (
    NEW."institution_id", NEW."id", NEW."student_id", NEW."contract_id", NEW."root_contract_id",
    NEW."academic_year", NEW."installment", NEW."fee_kind", NEW."amount_cents", NEW."currency",
    NEW."due_date"
  )
)
EXECUTE FUNCTION "kampus_reject_settled_invoice_change"();
--> statement-breakpoint
-- Silme ve boşaltma üç tabloda da yalnız imha istisnasıyla (`kampus.allow_immutable_purge`, yalnız
-- satır `delete`'i) geçer; kullanıcı işlemiyle silme arşivdir (veritabani.md §7).
CREATE TRIGGER "contracts_purge_only_trigger" BEFORE DELETE ON "contracts" FOR EACH ROW EXECUTE FUNCTION "kampus_reject_immutable_change"();--> statement-breakpoint
CREATE TRIGGER "contracts_truncate_trigger" BEFORE TRUNCATE ON "contracts" FOR EACH STATEMENT EXECUTE FUNCTION "kampus_reject_immutable_change"();--> statement-breakpoint
CREATE TRIGGER "invoices_purge_only_trigger" BEFORE DELETE ON "invoices" FOR EACH ROW EXECUTE FUNCTION "kampus_reject_immutable_change"();--> statement-breakpoint
CREATE TRIGGER "invoices_truncate_trigger" BEFORE TRUNCATE ON "invoices" FOR EACH STATEMENT EXECUTE FUNCTION "kampus_reject_immutable_change"();--> statement-breakpoint
CREATE TRIGGER "contract_invoices_purge_only_trigger" BEFORE DELETE ON "contract_invoices" FOR EACH ROW EXECUTE FUNCTION "kampus_reject_immutable_change"();--> statement-breakpoint
CREATE TRIGGER "contract_invoices_truncate_trigger" BEFORE TRUNCATE ON "contract_invoices" FOR EACH STATEMENT EXECUTE FUNCTION "kampus_reject_immutable_change"();--> statement-breakpoint
COMMENT ON FUNCTION "kampus_reject_settled_invoice_change"() IS 'Onaylı sözleşme sürümüne bağlı taksitin koşul kolonlarının değişmesini 55000 ile reddeder (ADR 0010 cevap 6, DOM-FIN-010).';--> statement-breakpoint
COMMENT ON TRIGGER "contracts_settled_immutable_trigger" ON "contracts" IS 'Onaylı ya da iptal edilmiş sürümde class_id, position, version ve updated_at dışındaki kolonların değişmesini reddeder (ADR 0010 karar 4; IST-092, DOM-FIN-010).';--> statement-breakpoint
COMMENT ON TRIGGER "invoices_terms_immutable_trigger" ON "invoices" IS 'Taksitin öğrenci, sözleşme, yıl, numara, kalem, tutar ve vade kolonları değişince onaylı sürüme bağlılığı denetler (ADR 0010 karar 4, cevap 6).';--> statement-breakpoint
COMMENT ON TRIGGER "contracts_purge_only_trigger" ON "contracts" IS 'Satır silmeyi yalnız imha istisnasıyla geçirir (kampus.allow_immutable_purge).';--> statement-breakpoint
COMMENT ON TRIGGER "contracts_truncate_trigger" ON "contracts" IS 'Tabloyu boşaltmayı reddeder.';--> statement-breakpoint
COMMENT ON TRIGGER "invoices_purge_only_trigger" ON "invoices" IS 'Satır silmeyi yalnız imha istisnasıyla geçirir (kampus.allow_immutable_purge).';--> statement-breakpoint
COMMENT ON TRIGGER "invoices_truncate_trigger" ON "invoices" IS 'Tabloyu boşaltmayı reddeder.';--> statement-breakpoint
COMMENT ON TRIGGER "contract_invoices_purge_only_trigger" ON "contract_invoices" IS 'Satır silmeyi yalnız imha istisnasıyla geçirir (kampus.allow_immutable_purge); bağdan düşmek arşivdir.';--> statement-breakpoint
COMMENT ON TRIGGER "contract_invoices_truncate_trigger" ON "contract_invoices" IS 'Tabloyu boşaltmayı reddeder.';--> statement-breakpoint
COMMENT ON TABLE "contracts" IS 'Sözleşme sürümü (ADR 0010; DOM-FIN-010, -012, -051). Her satır bir sürümdür; ek protokol yeni satırdır. Kimlik records kimliğidir. Onaylı ya da iptal edilmiş sürümün koşulları değişmez. Taksit bağı contract_invoices tablosundadır.';--> statement-breakpoint
COMMENT ON COLUMN "contracts"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "contracts"."id" IS 'Sözleşme sürümü kimliği; records kimliği korunur (contract-…), uuid değildir (ADR 0010 karar 2).';--> statement-breakpoint
COMMENT ON COLUMN "contracts"."student_id" IS 'Öğrencinin records kimliği; yabancı anahtar değildir (öğrenci records tablosundadır).';--> statement-breakpoint
COMMENT ON COLUMN "contracts"."root_contract_id" IS 'Zincirin ilk sürümü; ilk sürümde kendisi. Değişmez kopyadır; ek protokol ve taksit bağı bu kopyayı da denetler.';--> statement-breakpoint
COMMENT ON COLUMN "contracts"."amends_contract_id" IS 'Ek protokolün değiştirdiği önceki sürüm; ilk sürümde boş.';--> statement-breakpoint
COMMENT ON COLUMN "contracts"."revision" IS 'Zincirdeki sıra; ilk sürüm 1 (core kaydında alan yoktur), ek protokol 2 ve sonrası.';--> statement-breakpoint
COMMENT ON COLUMN "contracts"."academic_year" IS 'Eğitim yılının başlangıç yılı; eski kayıtlarda boş.';--> statement-breakpoint
COMMENT ON COLUMN "contracts"."class_id" IS 'Sözleşmenin sınıfının records kimliği; canlı bağdır, sınıf arşivi aktarır ve onaylı sürümde de değişebilir.';--> statement-breakpoint
COMMENT ON COLUMN "contracts"."title" IS 'Sözleşme başlığı.';--> statement-breakpoint
COMMENT ON COLUMN "contracts"."contract_at" IS 'Sözleşme anı (core date).';--> statement-breakpoint
COMMENT ON COLUMN "contracts"."amount_cents" IS 'Sözleşme tutarı, kuruş (core amount); ek protokolde korunan ve eklenen taksitlerin toplamı.';--> statement-breakpoint
COMMENT ON COLUMN "contracts"."currency" IS 'Para birimi; yalnız TRY.';--> statement-breakpoint
COMMENT ON COLUMN "contracts"."tariff_id" IS 'Karar anındaki ücret tarifesi (DOM-FIN-010); tarifesiz eski kayıtta boş. Tarife grubu ya hep dolu ya hep boştur.';--> statement-breakpoint
COMMENT ON COLUMN "contracts"."tariff_version" IS 'Karar anındaki tarife sürümü.';--> statement-breakpoint
COMMENT ON COLUMN "contracts"."gross_cents" IS 'Brüt öğrenim ücreti, kuruş (karar anı kopyası).';--> statement-breakpoint
COMMENT ON COLUMN "contracts"."net_cents" IS 'İndirim ve burstan sonraki net öğrenim ücreti, kuruş (karar anı kopyası).';--> statement-breakpoint
COMMENT ON COLUMN "contracts"."discounts" IS 'Uygulanan indirimler (tür, kuruş) dizisi; karar anı kopyası, core şemasıyla doğrulanır.';--> statement-breakpoint
COMMENT ON COLUMN "contracts"."extras" IS 'Ek hizmetler (tür, kuruş) dizisi; karar anı kopyası. Her ek hizmet ayrı taksittir (DOM-FIN-003).';--> statement-breakpoint
COMMENT ON COLUMN "contracts"."terms_approved_by_user_id" IS 'Tarifeli koşulları onaylayan kullanıcı (core ContractTerms.approvedByUserId).';--> statement-breakpoint
COMMENT ON COLUMN "contracts"."payer" IS 'Ödeyici: guardian (veli) ya da student (yetişkin kursiyer).';--> statement-breakpoint
COMMENT ON COLUMN "contracts"."scholarship_program_id" IS 'Kayıtta atanan burs programı (DOM-FIN-025); yalnız tarifeli sözleşmede.';--> statement-breakpoint
COMMENT ON COLUMN "contracts"."scholarship_cents" IS 'Burs tutarı, kuruş; program ile birlikte dolu ya da boş.';--> statement-breakpoint
COMMENT ON COLUMN "contracts"."signatory_name" IS 'İmza yetkilisinin adı (kurucu ya da temsilcisi, ÖÖKY m.31/4).';--> statement-breakpoint
COMMENT ON COLUMN "contracts"."signatory_role" IS 'İmza yetkilisinin sıfatı: founder ya da founder_representative.';--> statement-breakpoint
COMMENT ON COLUMN "contracts"."signatory_recorded_at" IS 'İmza yetkilisinin işlendiği an; onaydan önce zorunludur.';--> statement-breakpoint
COMMENT ON COLUMN "contracts"."signatory_recorded_by_user_id" IS 'İmza yetkilisini işleyen kullanıcı.';--> statement-breakpoint
COMMENT ON COLUMN "contracts"."approval_method" IS 'Ödeyici onayının biçimi: wet_signature (görevlinin işlediği ıslak imza) ya da electronic (velinin kendi onayı).';--> statement-breakpoint
COMMENT ON COLUMN "contracts"."approved_at" IS 'Ödeyici onayı anı; doluysa sürümün koşulları ve taksitleri değişmez.';--> statement-breakpoint
COMMENT ON COLUMN "contracts"."approved_by_user_id" IS 'Onayı veren ya da işleyen kullanıcı.';--> statement-breakpoint
COMMENT ON COLUMN "contracts"."approval_payer_name" IS 'Onay anındaki ödeyici adı (belge kopyası).';--> statement-breakpoint
COMMENT ON COLUMN "contracts"."approval_plan" IS 'Onay anındaki ödeme planı satırları (DOM-FIN-051); belge bu kopyayı gösterir.';--> statement-breakpoint
COMMENT ON COLUMN "contracts"."amendment_reason" IS 'Ek protokol gerekçesi.';--> statement-breakpoint
COMMENT ON COLUMN "contracts"."proposed_plan" IS 'Ek protokolün önerdiği plan (korunan, yerine gelen, eklenen); onayda boşalır, iptalde kalır.';--> statement-breakpoint
COMMENT ON COLUMN "contracts"."cancelled_at" IS 'Onaysız ek protokolün iptal anı; kayıt sözleşmesi iptal edilmez (ayrılışla kapanır).';--> statement-breakpoint
COMMENT ON COLUMN "contracts"."cancelled_by_user_id" IS 'İptal eden kullanıcı.';--> statement-breakpoint
COMMENT ON COLUMN "contracts"."cancel_reason" IS 'İptal gerekçesi.';--> statement-breakpoint
COMMENT ON COLUMN "contracts"."has_invoice_list" IS 'Core kaydında invoiceIds alanı var mı; false yalnız eski kayıtta (belge ve ayrılış öğrencinin bütün taksitlerine düşer). Boş liste true ve bağ satırı olmadan ifade edilir.';--> statement-breakpoint
COMMENT ON COLUMN "contracts"."position" IS 'Core dizisindeki sıra (records.position gibi seyrek tamsayı; ADR 0010 cevap 5).';--> statement-breakpoint
COMMENT ON COLUMN "contracts"."created_at" IS 'Oluşturulma anı.';--> statement-breakpoint
COMMENT ON COLUMN "contracts"."updated_at" IS 'Son değişiklik anı.';--> statement-breakpoint
COMMENT ON COLUMN "contracts"."archived_at" IS 'Arşivlenme anı; boşsa etkindir.';--> statement-breakpoint
COMMENT ON COLUMN "contracts"."version" IS 'İyimser kilit sürümü (If-Match); records sürümünden devam eder. Taksit bağı değişince de artar.';--> statement-breakpoint
COMMENT ON TABLE "invoices" IS 'Taksit (ADR 0010; DOM-FIN-011, -012, -030). Kimlik records kimliğidir. Ödeme durumu önbelleği paid_at/payment_method; tahsilatın kaynağı payment_allocations. Onaylı sürüme bağlı taksitin koşulları değişmez.';--> statement-breakpoint
COMMENT ON COLUMN "invoices"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "invoices"."id" IS 'Taksit kimliği; records kimliği korunur (inv-…), uuid değildir (ADR 0010 karar 2).';--> statement-breakpoint
COMMENT ON COLUMN "invoices"."student_id" IS 'Borçlu öğrencinin records kimliği; yabancı anahtar değildir.';--> statement-breakpoint
COMMENT ON COLUMN "invoices"."contract_id" IS 'Taksiti açan sözleşme sürümü; eski kayıtlarda boş olabilir (ADR 0010 açık soru 3).';--> statement-breakpoint
COMMENT ON COLUMN "invoices"."root_contract_id" IS 'contract_id sürümünün zincir kökü (kopya; yabancı anahtar sürümün köküyle aynı olmasını denetler). Taksit numarası tekilliği zincir içindedir.';--> statement-breakpoint
COMMENT ON COLUMN "invoices"."academic_year" IS 'Eğitim yılının başlangıç yılı; eski kayıtlarda boş.';--> statement-breakpoint
COMMENT ON COLUMN "invoices"."installment" IS 'Taksit numarası (1''den); zincirde arşivlenmemiş taksitler arasında tekil. Ek hizmetler öğrenimin ardından, ek protokol ve ayrılış borcu en büyük korunan numaradan devam eder.';--> statement-breakpoint
COMMENT ON COLUMN "invoices"."fee_kind" IS 'Kalem: tuition (öğrenim) ya da ek hizmet türü anahtarı; core kaydında alan yoksa boş (eski kayıt, öğrenim sayılır).';--> statement-breakpoint
COMMENT ON COLUMN "invoices"."amount_cents" IS 'Taksit tutarı, kuruş; sıfırdan büyük.';--> statement-breakpoint
COMMENT ON COLUMN "invoices"."currency" IS 'Para birimi; yalnız TRY.';--> statement-breakpoint
COMMENT ON COLUMN "invoices"."due_date" IS 'Vade günü (Europe/Istanbul); core dueDate bu günün 09:00Z anıdır.';--> statement-breakpoint
COMMENT ON COLUMN "invoices"."paid_at" IS 'Taksitin tamamen ödendiği an; geçiş önbelleği (ADR 0006 karar 3, ADR 0010 karar 5). Yöntemle birlikte dolu ya da boş.';--> statement-breakpoint
COMMENT ON COLUMN "invoices"."payment_method" IS 'Son ödemenin yöntem anahtarı (bank_transfer, cash, card, promissory_note); core etiketinin karşılığı.';--> statement-breakpoint
COMMENT ON COLUMN "invoices"."reminder_at" IS 'Son vade hatırlatmasının anı.';--> statement-breakpoint
COMMENT ON COLUMN "invoices"."core_created_at" IS 'Core kaydının kendi createdAt alanı (records.data''daki gibi); eski kayıtlarda boş. Sistem zamanı created_at''tır.';--> statement-breakpoint
COMMENT ON COLUMN "invoices"."core_updated_at" IS 'Core kaydının kendi updatedAt alanı; eski kayıtlarda boş. Sistem zamanı updated_at''tır.';--> statement-breakpoint
COMMENT ON COLUMN "invoices"."position" IS 'Core dizisindeki sıra (records.position gibi seyrek tamsayı; ADR 0010 cevap 5).';--> statement-breakpoint
COMMENT ON COLUMN "invoices"."created_at" IS 'Oluşturulma anı.';--> statement-breakpoint
COMMENT ON COLUMN "invoices"."updated_at" IS 'Son değişiklik anı.';--> statement-breakpoint
COMMENT ON COLUMN "invoices"."archived_at" IS 'Arşivlenme anı (core listeden çıkardı: ek protokolde yerine gelen, ayrılışta kapanan taksit); boşsa etkindir.';--> statement-breakpoint
COMMENT ON COLUMN "invoices"."version" IS 'İyimser kilit sürümü (If-Match); records sürümünden devam eder.';--> statement-breakpoint
COMMENT ON TABLE "contract_invoices" IS 'Sözleşme sürümü ile taksit bağı: core invoiceIds (ADR 0010 karar 1; DOM-FIN-012). Ek protokolde korunan taksit iki sürüme bağlıdır. Diziden düşen bağ arşivlenir, silinmez.';--> statement-breakpoint
COMMENT ON COLUMN "contract_invoices"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "contract_invoices"."contract_id" IS 'Sözleşme sürümü.';--> statement-breakpoint
COMMENT ON COLUMN "contract_invoices"."invoice_id" IS 'Taksit.';--> statement-breakpoint
COMMENT ON COLUMN "contract_invoices"."position" IS 'invoiceIds dizisindeki sıra (0''dan).';--> statement-breakpoint
COMMENT ON COLUMN "contract_invoices"."created_at" IS 'Oluşturulma anı.';--> statement-breakpoint
COMMENT ON COLUMN "contract_invoices"."updated_at" IS 'Son değişiklik anı.';--> statement-breakpoint
COMMENT ON COLUMN "contract_invoices"."archived_at" IS 'Taksitin diziden düştüğü an (ayrılış); boşsa bağ canlıdır.';--> statement-breakpoint
COMMENT ON COLUMN "contract_invoices"."version" IS 'İyimser kilit sürümü.';
