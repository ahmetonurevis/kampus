CREATE TABLE "resource_shares" (
	"institution_id" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "resource_shares_pkey" PRIMARY KEY("institution_id","resource_id","target_kind","target_id"),
	CONSTRAINT "resource_shares_target_kind_check" CHECK ("resource_shares"."target_kind" in ('student', 'class'))
);
--> statement-breakpoint
CREATE TABLE "resource_version_items" (
	"institution_id" text NOT NULL,
	"version_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"item_version_id" uuid NOT NULL,
	"points" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "resource_version_items_pkey" PRIMARY KEY("institution_id","version_id","position"),
	CONSTRAINT "resource_version_items_points_check" CHECK ("resource_version_items"."points" between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "resource_version_outcomes" (
	"institution_id" text NOT NULL,
	"version_id" uuid NOT NULL,
	"outcome_source" text NOT NULL,
	"outcome_id" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "resource_version_outcomes_pkey" PRIMARY KEY("institution_id","version_id","outcome_source","outcome_id"),
	CONSTRAINT "resource_version_outcomes_source_check" CHECK ("resource_version_outcomes"."outcome_source" in ('platform', 'institution'))
);
--> statement-breakpoint
CREATE TABLE "resource_versions" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"status" text NOT NULL,
	"author_user_id" text NOT NULL,
	"title" text NOT NULL,
	"content" jsonb,
	"answer_key" jsonb,
	"license" jsonb,
	"license_kind" text GENERATED ALWAYS AS ((license ->> 'kind')) STORED,
	"attributions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subject_id" text,
	"grade_levels" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"cefr_level" text,
	"primary_skill" text,
	"skills" text[] DEFAULT '{}'::text[] NOT NULL,
	"activity_mode" text,
	"interaction_channel" text,
	"mediation" jsonb,
	"duration_minutes" integer,
	"difficulty" text,
	"search_vector" "tsvector" NOT NULL,
	"submitted_at" timestamp with time zone,
	"reviewed_by_user_id" text,
	"reviewed_at" timestamp with time zone,
	"rejection_reason" text,
	"published_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	"removal_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "resource_versions_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "resource_versions_status_check" CHECK ("resource_versions"."status" in ('draft', 'in_review', 'published', 'rejected', 'archived', 'removed')),
	CONSTRAINT "resource_versions_cefr_level_check" CHECK ("resource_versions"."cefr_level" is null or "resource_versions"."cefr_level" in ('Pre-A1', 'A1', 'A2', 'A2+', 'B1', 'B1+', 'B2', 'B2+', 'C1', 'C2')),
	CONSTRAINT "resource_versions_primary_skill_check" CHECK ("resource_versions"."primary_skill" is null or "resource_versions"."primary_skill" in ('reading', 'listening', 'writing', 'speaking', 'mediation', 'language_use')),
	CONSTRAINT "resource_versions_difficulty_check" CHECK ("resource_versions"."difficulty" is null or "resource_versions"."difficulty" in ('easy', 'medium', 'hard')),
	CONSTRAINT "resource_versions_number_check" CHECK ("resource_versions"."version_number" >= 1),
	CONSTRAINT "resource_versions_content_check" CHECK (("resource_versions"."status" = 'removed') = ("resource_versions"."content" is null)),
	CONSTRAINT "resource_versions_published_check" CHECK ("resource_versions"."status" <> 'published' or "resource_versions"."published_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "resources" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"content_type" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"share_scope" text DEFAULT 'private' NOT NULL,
	"current_version_id" uuid,
	"derived_from_version_id" uuid,
	"derived_from_platform_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "resources_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "resources_content_type_check" CHECK ("resources"."content_type" in ('text', 'reading_passage', 'audio', 'video', 'worksheet', 'file', 'link', 'book_reference', 'question', 'quiz', 'exercise_set', 'homework_template')),
	CONSTRAINT "resources_share_scope_check" CHECK ("resources"."share_scope" in ('private', 'students', 'classes', 'department', 'institution'))
);
--> statement-breakpoint
ALTER TABLE "resource_shares" ADD CONSTRAINT "resource_shares_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_shares" ADD CONSTRAINT "resource_shares_resource_fkey" FOREIGN KEY ("institution_id","resource_id") REFERENCES "public"."resources"("institution_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_version_items" ADD CONSTRAINT "resource_version_items_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_version_items" ADD CONSTRAINT "resource_version_items_version_fkey" FOREIGN KEY ("institution_id","version_id") REFERENCES "public"."resource_versions"("institution_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_version_items" ADD CONSTRAINT "resource_version_items_item_version_fkey" FOREIGN KEY ("institution_id","item_version_id") REFERENCES "public"."resource_versions"("institution_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_version_outcomes" ADD CONSTRAINT "resource_version_outcomes_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_version_outcomes" ADD CONSTRAINT "resource_version_outcomes_version_fkey" FOREIGN KEY ("institution_id","version_id") REFERENCES "public"."resource_versions"("institution_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_versions" ADD CONSTRAINT "resource_versions_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_versions" ADD CONSTRAINT "resource_versions_resource_fkey" FOREIGN KEY ("institution_id","resource_id") REFERENCES "public"."resources"("institution_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_current_version_fkey" FOREIGN KEY ("institution_id","current_version_id") REFERENCES "public"."resource_versions"("institution_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_derived_from_version_fkey" FOREIGN KEY ("institution_id","derived_from_version_id") REFERENCES "public"."resource_versions"("institution_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "resource_shares_target_idx" ON "resource_shares" USING btree ("institution_id","target_kind","target_id") WHERE "resource_shares"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "resource_version_items_item_idx" ON "resource_version_items" USING btree ("institution_id","item_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "resource_versions_resource_number_key" ON "resource_versions" USING btree ("institution_id","resource_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "resource_versions_editable_key" ON "resource_versions" USING btree ("institution_id","resource_id") WHERE "resource_versions"."status" in ('draft', 'rejected');--> statement-breakpoint
CREATE INDEX "resource_versions_search_idx" ON "resource_versions" USING gin ("institution_id","search_vector");--> statement-breakpoint
CREATE INDEX "resources_owner_idx" ON "resources" USING btree ("institution_id","owner_user_id");--> statement-breakpoint
CREATE INDEX "resources_current_version_idx" ON "resources" USING btree ("institution_id","current_version_id") WHERE "resources"."current_version_id" is not null;--> statement-breakpoint
CREATE INDEX "resources_derived_from_version_idx" ON "resources" USING btree ("institution_id","derived_from_version_id") WHERE "resources"."derived_from_version_id" is not null;