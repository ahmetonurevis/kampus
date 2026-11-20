CREATE TABLE "department_meeting_templates" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"board" text NOT NULL,
	"name" text NOT NULL,
	"items" jsonb NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "department_meeting_templates_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "department_meeting_templates_board_check" CHECK ("department_meeting_templates"."board" in ('department', 'teachers', 'class')),
	CONSTRAINT "department_meeting_templates_name_check" CHECK (char_length("department_meeting_templates"."name") between 2 and 120),
	CONSTRAINT "department_meeting_templates_items_check" CHECK (jsonb_typeof("department_meeting_templates"."items") = 'array'
        and jsonb_array_length("department_meeting_templates"."items") between 1 and 30)
);
--> statement-breakpoint
ALTER TABLE "department_meetings" DROP CONSTRAINT "department_meetings_text_check";--> statement-breakpoint
ALTER TABLE "department_meetings" ALTER COLUMN "subject_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "department_meetings" ALTER COLUMN "subject_name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "department_meetings" ADD COLUMN "board" text NOT NULL;--> statement-breakpoint
ALTER TABLE "department_meetings" ADD COLUMN "class_id" text;--> statement-breakpoint
ALTER TABLE "department_meetings" ADD COLUMN "class_collection" text GENERATED ALWAYS AS ('classes') STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "department_meetings" ADD COLUMN "class_name" text;--> statement-breakpoint
ALTER TABLE "department_meetings" ADD COLUMN "agenda_template_id" uuid;--> statement-breakpoint
ALTER TABLE "department_meeting_templates" ADD CONSTRAINT "department_meeting_templates_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "department_meeting_templates_name_key" ON "department_meeting_templates" USING btree ("institution_id","board","name") WHERE "department_meeting_templates"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "department_meeting_templates_board_idx" ON "department_meeting_templates" USING btree ("institution_id","board");--> statement-breakpoint
ALTER TABLE "department_meetings" ADD CONSTRAINT "department_meetings_class_fkey" FOREIGN KEY ("institution_id","class_collection","class_id") REFERENCES "public"."records"("institution_id","collection","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_meetings" ADD CONSTRAINT "department_meetings_template_fkey" FOREIGN KEY ("institution_id","agenda_template_id") REFERENCES "public"."department_meeting_templates"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "department_meetings_board_idx" ON "department_meetings" USING btree ("institution_id","board","meeting_date");--> statement-breakpoint
CREATE INDEX "department_meetings_class_idx" ON "department_meetings" USING btree ("institution_id","class_id");--> statement-breakpoint
CREATE INDEX "department_meetings_template_idx" ON "department_meetings" USING btree ("institution_id","agenda_template_id");--> statement-breakpoint
ALTER TABLE "department_meetings" ADD CONSTRAINT "department_meetings_board_check" CHECK ("department_meetings"."board" in ('department', 'teachers', 'class'));--> statement-breakpoint
ALTER TABLE "department_meetings" ADD CONSTRAINT "department_meetings_board_target_check" CHECK (("department_meetings"."board" = 'department' and "department_meetings"."subject_id" is not null and "department_meetings"."subject_name" is not null
          and "department_meetings"."class_id" is null and "department_meetings"."class_name" is null)
        or ("department_meetings"."board" = 'class' and "department_meetings"."class_id" is not null and "department_meetings"."class_name" is not null
          and "department_meetings"."subject_id" is null and "department_meetings"."subject_name" is null)
        or ("department_meetings"."board" = 'teachers' and "department_meetings"."subject_id" is null and "department_meetings"."subject_name" is null
          and "department_meetings"."class_id" is null and "department_meetings"."class_name" is null));--> statement-breakpoint
ALTER TABLE "department_meetings" ADD CONSTRAINT "department_meetings_text_check" CHECK (("department_meetings"."subject_id" is null or char_length("department_meetings"."subject_id") between 1 and 60)
        and ("department_meetings"."subject_name" is null or char_length("department_meetings"."subject_name") between 1 and 120)
        and char_length("department_meetings"."location") between 2 and 200
        and ("department_meetings"."class_id" is null or char_length("department_meetings"."class_id") between 1 and 100)
        and ("department_meetings"."class_name" is null or char_length("department_meetings"."class_name") between 1 and 120));