import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { ApiError } from '../packages/api-client/src/errors.ts'
import { GRADE_MESSAGES } from '../packages/react-shared/src/use-academic-commands.ts'
import {
  runGradeSave,
  settleSave,
  type ExistingGrade,
  type GradeSaveItem,
  type SendOutcome,
} from '../apps/mobile/src/api/grade-entry.ts'

const apiError = (status: number, code: string, message = 'Sunucu mesajı') =>
  new ApiError({ status, code, message, requestId: 'test-req' })

const grade = (studentId: string, score: number, version: number): ExistingGrade => ({
  id: `g-${studentId}`,
  version,
  studentId,
  score,
  fromQuiz: false,
})

const items: GradeSaveItem[] = [
  { kind: 'create', studentId: 's1', score: 90 },
  { kind: 'unchanged', studentId: 's2' },
  { kind: 'update', studentId: 's3', score: 75, gradeId: 'g-s3', version: 4 },
  { kind: 'create', studentId: 's4', score: 60 },
  { kind: 'update', studentId: 's5', score: 65, gradeId: 'g-s5', version: 4 },
]
const ok: SendOutcome = { status: 'success' }
const fail = (status: number, code: string): SendOutcome => ({
  status: 'failed',
  error: apiError(status, code),
})

describe('OG-062 mobil not girişi: kayıt turu', () => {
  test('DOM-AKD-004 yalnız gönderilecek notlar sırayla ve tek istekle gider', async () => {
    const sent: string[] = []
    const results = await runGradeSave(items, async (item) => {
      sent.push(`${item.kind}:${item.studentId}`)
      return ok
    })
    assert.deepEqual(sent, ['create:s1', 'update:s3', 'create:s4', 'update:s5'])
    assert.deepEqual(Object.keys(results), ['s1', 's3', 's4', 's5'])
    assert.deepEqual(results['s3'], { status: 'saved', kind: 'update', score: 75 })
  })

  test('DOM-AKD-054 kural hatasında sıradakine geçilir ve ileti Türkçedir', async () => {
    const sent: string[] = []
    const results = await runGradeSave(items, async (item) => {
      sent.push(item.studentId)
      return item.studentId === 's1' ? fail(403, 'grade_assignment_forbidden') : ok
    })
    assert.deepEqual(sent, ['s1', 's3', 's4', 's5'])
    assert.deepEqual(results['s1'], {
      status: 'failed',
      message: GRADE_MESSAGES.grade_assignment_forbidden,
      conflict: false,
    })
    assert.equal(results['s5']?.status, 'saved')
  })

  test('belirsiz hatada (5xx) durulur; kalanlar gönderilmez ve skipped olur', async () => {
    const sent: string[] = []
    const results = await runGradeSave(items, async (item) => {
      sent.push(item.studentId)
      return item.studentId === 's3' ? fail(503, 'unavailable') : ok
    })
    assert.deepEqual(sent, ['s1', 's3'])
    assert.equal(results['s1']?.status, 'saved')
    assert.equal(results['s3']?.status, 'failed')
    assert.deepEqual(results['s4'], { status: 'skipped' })
    assert.deepEqual(results['s5'], { status: 'skipped' })
  })

  test('oturum hatasında (401) durulur ve oturum iletisi yazılır', async () => {
    const sent: string[] = []
    const results = await runGradeSave(items, async (item) => {
      sent.push(item.studentId)
      return fail(401, 'unauthorized')
    })
    assert.deepEqual(sent, ['s1'])
    const first = results['s1']
    assert.equal(
      first?.status === 'failed' && first.message,
      'Oturum sona erdi; yeniden giriş yapın.',
    )
    assert.deepEqual(results['s3'], { status: 'skipped' })
  })

  test('DOM-AKD-051 sürüm çakışması (409) işaretlenir ve sıradakine geçilir', async () => {
    const results = await runGradeSave(items, async (item) =>
      item.studentId === 's3' ? fail(409, 'version_conflict') : ok,
    )
    const conflicted = results['s3']
    assert.equal(conflicted?.status === 'failed' && conflicted.conflict, true)
    assert.equal(results['s4']?.status, 'saved')
  })

  test('aynı gün aynı tür çakışması (409 grade_duplicate) sürüm çakışması sayılmaz', async () => {
    const results = await runGradeSave(items.slice(0, 1), async () => fail(409, 'grade_duplicate'))
    const duplicate = results['s1']
    assert.equal(duplicate?.status === 'failed' && duplicate.conflict, false)
  })

  test('meşgul yanıt gönderilmemiş sayılır', async () => {
    const results = await runGradeSave(items.slice(0, 1), async () => ({ status: 'busy' }))
    assert.deepEqual(results['s1'], { status: 'skipped' })
  })
})

