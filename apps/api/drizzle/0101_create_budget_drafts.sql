CREATE TABLE "budget_center_owners" (
	"institution_id" text NOT NULL,
	"cost_center_id" uuid NOT NULL,
	"membership_id" text,
	"assigned_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "budget_center_owners_pkey" PRIMARY KEY("institution_id","cost_center_id")
);
--> statement-breakpoint
CREATE TABLE "budget_draft_events" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"draft_id" uuid NOT NULL,
	"event" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"revision" integer NOT NULL,
	"note" text,
	"lines" jsonb,
	"changes" jsonb,
	"actor_user_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "budget_draft_events_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "budget_draft_events_event_check" CHECK ("budget_draft_events"."event" in ('created', 'submitted', 'approved', 'revision_requested', 'rejected', 'reopened')),
	CONSTRAINT "budget_draft_events_status_check" CHECK ("budget_draft_events"."to_status" in ('draft', 'submitted', 'approved', 'revision_requested', 'rejected')
        and ("budget_draft_events"."from_status" is null or "budget_draft_events"."from_status" in ('draft', 'submitted', 'approved', 'revision_requested', 'rejected'))
        and (("budget_draft_events"."event" = 'created') = ("budget_draft_events"."from_status" is null))),
	CONSTRAINT "budget_draft_events_snapshot_check" CHECK (("budget_draft_events"."event" = 'submitted') = ("budget_draft_events"."lines" is not null)
        and ("budget_draft_events"."lines" is null) = ("budget_draft_events"."changes" is null)
        and ("budget_draft_events"."lines" is null or jsonb_typeof("budget_draft_events"."lines") = 'array')
        and ("budget_draft_events"."changes" is null or jsonb_typeof("budget_draft_events"."changes") = 'array')),
	CONSTRAINT "budget_draft_events_revision_check" CHECK ("budget_draft_events"."revision" >= 0),
	CONSTRAINT "budget_draft_events_note_check" CHECK ("budget_draft_events"."note" is null or char_length("budget_draft_events"."note") between 1 and 1000)
);
--> statement-breakpoint
CREATE TABLE "budget_draft_lines" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"draft_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" text DEFAULT 'TRY' NOT NULL,
	"justification" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "budget_draft_lines_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "budget_draft_lines_amount_check" CHECK ("budget_draft_lines"."amount_cents" between 0 and 1000000000000),
	CONSTRAINT "budget_draft_lines_position_check" CHECK ("budget_draft_lines"."position" between 0 and 199),
	CONSTRAINT "budget_draft_lines_currency_check" CHECK ("budget_draft_lines"."currency" = 'TRY'),
	CONSTRAINT "budget_draft_lines_justification_check" CHECK ("budget_draft_lines"."justification" is null or char_length("budget_draft_lines"."justification") between 1 and 1000)
);
--> statement-breakpoint
CREATE TABLE "budget_drafts" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"cost_center_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_by_user_id" text NOT NULL,
	"submitted_at" timestamp with time zone,
	"submitted_by_user_id" text,
	"approved_revision" integer,
	"approved_at" timestamp with time zone,
	"approved_by_user_id" text,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "budget_drafts_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "budget_drafts_status_check" CHECK ("budget_drafts"."status" in ('draft', 'submitted', 'approved', 'revision_requested', 'rejected')),
	CONSTRAINT "budget_drafts_revision_check" CHECK ("budget_drafts"."revision" >= 0 and ("budget_drafts"."status" = 'draft' or "budget_drafts"."revision" >= 1)
        and (("budget_drafts"."submitted_at" is null) = ("budget_drafts"."revision" = 0))
        and (("budget_drafts"."submitted_at" is null) = ("budget_drafts"."submitted_by_user_id" is null))),
	CONSTRAINT "budget_drafts_approval_check" CHECK ((("budget_drafts"."approved_revision" is null) = ("budget_drafts"."approved_at" is null))
        and (("budget_drafts"."approved_at" is null) = ("budget_drafts"."approved_by_user_id" is null))
        and ("budget_drafts"."approved_revision" is null or "budget_drafts"."approved_revision" between 1 and "budget_drafts"."revision")
        and ("budget_drafts"."status" <> 'approved' or "budget_drafts"."approved_revision" = "budget_drafts"."revision")),
	CONSTRAINT "budget_drafts_decision_note_check" CHECK (("budget_drafts"."decision_note" is null or char_length("budget_drafts"."decision_note") between 1 and 1000)
        and ("budget_drafts"."status" not in ('revision_requested', 'rejected') or "budget_drafts"."decision_note" is not null))
);
--> statement-breakpoint
ALTER TABLE "budget_center_owners" ADD CONSTRAINT "budget_center_owners_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_center_owners" ADD CONSTRAINT "budget_center_owners_cost_center_fkey" FOREIGN KEY ("institution_id","cost_center_id") REFERENCES "public"."cost_centers"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_center_owners" ADD CONSTRAINT "budget_center_owners_membership_fkey" FOREIGN KEY ("institution_id","membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_draft_events" ADD CONSTRAINT "budget_draft_events_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_draft_events" ADD CONSTRAINT "budget_draft_events_draft_fkey" FOREIGN KEY ("institution_id","draft_id") REFERENCES "public"."budget_drafts"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_draft_lines" ADD CONSTRAINT "budget_draft_lines_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_draft_lines" ADD CONSTRAINT "budget_draft_lines_draft_fkey" FOREIGN KEY ("institution_id","draft_id") REFERENCES "public"."budget_drafts"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_draft_lines" ADD CONSTRAINT "budget_draft_lines_item_fkey" FOREIGN KEY ("institution_id","item_id") REFERENCES "public"."budget_items"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_drafts" ADD CONSTRAINT "budget_drafts_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_drafts" ADD CONSTRAINT "budget_drafts_period_fkey" FOREIGN KEY ("institution_id","period_id") REFERENCES "public"."budget_periods"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_drafts" ADD CONSTRAINT "budget_drafts_cost_center_fkey" FOREIGN KEY ("institution_id","cost_center_id") REFERENCES "public"."cost_centers"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "budget_center_owners_membership_idx" ON "budget_center_owners" USING btree ("institution_id","membership_id");--> statement-breakpoint
CREATE INDEX "budget_draft_events_draft_idx" ON "budget_draft_events" USING btree ("institution_id","draft_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_draft_lines_item_key" ON "budget_draft_lines" USING btree ("institution_id","draft_id","item_id") WHERE "budget_draft_lines"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "budget_draft_lines_draft_idx" ON "budget_draft_lines" USING btree ("institution_id","draft_id");--> statement-breakpoint
CREATE INDEX "budget_draft_lines_item_idx" ON "budget_draft_lines" USING btree ("institution_id","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_drafts_period_cost_center_key" ON "budget_drafts" USING btree ("institution_id","period_id","cost_center_id") WHERE "budget_drafts"."status" <> 'rejected' and "budget_drafts"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "budget_drafts_period_idx" ON "budget_drafts" USING btree ("institution_id","period_id");--> statement-breakpoint
CREATE INDEX "budget_drafts_status_idx" ON "budget_drafts" USING btree ("institution_id","status");--> statement-breakpoint
CREATE INDEX "budget_drafts_cost_center_idx" ON "budget_drafts" USING btree ("institution_id","cost_center_id");--> statement-breakpoint
COMMENT ON TABLE "budget_center_owners" IS 'Maliyet merkezinin (birimin) bütçe sorumlusu (DOM-FIN-093, ON-243, K-257). Merkez başına tek satır; sorumlu kendi biriminin bütçe taslağını hazırlar ve onaya gönderir. Sorumlu yoksa taslağı yalnız yönetici hazırlar. Atamayı yönetici yapar.';--> statement-breakpoint
COMMENT ON COLUMN "budget_center_owners"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "budget_center_owners"."cost_center_id" IS 'Maliyet merkezi (cost_centers); merkez silinemez (restrict). Merkez başına tek satır (birincil anahtar).';--> statement-breakpoint
COMMENT ON COLUMN "budget_center_owners"."membership_id" IS 'Bütçe sorumlusunun kurum üyeliği (memberships; atama anında etkin yönetici, öğretmen ya da ön büro). Boş: sorumlu yok. Üyelik pasifleşirse sorumlu yetkisini kaybeder.';--> statement-breakpoint
COMMENT ON COLUMN "budget_center_owners"."assigned_by_user_id" IS 'Sorumluyu son atayan ya da kaldıran yönetici.';--> statement-breakpoint
COMMENT ON COLUMN "budget_center_owners"."created_at" IS 'Oluşturma zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "budget_center_owners"."updated_at" IS 'Son atama zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "budget_center_owners"."archived_at" IS 'Arşiv zamanı; satır arşivlenmez, sorumlu kaldırılınca membership_id boşalır.';--> statement-breakpoint
COMMENT ON COLUMN "budget_center_owners"."version" IS 'Sürüm; her atamada artar.';--> statement-breakpoint
COMMENT ON TABLE "budget_drafts" IS 'Bütçe taslağı (DOM-FIN-093, ON-243): bir bütçe dönemi × maliyet merkezi için birim sorumlusunun ya da yöneticinin hazırladığı bütçe teklifi. Durum draft → submitted → approved | revision_requested (→ yeniden submitted) | rejected; onay tek kademelidir (K-256). Onaylanan taslak budget_lines tablosuna aynı işlemde yazılır; onaylı taslak yeni revizyonla yeniden draft olur (K-258). Dönem × merkez için reddedilmemiş tek taslak olur.';--> statement-breakpoint
COMMENT ON COLUMN "budget_drafts"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "budget_drafts"."id" IS 'Taslak kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "budget_drafts"."period_id" IS 'Bütçe dönemi (budget_periods); kapalı dönemde taslak açılmaz, düzenlenmez ve onaylanmaz.';--> statement-breakpoint
COMMENT ON COLUMN "budget_drafts"."cost_center_id" IS 'Taslağın birimi: maliyet merkezi (cost_centers); açılışta etkin olmalıdır.';--> statement-breakpoint
COMMENT ON COLUMN "budget_drafts"."status" IS 'Durum: draft taslak, submitted onay bekliyor, approved onaylandı, revision_requested revizyon istendi, rejected reddedildi. Geçişler school-core budgetDraftTransition kuralıyla yapılır.';--> statement-breakpoint
COMMENT ON COLUMN "budget_drafts"."revision" IS 'Son gönderimin sürüm numarası; hiç gönderilmemiş taslakta 0. Her onaya gönderimde bir artar.';--> statement-breakpoint
COMMENT ON COLUMN "budget_drafts"."created_by_user_id" IS 'Taslağı açan kullanıcı (yönetici ya da birimin bütçe sorumlusu).';--> statement-breakpoint
COMMENT ON COLUMN "budget_drafts"."submitted_at" IS 'Son onaya gönderim zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "budget_drafts"."submitted_by_user_id" IS 'Son gönderen kullanıcı.';--> statement-breakpoint
COMMENT ON COLUMN "budget_drafts"."approved_revision" IS 'Son onaylanan sürüm; yeni revizyon açılınca da korunur, onaylı bütçenin hangi sürümden geldiğini gösterir.';--> statement-breakpoint
COMMENT ON COLUMN "budget_drafts"."approved_at" IS 'Son onay zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "budget_drafts"."approved_by_user_id" IS 'Son onaylayan yönetici.';--> statement-breakpoint
COMMENT ON COLUMN "budget_drafts"."decision_note" IS 'Son kararın notu: revizyon isteği ve retteki gerekçe (zorunlu, 5–1000 karakter) ya da onay notu. Ayrıntılı geçmiş budget_draft_events tablosundadır.';--> statement-breakpoint
COMMENT ON COLUMN "budget_drafts"."created_at" IS 'Oluşturma zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "budget_drafts"."updated_at" IS 'Son değişiklik zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "budget_drafts"."archived_at" IS 'Arşiv zamanı; taslak arşivlenmez, reddedilir.';--> statement-breakpoint
COMMENT ON COLUMN "budget_drafts"."version" IS 'İyimser kilit sürümü (If-Match); satır düzeltmesi ve her geçişte artar.';--> statement-breakpoint
COMMENT ON TABLE "budget_draft_lines" IS 'Bütçe taslağının satırları (DOM-FIN-093): kalem, planlanan tutar (kuruş) ve gerekçe. Satırlar bütün olarak yerine yazılır; çıkarılan satır arşivlenir. Bir kalem taslakta bir kez bulunur.';--> statement-breakpoint
COMMENT ON COLUMN "budget_draft_lines"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "budget_draft_lines"."id" IS 'Satır kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "budget_draft_lines"."draft_id" IS 'Bütçe taslağı (budget_drafts, restrict).';--> statement-breakpoint
COMMENT ON COLUMN "budget_draft_lines"."item_id" IS 'Bütçe kalemi (budget_items); yeni eklenen kalem etkin olmalıdır, taslakta kalan kalem sonradan pasifleşebilir.';--> statement-breakpoint
COMMENT ON COLUMN "budget_draft_lines"."position" IS 'Formdaki sıra (0''dan başlar, en çok 200 satır).';--> statement-breakpoint
COMMENT ON COLUMN "budget_draft_lines"."amount_cents" IS 'Planlanan tutar, kuruş (0 – 10 milyar TL); onayda bütçe satırının tutarı olur.';--> statement-breakpoint
COMMENT ON COLUMN "budget_draft_lines"."currency" IS 'Para birimi; yalnız TRY.';--> statement-breakpoint
COMMENT ON COLUMN "budget_draft_lines"."justification" IS 'Gerekçe (en çok 1000 karakter); yeni ya da onaylı tutarı değişen kalemde onaya gönderimde zorunludur (K-257).';--> statement-breakpoint
COMMENT ON COLUMN "budget_draft_lines"."created_at" IS 'Oluşturma zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "budget_draft_lines"."updated_at" IS 'Son değişiklik zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "budget_draft_lines"."archived_at" IS 'Satır taslaktan çıkarılınca dolar; sorgular arşivli satırı dışlar.';--> statement-breakpoint
COMMENT ON COLUMN "budget_draft_lines"."version" IS 'Sürüm; satır her düzeltmede artar.';--> statement-breakpoint
COMMENT ON TABLE "budget_draft_events" IS 'Bütçe taslağının revizyon geçmişi (DOM-FIN-093): açılış, gönderim, onay, revizyon isteği, ret ve yeni revizyon birer satırdır (kim, ne zaman, hangi durumdan hangisine, sürüm, not). Gönderim satırı sürümün satırlarını ve önceki sürüme göre değişen kalemleri taşır. Satır yalnız eklenir; depo güncelleme ve silme sunmaz.';--> statement-breakpoint
COMMENT ON COLUMN "budget_draft_events"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "budget_draft_events"."id" IS 'Geçmiş satırı kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "budget_draft_events"."draft_id" IS 'Bütçe taslağı (budget_drafts, restrict).';--> statement-breakpoint
COMMENT ON COLUMN "budget_draft_events"."event" IS 'Olay: created açıldı, submitted gönderildi, approved onaylandı, revision_requested revizyon istendi, rejected reddedildi, reopened yeni revizyon açıldı.';--> statement-breakpoint
COMMENT ON COLUMN "budget_draft_events"."from_status" IS 'Önceki durum; açılış satırında boş.';--> statement-breakpoint
COMMENT ON COLUMN "budget_draft_events"."to_status" IS 'Yeni durum.';--> statement-breakpoint
COMMENT ON COLUMN "budget_draft_events"."revision" IS 'Olay anındaki sürüm numarası; gönderim satırında yeni sürüm.';--> statement-breakpoint
COMMENT ON COLUMN "budget_draft_events"."note" IS 'Adımın notu: revizyon isteği ve retteki gerekçe, gönderim, onay ve yeni revizyonda isteğe bağlı not; en çok 1000 karakter.';--> statement-breakpoint
COMMENT ON COLUMN "budget_draft_events"."lines" IS 'Yalnız gönderim satırında: sürümün satırları (kalem kimliği, tutar kuruş, gerekçe) dizisi; school-core şemasıyla doğrulanarak yazılır. Sonraki sürümün değişen kalemleri buna göre hesaplanır.';--> statement-breakpoint
COMMENT ON COLUMN "budget_draft_events"."changes" IS 'Yalnız gönderim satırında: önceki sürüme (ilk gönderimde onaylı bütçeye) göre değişen kalemler (kalem kimliği, önceki ve yeni tutar; eklenen kalemde önceki, çıkarılanda yeni boş).';--> statement-breakpoint
COMMENT ON COLUMN "budget_draft_events"."actor_user_id" IS 'Adımı yapan kullanıcı.';--> statement-breakpoint
COMMENT ON COLUMN "budget_draft_events"."occurred_at" IS 'Adımın zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "budget_draft_events"."created_at" IS 'Oluşturma zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "budget_draft_events"."updated_at" IS 'Son değişiklik zamanı (UTC); satır değişmez, oluşturma zamanına eşittir.';--> statement-breakpoint
COMMENT ON COLUMN "budget_draft_events"."archived_at" IS 'Arşiv zamanı; geçmiş satırı arşivlenmez.';--> statement-breakpoint
COMMENT ON COLUMN "budget_draft_events"."version" IS 'Sürüm; satır değişmediği için 1 kalır.';
