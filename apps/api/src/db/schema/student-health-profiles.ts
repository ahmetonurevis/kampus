import { sql } from 'drizzle-orm'
import { check, integer, pgTable, primaryKey, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

import {
  HEALTH_LEGAL_BASES,
  type HealthLegalBasis,
} from '@kampus/school-core/lib/health-profile.ts'

import { institutions } from './auth.ts'
import { keys, oneOf, requiredColumns } from './columns.ts'

/**
 * Öğrencinin sağlık ve acil bilgisi (IST-020; DOM-ILT-035, okuma denetimi DOM-YTK-052; kural core
 * `lib/health-profile.ts`). Özel nitelikli veri (KVKK m.6, sınıf Ö): normalleştirme ölçütü 5
 * gereği `records.data` yerine ayrı tablodadır ve içerik uygulama düzeyinde şifrelidir
 * (AES-256-GCM, kurum anahtarı `FIELD_ENCRYPTION_KEY`'den türetilir; `src/lib/field-crypto.ts`).
 * Şifreli değer kurum, satır kimliği (`id`), öğrenci, hukuki dayanak, tablo ve kolona bağlıdır; başka satıra kopyalanırsa ya da dayanak kodu değiştirilirse çözülmez. Satır kimliği uygulamada üretilir (yazmadan önce bilinmeli; veritabanı varsayılanı yok).
 * Hukuki dayanak kısa koddur, şifresizdir (rapor ve imha için). Öğrenci kaydı `records`'tadır
 * (yabancı anahtar yok). Kaldırma arşivdir; kurum içinde öğrenci başına bir etkin satır.
 *
 * TODO(IST-020-anahtar-dondurme): `key_version`'ı eski olan satırları yeni sürüme yeniden
 * şifreleyen iş.
 */
export const studentHealthProfiles = pgTable(
  'student_health_profiles',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    // kvkk: K — öğrenci kaydı
    studentId: text('student_id').notNull(),
    // kvkk: Ö — şifreli içerik: base64(IV ‖ GCM etiketi ‖ şifreli JSON); düz metin tutulmaz
    contentCiphertext: text('content_ciphertext').notNull(),
    // Kişisel veri değil: yalnız anahtar sürümü (kvkk sınıfı gerekmez).
    keyVersion: integer('key_version').notNull(),
    // kvkk: K — işleme dayanağı kodu, sağlık verisinin kendisi değil; satırın varlığı zaten sağlık
    // kaydı olduğunu gösterir, içerik şifreli kolondadır. AAD'ye girer (ham satırda değişirse
    // içerik çözülmez).
    legalBasis: text('legal_basis').$type<HealthLegalBasis>().notNull(),
    // kvkk: K — son yazan kullanıcı (silinen hesabın izi denetim kaydındadır; yabancı anahtar yok)
    updatedByUserId: text('updated_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'student_health_profiles_pkey', columns: [table.institutionId, table.id] }),
    check(
      'student_health_profiles_legal_basis_check',
      oneOf(table.legalBasis, keys(HEALTH_LEGAL_BASES)),
    ),
    check('student_health_profiles_key_version_check', sql`${table.keyVersion} > 0`),
    // Öğrenci başına bir etkin satır; okuma ve yazma bu indeksten.
    uniqueIndex('student_health_profiles_student_key')
      .on(table.institutionId, table.studentId)
      .where(sql`${table.archivedAt} is null`),
  ],
)
