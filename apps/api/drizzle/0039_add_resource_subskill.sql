-- Anlama sorusunun alt becerisi (OG-051; IST-042, DOM-BEC-006). Kolon ve kısıt Drizzle şemasından
-- (core `SUBSKILLS`) üretildi. Kolon boş eklenir; var olan satırlar `null` ile kısıtı sağladığından
-- kısıt tek adımda doğrulanır. Alt beceri yalnız soru sürümünde dolar (core
-- `resourceVersionInputSchema`).
ALTER TABLE "resource_versions" ADD COLUMN "subskill" text;--> statement-breakpoint
ALTER TABLE "resource_versions" ADD CONSTRAINT "resource_versions_subskill_check" CHECK ("resource_versions"."subskill" is null or "resource_versions"."subskill" in ('main_idea', 'detail', 'inference', 'vocabulary'));