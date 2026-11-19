ALTER TYPE "public"."job_stage" ADD VALUE 'downloading' BEFORE 'extracting_audio';--> statement-breakpoint
ALTER TYPE "public"."job_stage" ADD VALUE 'probing' BEFORE 'extracting_audio';--> statement-breakpoint
ALTER TYPE "public"."job_type" ADD VALUE 'import_url' BEFORE 'analyze';--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "source" text DEFAULT 'upload' NOT NULL;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "source_url" text;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "error" text;