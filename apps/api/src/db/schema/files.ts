import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import {
  FILE_PURPOSES,
  FILE_STATUSES,
  type FilePurpose,
  type FileStatus,
} from '@kampus/school-core/content/taxonomy.ts'

import { institutions } from './auth.ts'
import { keys, oneOf, requiredColumns } from './columns.ts'

/**
 * Yüklenen dosyaların meta verisi (ADR 0003 karar 4; veritabani.md §4 ölçüt 2 ve 5). Dosyanın
 * kendisi depodadır (`src/storage`); satır nesneyi `storage_key` ile bulur.
 *
 * - Kimlik uygulamada üretilen `uuid`'dir; birincil anahtar `(institution_id, id)`.
 * - Anahtar sunucuda üretilir ve kişisel veri taşımaz: `<institution_id>/<purpose>/<yyyy>/<mm>/<uuid>`.
 *   Özgün ad yalnız indirmede `Content-Disposition` için kullanılır; log ve denetim kaydına girmez.
 * - İçerik kolonları (amaç, anahtar, tür, boyut, özet, yükleyen) değişmez: migration 0015'teki
 *   `kampus_reject_file_content_change()` tetikleyicisi bunları değiştiren `update`'i 55000 ile
 *   reddeder. Durum, bağlama, saklama ve silme kolonları işlem akışıyla değişir. Satır silinmez
 *   (imha nesneyi siler, satır `deleted` kalır); `delete` yalnız imha işinin
 *   `set local kampus.allow_immutable_purge = 'on'` ayarıyla geçer.
 * - Bağlı kayıt (`attached_type` + `attached_id`) çok biçimlidir (teslim sürümü, kaynak sürümü,
 *   soru); veritabanı yabancı anahtarı yoktur, bütünlüğü bağlayan işlem sağlar (karar 5).
 * - Tablo yeni ve boştur; kısıtlar `not valid` adımına gerek olmadan tek adımda eklenir.
 */

// Durum listesi core'dadır (ADR 0003 karar 4); API içi kullanım için yeniden dışa verilir.
export { FILE_STATUSES, type FileStatus }

export const files = pgTable(
  'files',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    purpose: text('purpose').$type<FilePurpose>().notNull(),
    status: text('status').$type<FileStatus>().notNull().default('pending'),
    storageKey: text('storage_key').notNull(),
    /** İçerikten tespit edilen tür (ADR 0003 karar 3); istemcinin bildirdiği tür saklanmaz. */
    contentType: text('content_type').notNull(),
    byteSize: bigint('byte_size', { mode: 'number' }).notNull(),
    /** İçeriğin SHA-256 özeti (64 küçük harf onaltılık). */
    sha256: text('sha256').notNull(),
    /** Sunucuda ölçülen süre (`ffprobe`, F3c2b); ölçülene kadar boş. */
    durationMs: integer('duration_ms'),
    // kvkk: K — temizlenmiş özgün dosya adı; yalnız indirmede kullanılır, imhada silinir
    originalName: text('original_name'),
    // kvkk: K — yükleyen kullanıcı
    uploadedByUserId: text('uploaded_by_user_id').notNull(),
    // kvkk: K — veri sahibi öğrenci/kursiyer (imha ve başvuru için; bağlama işlemi yazar)
    dataSubjectId: text('data_subject_id'),
    attachedType: text('attached_type'),
    attachedId: text('attached_id'),
    attachedAt: timestamp('attached_at', { withTimezone: true }),
    retentionUntil: timestamp('retention_until', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    /**
     * Ses dönüşümünde (ADR 0003 karar 10) yerini dönüşmüş nesneye bırakan özgün nesnenin anahtarı.
     * `processing` → `ready` geçişiyle aynı güncellemede yazılır, nesne depodan silinince boşalır:
     * silinemeyen özgün nesne izlenir ve temizlik (`files.purge-unattached`, imha) onu da siler.
     * Anahtar kişisel veri taşımaz.
     */
    supersededStorageKey: text('superseded_storage_key'),
    /**
     * Dosyanın `ready` olduğu an (OG-995): tarama (`file.scan`) ya da ses dönüşümü `ready`'yi
     * yazdığı güncellemede doldurur. Bağsız dosyanın 24 saatlik ömrü (karar 5) bu andan sayılır:
     * `clamd` kesintisinden sonra geç taranan dosya bağlanmadan hemen silinmez. Taramasız
     * (`pending`) ve eski `ready` satırlarda boştur; süre yüklemeden (`created_at`) sayılır.
     */
    readyAt: timestamp('ready_at', { withTimezone: true }),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'files_pkey', columns: [table.institutionId, table.id] }),
    check('files_purpose_check', oneOf(table.purpose, keys(FILE_PURPOSES))),
    check('files_status_check', oneOf(table.status, FILE_STATUSES)),
    check('files_byte_size_check', sql`${table.byteSize} > 0`),
    check('files_sha256_check', sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
    check('files_duration_ms_check', sql`${table.durationMs} is null or ${table.durationMs} >= 0`),
    check(
      'files_attached_check',
      sql`(${table.attachedType} is null) = (${table.attachedId} is null) and (${table.attachedId} is null) = (${table.attachedAt} is null)`,
    ),
    check(
      'files_deleted_check',
      sql`(${table.status} = 'deleted') = (${table.deletedAt} is not null)`,
    ),
    check('files_version_check', sql`${table.version} >= 1`),
    check(
      'files_superseded_storage_key_check',
      sql`${table.supersededStorageKey} is null or ${table.supersededStorageKey} <> ${table.storageKey}`,
    ),
    uniqueIndex('files_storage_key_key').on(table.institutionId, table.storageKey),
    // Bağlı kaydın dosyaları (teslim, kaynak sürümü) ve kayıttan dosyaya erişim (karar 6).
    index('files_attached_idx')
      .on(table.institutionId, table.attachedType, table.attachedId)
      .where(sql`${table.attachedId} is not null`),
    // Bağlanmamış dosya temizliği (karar 5): eski, bağsız, silinmemiş satırlar.
    index('files_unattached_idx')
      .on(table.institutionId, table.createdAt)
      .where(sql`${table.attachedId} is null and ${table.status} <> 'deleted'`),
    // Veri sahibinin silme/erişim başvurusu (guvenlik-kvkk §11).
    index('files_data_subject_idx')
      .on(table.institutionId, table.dataSubjectId)
      .where(sql`${table.dataSubjectId} is not null`),
    index('files_uploaded_by_idx').on(table.institutionId, table.uploadedByUserId),
    // Silinmeyi bekleyen özgün ses nesneleri (OG-262).
    index('files_superseded_idx')
      .on(table.institutionId, table.id)
      .where(sql`${table.supersededStorageKey} is not null`),
  ],
)
