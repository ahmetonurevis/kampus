CREATE TABLE "event_ticket_check_in_reversals" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"used_at" timestamp with time zone NOT NULL,
	"used_by_user_id" text NOT NULL,
	"reason" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "event_ticket_check_in_reversals_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "event_ticket_check_in_reversals_reason_check" CHECK (char_length("event_ticket_check_in_reversals"."reason") between 5 and 200)
);
--> statement-breakpoint
ALTER TABLE "event_tickets" DROP CONSTRAINT "event_tickets_cancelled_check";--> statement-breakpoint
ALTER TABLE "event_tickets" ADD COLUMN "refund_cents" bigint;--> statement-breakpoint
ALTER TABLE "event_tickets" ADD COLUMN "refund_method" text;--> statement-breakpoint
ALTER TABLE "event_tickets" ADD COLUMN "refunded_by_user_id" text;--> statement-breakpoint
ALTER TABLE "ticketed_events" ADD COLUMN "limit_scope" text DEFAULT 'student' NOT NULL;--> statement-breakpoint
-- K-380'den önce ödenmiş biletin iptali bedelin tamamını iade edilmiş sayardı (refunded_at): tutar ve iadeyi işaretleyen (iptal eden) taşınır.
UPDATE "event_tickets" SET "refund_cents" = "price_cents", "refunded_by_user_id" = CASE WHEN "refunded_at" IS NULL THEN NULL ELSE "cancelled_by_user_id" END WHERE "status" = 'cancelled' AND "payment_status" = 'paid';--> statement-breakpoint
ALTER TABLE "event_ticket_check_in_reversals" ADD CONSTRAINT "event_ticket_check_in_reversals_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_ticket_check_in_reversals" ADD CONSTRAINT "event_ticket_check_in_reversals_ticket_fkey" FOREIGN KEY ("institution_id","ticket_id") REFERENCES "public"."event_tickets"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_ticket_check_in_reversals_ticket_idx" ON "event_ticket_check_in_reversals" USING btree ("institution_id","ticket_id");--> statement-breakpoint
ALTER TABLE "event_tickets" ADD CONSTRAINT "event_tickets_refund_check" CHECK (("event_tickets"."refund_cents" is not null)
          = ("event_tickets"."status" = 'cancelled' and "event_tickets"."payment_status" = 'paid')
        and ("event_tickets"."refund_cents" is null
          or "event_tickets"."refund_cents" between 0 and "event_tickets"."price_cents")
        and ("event_tickets"."refunded_at" is null or "event_tickets"."refund_cents" > 0)
        and ("event_tickets"."refunded_at" is null) = ("event_tickets"."refunded_by_user_id" is null)
        and ("event_tickets"."refund_method" is null or "event_tickets"."refunded_at" is not null));--> statement-breakpoint
ALTER TABLE "event_tickets" ADD CONSTRAINT "event_tickets_refund_method_check" CHECK ("event_tickets"."refund_method" is null or "event_tickets"."refund_method" in ('cash', 'transfer'));--> statement-breakpoint
ALTER TABLE "event_tickets" ADD CONSTRAINT "event_tickets_cancelled_check" CHECK (("event_tickets"."status" = 'cancelled') = ("event_tickets"."cancelled_at" is not null)
        and ("event_tickets"."cancelled_at" is null) = ("event_tickets"."cancelled_by_user_id" is null)
        and ("event_tickets"."cancel_reason" is null or "event_tickets"."cancelled_at" is not null));--> statement-breakpoint
