CREATE TABLE "fixed_asset_assignments" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"assignee_type" text NOT NULL,
	"membership_id" text,
	"campus_id" text,
	"location" text,
	"assigned_date" date NOT NULL,
	"note" text,
	"assigned_at" timestamp with time zone NOT NULL,
	"assigned_by_user_id" text NOT NULL,
	"returned_at" timestamp with time zone,
	"return_date" date,
	"return_condition" text,
	"return_note" text,
	"returned_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "fixed_asset_assignments_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "fixed_asset_assignments_assignee_type_check" CHECK ("fixed_asset_assignments"."assignee_type" in ('staff', 'location')),
	CONSTRAINT "fixed_asset_assignments_assignee_check" CHECK (("fixed_asset_assignments"."assignee_type" = 'staff' and "fixed_asset_assignments"."membership_id" is not null
          and "fixed_asset_assignments"."campus_id" is null and "fixed_asset_assignments"."location" is null)
        or ("fixed_asset_assignments"."assignee_type" = 'location' and "fixed_asset_assignments"."membership_id" is null
          and "fixed_asset_assignments"."location" is not null
          and char_length("fixed_asset_assignments"."location") between 2 and 120)),
	CONSTRAINT "fixed_asset_assignments_note_check" CHECK (("fixed_asset_assignments"."note" is null or char_length("fixed_asset_assignments"."note") between 1 and 500)
        and ("fixed_asset_assignments"."return_note" is null or char_length("fixed_asset_assignments"."return_note") between 1 and 500)),
	CONSTRAINT "fixed_asset_assignments_return_condition_check" CHECK ("fixed_asset_assignments"."return_condition" is null or "fixed_asset_assignments"."return_condition" in ('intact', 'damaged')),
	CONSTRAINT "fixed_asset_assignments_return_check" CHECK ((("fixed_asset_assignments"."returned_at" is null) = ("fixed_asset_assignments"."return_date" is null))
        and (("fixed_asset_assignments"."returned_at" is null) = ("fixed_asset_assignments"."return_condition" is null))
        and (("fixed_asset_assignments"."returned_at" is null) = ("fixed_asset_assignments"."returned_by_user_id" is null))
        and ("fixed_asset_assignments"."returned_at" is not null or "fixed_asset_assignments"."return_note" is null)
        and ("fixed_asset_assignments"."return_date" is null or "fixed_asset_assignments"."return_date" >= "fixed_asset_assignments"."assigned_date")
        and ("fixed_asset_assignments"."return_condition" is distinct from 'damaged'
          or coalesce(char_length("fixed_asset_assignments"."return_note"), 0) >= 5))
);
--> statement-breakpoint
ALTER TABLE "fixed_asset_assignments" ADD CONSTRAINT "fixed_asset_assignments_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_asset_assignments" ADD CONSTRAINT "fixed_asset_assignments_asset_fkey" FOREIGN KEY ("institution_id","asset_id") REFERENCES "public"."fixed_assets"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_asset_assignments" ADD CONSTRAINT "fixed_asset_assignments_membership_fkey" FOREIGN KEY ("institution_id","membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fixed_asset_assignments_open_key" ON "fixed_asset_assignments" USING btree ("institution_id","asset_id") WHERE "fixed_asset_assignments"."returned_at" is null and "fixed_asset_assignments"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "fixed_asset_assignments_asset_idx" ON "fixed_asset_assignments" USING btree ("institution_id","asset_id","assigned_date");--> statement-breakpoint
CREATE INDEX "fixed_asset_assignments_membership_idx" ON "fixed_asset_assignments" USING btree ("institution_id","membership_id");--> statement-breakpoint
COMMENT ON TABLE "fixed_asset_assignments" IS 'Demirbaş zimmeti (DOM-FIN-086, ON-236): demirbaşın bir personel üyeliğine ya da bir konuma (kampüs ve oda) teslimi ve iadesi. Demirbaş başına tek açık zimmet vardır (fixed_asset_assignments_open_key, K-211); devir iade ve yeni zimmettir. Satır silinmez ve düzeltilmez, iade bir kez yazılır (K-212). Yalnız yönetici okur ve yazar (K-189, K-214).';--> statement-breakpoint
COMMENT ON COLUMN "fixed_asset_assignments"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "fixed_asset_assignments"."id" IS 'Zimmet kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "fixed_asset_assignments"."asset_id" IS 'Zimmetlenen demirbaş (fixed_assets); hurdaya ayrılmış demirbaşa zimmet verilmez, açık zimmetli demirbaş hurdaya ayrılmaz (K-213).';--> statement-breakpoint
COMMENT ON COLUMN "fixed_asset_assignments"."assignee_type" IS 'Teslim alan türü: staff personel üyeliği, location konum (kampüs ve oda) (K-210).';--> statement-breakpoint
COMMENT ON COLUMN "fixed_asset_assignments"."membership_id" IS 'Personel zimmetinde teslim alan kurum üyeliği (memberships; yönetici, öğretmen ya da ön büro, zimmet anında pasifleştirilmemiş). Konum zimmetinde boş. Üyelik silinemez (restrict), geçmiş korunur.';--> statement-breakpoint
COMMENT ON COLUMN "fixed_asset_assignments"."campus_id" IS 'Konum zimmetinde isteğe bağlı kampüs: records tablosundaki branches kaydının kimliği. Yabancı anahtar yoktur, zimmet anında sunucuda denetlenir. Personel zimmetinde boş.';--> statement-breakpoint
COMMENT ON COLUMN "fixed_asset_assignments"."location" IS 'Konum zimmetinde oda ya da yer, serbest metin, 2–120 karakter. Personel zimmetinde boş. Demirbaş kaydındaki konumu değiştirmez.';--> statement-breakpoint
COMMENT ON COLUMN "fixed_asset_assignments"."assigned_date" IS 'Zimmet (teslim) günü, Europe/Istanbul; alım gününden ve önceki zimmetin iade gününden önce, işlem gününden sonra olamaz.';--> statement-breakpoint
COMMENT ON COLUMN "fixed_asset_assignments"."note" IS 'Zimmet notu (ör. aksesuarlar), isteğe bağlı, en çok 500 karakter.';--> statement-breakpoint
COMMENT ON COLUMN "fixed_asset_assignments"."assigned_at" IS 'Zimmet işleminin zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "fixed_asset_assignments"."assigned_by_user_id" IS 'Zimmeti veren kullanıcı (yönetici).';--> statement-breakpoint
COMMENT ON COLUMN "fixed_asset_assignments"."returned_at" IS 'İade işleminin zamanı (UTC); boşsa zimmet açıktır.';--> statement-breakpoint
COMMENT ON COLUMN "fixed_asset_assignments"."return_date" IS 'İade günü, Europe/Istanbul; zimmet gününden önce, işlem gününden sonra olamaz.';--> statement-breakpoint
COMMENT ON COLUMN "fixed_asset_assignments"."return_condition" IS 'İade durumu: intact sağlam, damaged hasarlı. Demirbaşın durumunu kendiliğinden değiştirmez (K-212).';--> statement-breakpoint
COMMENT ON COLUMN "fixed_asset_assignments"."return_note" IS 'İade durum notu, en çok 500 karakter; hasarlı iadede en az 5 karakter zorunlu.';--> statement-breakpoint
COMMENT ON COLUMN "fixed_asset_assignments"."returned_by_user_id" IS 'İadeyi alan kullanıcı (yönetici).';--> statement-breakpoint
COMMENT ON COLUMN "fixed_asset_assignments"."created_at" IS 'Oluşturma zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "fixed_asset_assignments"."updated_at" IS 'Son değişiklik zamanı (UTC); yalnız iadede değişir.';--> statement-breakpoint
COMMENT ON COLUMN "fixed_asset_assignments"."archived_at" IS 'Arşiv zamanı; zimmet arşivlenmez, iade edilir. Tek açık zimmet kuralı arşivlenmemiş satırlar arasındadır.';--> statement-breakpoint
COMMENT ON COLUMN "fixed_asset_assignments"."version" IS 'İyimser kilit sürümü (If-Match; iade).';
