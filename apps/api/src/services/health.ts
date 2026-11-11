import { sql } from 'drizzle-orm'

import type { Database } from '../db/client.ts'

/** Sistem denetimi: kurum verisine dokunmaz, yalnız bağlantıyı sınar. */
export async function pingDatabase(db: Database): Promise<boolean> {
  try {
    await db.execute(sql`select 1`)
    return true
  } catch {
    // Ayrıntı çağıranın sorumluluğunda değil; sağlık ucu 503 döner.
    return false
  }
}
