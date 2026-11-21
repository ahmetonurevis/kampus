-- Seviye tespiti bölüm girişleri (OG-054; IST-058, DOM-DIL-010; ADR 0004 karar 5, 8). Kolon ve
-- kısıt Drizzle şemasından üretildi. Otomatik bölümde cevaplar, rubrikli bölümde rubrik sürümü,
-- hedef seviye ve kriter bantları saklanır; puan saklanmaz, her okumada hesaplanır. Yapı core
-- `placementSectionEntrySchema` ile doğrulanır; veritabanı yalnız dizi ve en çok beş bölüm
-- denetler. Kolon varsayılanla eklenir; mevcut satırlar boş diziyle kısıtı tek adımda sağlar.
ALTER TABLE "placement_sessions" ADD COLUMN "section_entries" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "placement_sessions" ADD CONSTRAINT "placement_sessions_section_entries_check" CHECK (jsonb_typeof("placement_sessions"."section_entries") = 'array' and jsonb_array_length("placement_sessions"."section_entries") <= 5);