describe('OG-062 mobil not girişi: kayıttan sonra sabitleme', () => {
  const sendItems: GradeSaveItem[] = ['s3', 's5', 's6', 's7'].map((studentId) => ({
    kind: 'update',
    studentId,
    score: 80,
    gradeId: `g-${studentId}`,
    version: 4,
  }))
  const pins = { 'g-s3': 4, 'g-s5': 4, 'g-s6': 4, 'g-s7': 4 }

  test('yalnız kaydedilen ve çakışan not yeniden sabitlenir, atlananın sürümü korunur', () => {
    const fresh = new Map(['s3', 's5', 's6', 's7'].map((id) => [id, grade(id, 50, 9)]))
    const settled = settleSave({
      items: sendItems,
      results: {
        s3: { status: 'saved', kind: 'update', score: 80 },
        s5: { status: 'skipped' },
        s6: { status: 'failed', message: 'Sunucu iletisi.', conflict: true },
        s7: { status: 'failed', message: 'Yetki yok.', conflict: false },
      },
      pins,
      fresh,
    })
    // Atlanan (s5) ve başka nedenle başarısız (s7) notun sabit sürümü 4 kalır: başka cihazın
    // düzeltmesi sonraki denemede 409 ile yakalanır.
    assert.deepEqual(settled.pins, { 'g-s3': 9, 'g-s5': 4, 'g-s6': 9, 'g-s7': 4 })
  })

  test('409 iletisine sunucudaki güncel puan eklenir; diğer iletiler değişmez', () => {
    const fresh = new Map(['s6', 's7'].map((id) => [id, grade(id, 50, 9)]))
    const settled = settleSave({
      items: sendItems,
      results: {
        s6: { status: 'failed', message: 'Kayıt değişti.', conflict: true },
        s7: { status: 'failed', message: 'Yetki yok.', conflict: false },
      },
      pins,
      fresh,
    })
    const conflicted = settled.results['s6']
    assert.equal(
      conflicted?.status === 'failed' && conflicted.message,
      'Kayıt değişti. Sunucuda 50 olarak değişti.',
    )
    const plain = settled.results['s7']
    assert.equal(plain?.status === 'failed' && plain.message, 'Yetki yok.')
  })

  test('tazeleme başarısızsa sabitleme ve iletiler değişmez', () => {
    const results = {
      s3: { status: 'failed', message: 'Çakıştı.', conflict: true },
    } as const
    const settled = settleSave({
      items: sendItems.slice(0, 1),
      results,
      pins: { 'g-s3': 4 },
      fresh: null,
    })
    assert.deepEqual(settled.pins, { 'g-s3': 4 })
    assert.deepEqual(settled.results, results)
  })

  test('sabitleme yokken (null) tazelenen liste sabitleme üretmez, kayıtlar eklenir', () => {
    const fresh = new Map([['s1', grade('s1', 90, 1)]])
    const settled = settleSave({
      items: [{ kind: 'create', studentId: 's1', score: 90 }],
      results: { s1: { status: 'saved', kind: 'create', score: 90 } },
      pins: null,
      fresh,
    })
    // Yeni açılan not ilk sürümüyle sabitlenir.
    assert.deepEqual(settled.pins, { 'g-s1': 1 })
  })
})
