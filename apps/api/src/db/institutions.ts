import { asc } from 'drizzle-orm'

import type { Database } from './client.ts'
import { institutions } from './schema/auth.ts'

/**
 * Bütün kurumların kimlikleri, kimlik sırasıyla. Kurumlar arası tek okuma budur: zamanlanmış iş
 * (`src/jobs`) kurumları dolaşıp kurum başına iş kuyruğa koyar; işin kendisi kurum kapsamlı depo
 * fonksiyonlarıyla çalışır. Kimlik dışında alan okunmaz.
 */
export async function listInstitutionIds(db: Database): Promise<string[]> {
  const rows = await db
    .select({ id: institutions.id })
    .from(institutions)
    .orderBy(asc(institutions.id))
  return rows.map((row) => row.id)
}
