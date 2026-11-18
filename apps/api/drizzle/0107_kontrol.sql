ALTER TABLE "prospect_document_consents" ADD COLUMN "student_id" text;--> statement-breakpoint
ALTER TABLE "prospect_document_consents" ADD COLUMN "linked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "prospect_documents" ADD COLUMN "student_id" text;--> statement-breakpoint
ALTER TABLE "prospect_documents" ADD COLUMN "linked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "prospect_documents" ADD COLUMN "linked_by_user_id" text;--> statement-breakpoint
CREATE INDEX "prospect_documents_student_idx" ON "prospect_documents" USING btree ("institution_id","student_id") WHERE "prospect_documents"."student_id" is not null;--> statement-breakpoint
ALTER TABLE "prospect_document_consents" ADD CONSTRAINT "prospect_document_consents_link_check" CHECK (("prospect_document_consents"."student_id" is null) = ("prospect_document_consents"."linked_at" is null));--> statement-breakpoint
ALTER TABLE "prospect_documents" ADD CONSTRAINT "prospect_documents_link_check" CHECK (("prospect_documents"."student_id" is null) = ("prospect_documents"."linked_at" is null) and ("prospect_documents"."student_id" is null) = ("prospect_documents"."linked_by_user_id" is null));--> statement-breakpoint
ALTER TABLE "prospect_documents" ADD CONSTRAINT "prospect_documents_link_status_check" CHECK ("prospect_documents"."student_id" is null or "prospect_documents"."status" in ('accepted', 'superseded'));