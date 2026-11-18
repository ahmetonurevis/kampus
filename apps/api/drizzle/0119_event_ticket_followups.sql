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
ALTER TABLE "ticketed_events" ADD CONSTRAINT "ticketed_events_limit_scope_check" CHECK ("ticketed_events"."limit_scope" in ('student', 'family'));