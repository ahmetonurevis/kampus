import assert from 'node:assert/strict'
import test from 'node:test'

import type { Database } from '../../src/db/client.ts'
import { AppError } from '../../src/errors.ts'
import {
  FAMILY_ATTEMPTS,
  requireFamilyLoaded,
  withStudentFamilies,
  type FamilyLoader,
} from '../../src/services/finance-families.ts'

// Kardeş kümesi kilit dışında tahmin, kilit altında doğrulanır (DOM-FIN-022, DOM-FIN-023, K-22).
// İki adımlı yükleme simülasyonu: kilit dışı okuma ile kurum kilidi arasında kardeş kesin kayıt olur.

const TX = {} as Database
const INSTITUTION = 'inst-1'

/** Sırayla verilen aileleri döndüren depo: her çağrı bir sonraki görüntüdür. */
function snapshots(...families: (readonly string[])[]) {
  const calls: string[] = []
  let index = 0
  const load: FamilyLoader = (_db, _institutionId, studentIds) => {
    calls.push(studentIds.join(','))
    const family = families[Math.min(index, families.length - 1)] ?? studentIds
    index += 1
    return Promise.resolve(family)
  }
  return { load, calls }
}

/** Kilit dışı tahmini ve kilit altındaki görüntüyü ayrı depolardan okuyan bir işlem denemesi. */
function command(underLock: FamilyLoader, loadedFamilies: (readonly string[])[]) {
  return async (family: readonly string[]) => {
    await requireFamilyLoaded(TX, INSTITUTION, ['ece'], family, underLock)
    loadedFamilies.push(family)
    return family
  }
}

test('DOM-FIN-022, K-22: kilit dışı tahminden sonra kaydolan kardeşin sözleşmesi yeniden kurulan işlemde yüklenir', async () => {
  // Tahmin: yalnız Ece. Kilit altında Deniz de ailededir (arada kesin kayıt oldu).
  const estimate = snapshots(['ece'], ['ece', 'deniz'])
  const underLock = snapshots(['ece', 'deniz'])
  const ran: (readonly string[])[] = []
  const family = await withStudentFamilies(
    () => estimate.load(TX, INSTITUTION, ['ece']),
    command(underLock.load, ran),
  )
  assert.deepEqual(family, ['ece', 'deniz'])
  // İlk deneme yazmadan durdu; yalnız ikinci deneme işlemi kurdu.
  assert.deepEqual(ran, [['ece', 'deniz']])
  assert.equal(estimate.calls.length, 2)
  assert.equal(underLock.calls.length, 2)
})

test('DOM-FIN-022: aile değişmediyse işlem tek denemede kurulur; ayrılan kardeşin fazladan yüklenmesi zararsızdır', async () => {
  const estimate = snapshots(['ece', 'deniz'])
  const underLock = snapshots(['ece'])
  const ran: (readonly string[])[] = []
  const family = await withStudentFamilies(
    () => estimate.load(TX, INSTITUTION, ['ece']),
    command(underLock.load, ran),
  )
  assert.deepEqual(family, ['ece', 'deniz'])
  assert.equal(estimate.calls.length, 1)
})

test('DOM-FIN-022: aile her denemede yine değişirse yeniden denenebilir 409 conflict döner', async () => {
  let size = 1
  const growing: FamilyLoader = () => {
    size += 1
    return Promise.resolve(Array.from({ length: size }, (_, index) => `s${String(index)}`))
  }
  let attempts = 0
  await assert.rejects(
    withStudentFamilies(
      () => {
        attempts += 1
        return Promise.resolve(Array.from({ length: attempts }, (_, index) => `s${String(index)}`))
      },
      (family) => requireFamilyLoaded(TX, INSTITUTION, ['s0'], family, growing),
    ),
    (error: unknown) =>
      error instanceof AppError && error.statusCode === 409 && error.code === 'conflict',
  )
  assert.equal(attempts, FAMILY_ATTEMPTS)
})

test('DOM-FIN-022: işlemin kendi hatası yeniden denenmez', async () => {
  let attempts = 0
  await assert.rejects(
    withStudentFamilies(
      () => {
        attempts += 1
        return Promise.resolve(['ece'])
      },
      () => Promise.reject(new AppError(422, 'sibling_discount_ineligible', 'Kardeş yok.')),
    ),
    (error: unknown) => error instanceof AppError && error.code === 'sibling_discount_ineligible',
  )
  assert.equal(attempts, 1)
})
