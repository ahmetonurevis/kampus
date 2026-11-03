import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type {
  GradingQueueItem,
  TaskScore,
  TaskVersionGrading,
} from '@kampus/react-shared/use-task-grading.ts'
import {
  compareRaterScores,
  disputeRow,
  finalScoreState,
  finalStaleText,
  showsFinalStaleNotice,
} from '../src/pages/tasks/dispute-model.ts'

const CRITERIA = [
  { id: 'task', aspect: 'task_fulfilment' },
  { id: 'grammar', aspect: 'grammatical_accuracy' },
]

const score = (bands: Record<string, number>): TaskScore => ({
  settled: false,
  rubricVersionId: 'rv1',
  total: 0,
  max: 10,
  percent: 0,
  scoredAt: '2026-11-01T09:00:00.000Z',
  criteria: Object.entries(bands).map(([criterionId, band]) => ({
    criterionId,
    band,
    weight: 1,
    weighted: band,
    meaning: 'target' as const,
    comment: null,
  })),
  overallComment: 'Genel yorum',
})

const grading = (extra: Partial<TaskVersionGrading> = {}): TaskVersionGrading => ({
  status: 'disagreement',
  missing: null,
  secondRatingRequested: true,
  disagreementCriterionIds: ['task'],
  raterScores: [
    { raterRole: 'first', score: score({ task: 5, grammar: 3 }) },
    { raterRole: 'second', score: score({ task: 2, grammar: 4 }) },
  ],
  canResolve: true,
  dueAt: '2026-11-10T20:59:59.000Z',
  overdue: false,
  ...extra,
})

describe('uyuşmazlık kuyruğu ve son puan penceresi (OG-058; DOM-BEC-024, DOM-YTK-027)', () => {
  test('DOM-BEC-024: kuyruk satırı görev başlığını satırdan alır; başlık yoksa genel etiket, süre aşımı işaretli', () => {
    const item = {
      id: 'sub1',
      assignmentId: 'a1',
      learnerId: 's1',
      learnerName: 'Deniz Yılmaz',
      assignmentTitle: 'Hafta sonu yazısı',
      latestVersion: { submittedAt: '2026-11-01T09:00:00.000Z' },
      grading: { dueAt: '2026-11-08T20:59:59.000Z', overdue: true },
    } as unknown as GradingQueueItem
    const row = disputeRow(item)
    assert.equal(row.learner, 'Deniz Yılmaz')
    assert.equal(row.assignment, 'Hafta sonu yazısı')
    assert.equal(row.overdue, true)
    assert.notEqual(row.dueAt, '—')
    const untitled = disputeRow({ ...item, assignmentTitle: null })
    assert.equal(untitled.assignment, 'Görev')
    // OG-213, DOM-YTK-028: ad satırdan gelir; sunucu null verirse genel etiket.
    assert.equal(disputeRow({ ...item, learnerName: null }).learner, 'Öğrenci')
  })

  test('DOM-BEC-024: iki puan kriter bazında rubrik sırasıyla yan yana; uyuşmazlık işareti sunucunun listesidir', () => {
    const rows = compareRaterScores(CRITERIA, grading())
    assert.deepEqual(
      rows.map((row) => [row.criterionId, row.first, row.second, row.disputed]),
      [
        ['task', 5, 2, true],
        // Tam bir bant fark uyuşmazlık değildir; istemci yeniden hesaplamaz.
        ['grammar', 3, 4, false],
      ],
    )
    assert.equal(rows[0]?.label, 'Görevin yerine getirilmesi')
  })

  test('DOM-YTK-027: puanlayıcı koordinatör kördür; görmediği puan boş kalır', () => {
    const rows = compareRaterScores(
      CRITERIA,
      grading({ raterScores: [{ raterRole: 'first', score: score({ task: 5, grammar: 3 }) }] }),
    )
    assert.deepEqual(
      rows.map((row) => [row.first, row.second]),
      [
        [5, null],
        [3, null],
      ],
    )
  })

  test('DOM-BEC-024: form yalnız canResolve iken açılır; veremeyen (puanlayıcı ya da alan dışı), kesinleşmiş ve uyuşmazlıksız durumda nedeni yazılır', () => {
    assert.deepEqual(finalScoreState(grading()), { kind: 'resolve' })
    const rater = finalScoreState(grading({ canResolve: false }))
    assert.equal(rater.kind, 'notice')
    assert.match(
      rater.kind === 'notice' ? rater.text : '',
      /Son puanı siz veremezsiniz \(puanlayıcısınız ya da alanınız dışında\)/,
    )
    const settled = finalScoreState(
      grading({
        status: 'settled',
        canResolve: false,
        raterScores: [{ raterRole: 'final', score: score({ task: 4, grammar: 4 }) }],
      }),
    )
    assert.equal(settled.kind === 'notice' ? settled.label : '', 'Kesinleşti')
    assert.match(settled.kind === 'notice' ? settled.text : '', /Son puan verildi/)
    const none = finalScoreState(grading({ status: 'pending', canResolve: false }))
    assert.equal(none.kind === 'notice' ? none.label : '', 'Uyuşmazlık yok')
    assert.equal(finalScoreState(null).kind, 'notice')
  })

  test('DOM-BEC-024: başka koordinatörün son puanı ve sürüm çakışması pencerede uyarılır; diğer hatalar toastta kalır', () => {
    for (const code of ['version_conflict', 'version_not_latest', 'final_score_not_needed'])
      assert.equal(showsFinalStaleNotice({ code }), true, code)
    for (const code of ['coordinator_required', 'rater_not_independent', 'not_found'])
      assert.equal(showsFinalStaleNotice({ code }), false, code)
    assert.match(finalStaleText(true), /yeniden kaydedin/)
    assert.match(finalStaleText(false), /artık bu ekrandan verilemez/)
  })
})
