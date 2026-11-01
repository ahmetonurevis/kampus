CREATE TABLE "coordinator_duties" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"membership_id" text NOT NULL,
	"kind" text NOT NULL,
	"scope_id" text NOT NULL,
	"assigned_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "coordinator_duties_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "coordinator_duties_kind_check" CHECK ("coordinator_duties"."kind" in ('subject_head', 'academic_coordinator')),
	CONSTRAINT "coordinator_duties_scope_id_check" CHECK (char_length("coordinator_duties"."scope_id") between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "coordinator_duties" ADD CONSTRAINT "coordinator_duties_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordinator_duties" ADD CONSTRAINT "coordinator_duties_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "coordinator_duties_membership_kind_scope_key" ON "coordinator_duties" USING btree ("institution_id","membership_id","kind","scope_id") WHERE "coordinator_duties"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "coordinator_duties_membership_idx" ON "coordinator_duties" USING btree ("institution_id","membership_id");