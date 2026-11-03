import { loadRecordsByIds } from '../db/records.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import type { Viewer } from './task-assignments.ts'

/**
 * Teslim ve deneme satırlarındaki öğrenci adı (OG-213; DOM-YTK-028, DOM-YTK-027). Satırı okumak
 * adı açmaz: atamayı gören öğretmen atamanın bütün satırlarını okur ama başkasının öğrencisinin
 * adı istemciye gelmez. Ad kime gelir:
 * - yönetici: kurumdaki her öğrenci;
 * - öğretmen: yalnız öğrenci kapsamındaki (`studentIds`, DOM-YTK-022) öğrenciler; kapsam dışı
 *   satırda `null` (web genel "Öğrenci" etiketini gösterir). İstisna `coordinated`: öğrencisini
 *   okumasa da uyuşmazlıklı teslimi görev gereği okuyan koordinatörün o teslimlerin öğrencileri;
 * - öğrenci ve veli: hiç (kendi adlarını zaten bilirler, başkasınınki girmez).
 * Yalnız `name` okunur (iletişim, numara, sınıf dönmez); kurum kapsamlı, arşivli öğrenci dahil
 * kimlikle yüklenir: ad, bitmiş işin kaydıdır. Kayıt yoksa ad yoktur (`null`).
 */
export async function loadLearnerNames(
  ctx: ServiceContext,
  viewer: Viewer,
  learnerIds: readonly string[],
  coordinated: ReadonlySet<string> = new Set(),
): Promise<ReadonlyMap<string, string>> {
  if (viewer.kind === 'learner') return new Map()
  const allowed = [...new Set(learnerIds)].filter(
    (id) => viewer.kind === 'admin' || viewer.studentIds.has(id) || coordinated.has(id),
  )
  const rows = await loadRecordsByIds(ctx.db, ctx.institutionId, 'students', allowed, {
    includeArchived: true,
  })
  return new Map(
    rows.flatMap((row): [string, string][] =>
      typeof row.data.name === 'string' ? [[row.id, row.data.name]] : [],
    ),
  )
}
