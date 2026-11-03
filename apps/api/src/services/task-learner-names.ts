import { loadRecordsByIds } from '../db/records.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import type { Viewer } from './task-assignments.ts'

/**
 * Teslim ve deneme satırlarındaki öğrenci adı (OG-213; DOM-YTK-028, DOM-YTK-027). Ad yalnız
 * satırı zaten okuyan personele gelir: yönetici, kapsamındaki teslim/denemeyi gören öğretmen ve
 * alanındaki uyuşmazlıklı teslimi okuyan koordinatör. Satırın okunması ad ve teslim içeriğini
 * birlikte açar; koordinatör öğrenciyi okumasa da teslimi okur, adı onun parçasıdır. Öğrenci ve
 * veli adı hiç almaz (başkasının adı sızmaz; kendi adlarını zaten bilirler). Çağıran, satırların
 * okuma kapsamından geçtiğini garanti eder; yalnız `name` alanı okunur (iletişim, numara, sınıf
 * dönmez), kurum kapsamlı ve arşivli öğrenci dahil kimlikle yüklenir: ad, bitmiş işin kaydıdır.
 */
export async function loadLearnerNames(
  ctx: ServiceContext,
  viewer: Viewer,
  learnerIds: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  if (viewer.kind === 'learner') return new Map()
  const rows = await loadRecordsByIds(
    ctx.db,
    ctx.institutionId,
    'students',
    [...new Set(learnerIds)],
    { includeArchived: true },
  )
  return new Map(
    rows.flatMap((row): [string, string][] =>
      typeof row.data.name === 'string' ? [[row.id, row.data.name]] : [],
    ),
  )
}