ALTER TABLE "ticketed_events" ADD CONSTRAINT "ticketed_events_limit_scope_check" CHECK ("ticketed_events"."limit_scope" in ('student', 'family'));;--> statement-breakpoint
COMMENT ON TABLE "event_ticket_check_in_reversals" IS 'Geri alınan giriş (DOM-FIN-103, ON-345, K-378): yanlış okutulan biletin kullanıldı işareti gerekçeyle kaldırılınca eski kullanımın izi (an, okutan, gerekçe, geri alan). Bilet yeniden okutulabilir; satır değişmez ve silinmez. Girişi yönetici ya da okutan görevli, etkinlik günü (Europe/Istanbul) bitene kadar geri alır.';--> statement-breakpoint
COMMENT ON COLUMN "event_ticket_check_in_reversals"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "event_ticket_check_in_reversals"."id" IS 'Geri alma kaydı kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "event_ticket_check_in_reversals"."ticket_id" IS 'Girişi geri alınan bilet (event_tickets).';--> statement-breakpoint
COMMENT ON COLUMN "event_ticket_check_in_reversals"."used_at" IS 'Geri alınan girişin anı (UTC); biletteki used_at bu satıra taşınıp boşaltılır.';--> statement-breakpoint
COMMENT ON COLUMN "event_ticket_check_in_reversals"."used_by_user_id" IS 'Geri alınan girişi okutan personel.';--> statement-breakpoint
COMMENT ON COLUMN "event_ticket_check_in_reversals"."reason" IS 'Geri alma gerekçesi (5–200); serbest metin, denetim kaydına ve loga yazılmaz.';--> statement-breakpoint
COMMENT ON COLUMN "event_ticket_check_in_reversals"."created_by_user_id" IS 'Girişi geri alan personel (yönetici ya da girişi okutan görevli).';--> statement-breakpoint
COMMENT ON COLUMN "event_ticket_check_in_reversals"."created_at" IS 'Girişin geri alındığı an (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "event_ticket_check_in_reversals"."updated_at" IS 'Son değişiklik zamanı (UTC); satır değişmez.';--> statement-breakpoint
COMMENT ON COLUMN "event_ticket_check_in_reversals"."archived_at" IS 'Kullanılmaz; geri alma kaydı silinmez ve arşivlenmez.';--> statement-breakpoint
COMMENT ON COLUMN "event_ticket_check_in_reversals"."version" IS 'İyimser kilit sürümü; satır değişmediği için 1 kalır.';--> statement-breakpoint
COMMENT ON COLUMN "ticketed_events"."limit_scope" IS 'Üst sınırın kapsamı (K-379): student öğrenci başına, family aile başına (aynı veliye bağlı kardeşlerin etkin biletleri birlikte sayılır). Sınır boşsa etkisiz; değişiklik yalnız sonraki ayırmalara uygulanır.';--> statement-breakpoint
COMMENT ON COLUMN "ticketed_events"."per_student_limit" IS 'Öğrenci ya da aile (limit_scope) başına etkin bilet üst sınırı (1–20); boşsa sınırsız. Yalnız sonraki ayırmalara uygulanır.';--> statement-breakpoint
COMMENT ON COLUMN "event_tickets"."refund_cents" IS 'Ödenmiş biletin iptalinde yazılan iade tutarı, kuruş (0…bedel; K-380): etkinliğe 7+ gün kala tam, 1–6 gün kala yarı, etkinlik günü ve sonrası 0; kuraldan farklı tutarı yalnız yönetici notla yazar. Ödenmemiş ya da iptal edilmemiş bilette boş.';--> statement-breakpoint
COMMENT ON COLUMN "event_tickets"."refund_method" IS 'İadenin elle yapıldığı yöntem: cash nakit, transfer havale/EFT. K-380 öncesi iadelerde boş. Gün sonuna girmez (M-49).';--> statement-breakpoint
COMMENT ON COLUMN "event_tickets"."refunded_at" IS 'İadenin ödendiğinin işaretlendiği an (UTC); tutar sıfırsa ödenecek iade yoktur. K-380 öncesi iptalle aynı an.';--> statement-breakpoint
COMMENT ON COLUMN "event_tickets"."refunded_by_user_id" IS 'İadenin ödendiğini işaretleyen personel.';--> statement-breakpoint
COMMENT ON COLUMN "event_tickets"."used_at" IS 'Girişte kullanıldı işaretinin anı; kullanılmış bilet iptal edilmez. Yanlış okutma etkinlik günü içinde geri alınır (K-378); eski an event_ticket_check_in_reversals satırında kalır.';
