import type { Database } from '../db/client.ts'
import { loadStudentFamilies } from '../db/finance-renewal-candidates.ts'
import { TransientConflictError } from '../errors.ts'

/** Velinin öğrencilerini okuyan depo çağrısı; testte iki adımlı yükleme bununla kurulur. */
export type FamilyLoader = (
  db: Database,
  institutionId: string,
  studentIds: readonly string[],
) => Promise<readonly string[]>

/** Kilit dışı tahmin kilit altındaki aileyi kapsamadı; işlem geri alınıp yeniden kurulur. */
class FamilyChangedError extends Error {
  constructor() {
    super('kardeş kümesi kilit dışı okumadan sonra değişti')
    this.name = 'FamilyChangedError'
  }
}

/** Bir istek en çok bu kadar kez kurulur; aile her denemede yine değişirse 409 döner. */
export const FAMILY_ATTEMPTS = 3

/**
 * Kardeş kümesini kurum kilidi altında yeniden okur (DOM-FIN-022, DOM-FIN-023, K-22). Kilit dışı
 * okuma yalnız hangi sözleşmelerin yükleneceğinin ön tahminidir: arada kesin kayıt olan kardeşin
 * sözleşmesi yüklenmemişse core onu "sözleşmesiz, aday lehine öne" sayar ve sıra yanlış çıkar.
 * Tahminde olmayan bir kardeş kilit altında görünürse işlem yazmadan durur. Tahminde olup artık
 * aile olmayan öğrencinin fazladan yüklenen sözleşmesi zararsızdır: core aileyi kendisi süzer.
 */
export async function requireFamilyLoaded(
  tx: Database,
  institutionId: string,
  studentIds: readonly string[],
  loaded: readonly string[],
  loadFamilies: FamilyLoader = loadStudentFamilies,
): Promise<void> {
  const known = new Set(loaded)
  const current = await loadFamilies(tx, institutionId, studentIds)
  if (current.some((id) => !known.has(id))) throw new FamilyChangedError()
}

/**
 * Aileyi tahmin edip işlemi kurar; işlem kilit altında `requireFamilyLoaded` ile durursa (hiçbir
 * şey yazılmadan geri alınır) güncel aileyle yeniden kurar. Kilit bırakıldığında yeni kardeş
 * artık okunur, ikinci deneme çoğunlukla tutar; yine tutmazsa yeniden denenebilir 409 döner.
 */
export async function withStudentFamilies<T>(
  estimate: () => Promise<readonly string[]>,
  attempt: (family: readonly string[]) => Promise<T>,
): Promise<T> {
  for (let tries = 1; ; tries += 1) {
    const family = await estimate()
    try {
      return await attempt(family)
    } catch (error) {
      if (!(error instanceof FamilyChangedError)) throw error
      if (tries >= FAMILY_ATTEMPTS) throw new TransientConflictError({ cause: error })
    }
  }
}
