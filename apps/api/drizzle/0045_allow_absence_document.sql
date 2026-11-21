-- Velinin izin/mazeret bildirimine eklediği özür belgesi dosya amacı (OG-044; IST-072, DOM-ILT-053,
-- ADR 0003 karar 3). Kısıt Drizzle şemasından (core `FILE_PURPOSES`) üretildi. Amaç yalnız eklenir;
-- var olan satırların amacı listede kaldığından kısıt tek adımda doğrulanır.
ALTER TABLE "files" DROP CONSTRAINT "files_purpose_check";--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_purpose_check" CHECK ("files"."purpose" in ('submission', 'material', 'question_image', 'student_question_photo', 'listening_audio', 'speaking_recording', 'document', 'absence_document'));
