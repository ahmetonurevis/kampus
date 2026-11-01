import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { RubricListItem, RubricVersion } from '@kampus/react-shared/use-rubrics.ts'
import {
  findRubricVersion,
  shouldLookUpRubric,
  type RubricListPage,
} from '../src/pages/tasks/rubric-version-lookup.ts'

const item = (id: string, head: string, published: string | null): RubricListItem =>
  ({
    rubric: { id },
    head: { id: head },
    publishedVersionId: published,
  }) as unknown as RubricListItem
const version = (id: string) => ({ id }) as unknown as RubricVersion

/** Sayfalı sahte kaynak: istek sayacı ve uçuştaki en çok eşzamanlı çağrıyı ölçer. */
function source(rubrics: RubricListItem[], versionsOf: Record<string, string[]>, size = 2) {
  const calls = { list: 0, detail: [] as string[], inFlight: 0, maxInFlight: 0 }
  return {
    calls,
    listPage: async (page: number): Promise<RubricListPage> => {
      calls.list += 1
      return {
        data: rubrics.slice((page - 1) * size, page * size),
        meta: { page, pageSize: size, total: rubrics.length },
      }
    },
    detail: async (rubricId: string) => {
      calls.detail.push(rubricId)
      calls.inFlight += 1
      calls.maxInFlight = Math.max(calls.maxInFlight, calls.inFlight)
      await Promise.resolve()
      calls.inFlight -= 1
      return { versions: (versionsOf[rubricId] ?? []).map(version) }
    },
  }
}

describe('atanan rubrik sürümünü bulma (DOM-BEC-022)', () => {
  test('baş ya da yayındaki sürümle eşleşen rubrik tek ayrıntı çağrısıyla bulunur', async () => {
    const s = source([item('r1', 'r1v3', 'r1v2'), item('r2', 'r2v1', 'r2v1')], {
      r1: ['r1v2', 'r1v3'],
      r2: ['r2v1'],
    })
    assert.equal((await findRubricVersion('r2v1', s))?.id, 'r2v1')
    assert.deepEqual(s.calls.detail, ['r2'])
  })

  test('sabitlenmiş eski sürüm sırayla taranır, bulununca durur; eşzamanlı istek yoktur', async () => {
    const rubrics = ['r1', 'r2', 'r3', 'r4', 'r5'].map((id) => item(id, `${id}v2`, `${id}v2`))
    const s = source(rubrics, { r1: ['r1v1'], r2: ['r2v1'], r3: ['r3v1', 'eski'], r4: [], r5: [] })
    assert.equal((await findRubricVersion('eski', s))?.id, 'eski')
    assert.deepEqual(s.calls.detail, ['r1', 'r2', 'r3'])
    assert.equal(s.calls.maxInFlight, 1)
  })

  test('ilk sayfanın dışındaki rubrik de bulunur; tüm sayfalar bitince null döner', async () => {
    const rubrics = ['r1', 'r2', 'r3'].map((id) => item(id, `${id}v2`, null))
    const s = source(rubrics, { r3: ['uzak'] })
    assert.equal((await findRubricVersion('uzak', s))?.id, 'uzak')
    assert.equal(s.calls.list, 2)
    const none = source(rubrics, {})
    assert.equal(await findRubricVersion('yok', none), null)
    assert.equal(none.calls.detail.length, 3)
  })

  test('boş liste istek atmadan null döner', async () => {
    const s = source([], {})
    assert.equal(await findRubricVersion('x', s), null)
    assert.equal(s.calls.detail.length, 0)
  })

  test('sürüm kimliği yokken (atama yüklenmedi, otomatik puanlı görev) arama yapılmaz', () => {
    assert.equal(shouldLookUpRubric(null, 'k1'), false)
    assert.equal(shouldLookUpRubric('v1', null), false)
    assert.equal(shouldLookUpRubric('v1', 'k1'), true)
  })
})
