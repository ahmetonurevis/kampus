ALTER TABLE "invitations" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "membership_id" text;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "deactivated_at" timestamp;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE set null ON UPDATE no action;