CREATE TABLE "records" (
	"institution_id" text NOT NULL,
	"collection" text NOT NULL,
	"id" text NOT NULL,
	"data" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "records_pkey" PRIMARY KEY("institution_id","collection","id"),
	CONSTRAINT "records_data_size_check" CHECK (pg_column_size("records"."data") <= 262144)
);
--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;