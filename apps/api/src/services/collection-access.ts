import { ALWAYS_ON, collectionModule } from '@kampus/school-core/modules/collection-modules.ts'

import { isRecordCollection, RECORD_COLLECTIONS, type CollectionName } from '../db/collections.ts'
import { NotFoundError } from '../errors.ts'

/**
 * Genel koleksiyon okuma uçlarının API'ye özgü sınırı. Rol, kayıt ve alan kapsamı core'dadır
 * (`lib/scope.ts`, `services/read-scope.ts`); koleksiyon → modül eşlemesi ve kurum türü kısıtı
 * core `COLLECTION_MODULES`'tandır (DOM-YTK-012). Burada yalnız sunucunun genel okumaya hiç
 * açmadığı koleksiyonlar tutulur:
 * - `audit`: core'un yerel denetim listesi; sunucuda denetim `audit_log` tablosundadır ve ayrı
 *   uçla açılır (DOM-YTK-053).
 * - `conversations`: birebir yazışma; core taraflarına açar ama yazışma kendi ucuyla gelir,
 *   yöneticinin okuması gerekçeli ve denetim kayıtlı ayrı işlemdir (DOM-YTK-052).
 * - `conversationMessages`: yazışmanın mesajları (ADR 0005); yalnız
 *   `GET /conversations/:id/messages` ile, taraf denetiminden sonra sayfalanarak okunur.
 * - `notifications`, `notificationReads`: uygulama içi bildirim ve kullanıcının okundu işareti;
 *   yalnız `GET /notifications` ile, okuyanın kendi okundu bilgisiyle gelir (DOM-ILT-073).
 */
const CLOSED_COLLECTIONS: ReadonlySet<CollectionName> = new Set<CollectionName>([
  'audit',
  'conversations',
  'conversationMessages',
  'notifications',
  'notificationReads',
])

/** Okuma uçlarında görünen koleksiyonlar (OpenAPI açıklaması ve testler için). */
export const READABLE_COLLECTIONS: readonly CollectionName[] = RECORD_COLLECTIONS.filter(
  (name) => !CLOSED_COLLECTIONS.has(name),
)

/** Koleksiyonun core modül anahtarı; `null` çekirdek kayıt (her modül kullanır, kapatılamaz). */
export function moduleOfCollection(collection: CollectionName): string | null {
  const module = collectionModule(collection)
  return module === undefined || module === ALWAYS_ON ? null : module
}

/** Okunabilir koleksiyon adı; bilinmeyen veya açılmamış ad 404 (varlık sızdırılmaz). */
export function readableCollection(name: string): CollectionName {
  if (!isRecordCollection(name) || CLOSED_COLLECTIONS.has(name)) throw new NotFoundError()
  return name
}
