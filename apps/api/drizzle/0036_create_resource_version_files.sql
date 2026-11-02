CREATE TABLE "resource_version_files" (
	"institution_id" text NOT NULL,
	"version_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "resource_version_files_pkey" PRIMARY KEY("institution_id","version_id","file_id"),
	CONSTRAINT "resource_version_files_position_check" CHECK ("resource_version_files"."position" >= 0 and "resource_version_files"."position" < 50)
);
--> statement-breakpoint
ALTER TABLE "resource_version_files" ADD CONSTRAINT "resource_version_files_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_version_files" ADD CONSTRAINT "resource_version_files_version_fkey" FOREIGN KEY ("institution_id","version_id") REFERENCES "public"."resource_versions"("institution_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_version_files" ADD CONSTRAINT "resource_version_files_file_fkey" FOREIGN KEY ("institution_id","file_id") REFERENCES "public"."files"("institution_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "resource_version_files_file_idx" ON "resource_version_files" USING btree ("institution_id","file_id");