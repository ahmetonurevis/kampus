CREATE TABLE "student_withdrawals" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"student_id" text NOT NULL,
	"contract_id" text NOT NULL,
	"withdrawal_date" date NOT NULL,
	"reason" text NOT NULL,
	"target_school" text,
	"breakdown" jsonb NOT NULL,
	"refund_cents" bigint NOT NULL,
	"debt_cents" bigint NOT NULL,
	"currency" text DEFAULT 'TRY' NOT NULL,
	"refund_due_date" date NOT NULL,
	"approved_by_user_id" text NOT NULL,
	"refund_paid_date" date,
	"refund_iban" text,
	"refund_account_holder" text,
	"refund_paid_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "student_withdrawals_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "student_withdrawals_reason_check" CHECK ("student_withdrawals"."reason" in ('transfer', 'relocation', 'health', 'financial', 'dissatisfaction', 'other')),
	CONSTRAINT "student_withdrawals_currency_check" CHECK ("student_withdrawals"."currency" = 'TRY'),
	CONSTRAINT "student_withdrawals_amounts_check" CHECK ("student_withdrawals"."refund_cents" >= 0 and "student_withdrawals"."debt_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "student_withdrawals" ADD CONSTRAINT "student_withdrawals_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "student_withdrawals_contract_key" ON "student_withdrawals" USING btree ("institution_id","contract_id");--> statement-breakpoint
CREATE INDEX "student_withdrawals_due_idx" ON "student_withdrawals" USING btree ("institution_id","refund_due_date");--> statement-breakpoint
CREATE INDEX "student_withdrawals_student_idx" ON "student_withdrawals" USING btree ("institution_id","student_id");