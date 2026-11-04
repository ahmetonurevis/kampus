import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type {
  GradingQueueItem,
  SecondRatingSample,
  TaskVersionGrading,
} from '@kampus/react-shared/use-task-grading.ts'
import type { TaskSubmissionDetail } from '@kampus/react-shared/use-task-submissions.ts'
import {
  AWAITING_OPTIONS,
  blindVersionView,
  isAwaitingFilter,
  queueAction,
  queueStatus,
  requestState,
  sampleDrawnText,
  sampleState,
  SCORE_FORM_COPY,
  secondScoringState,
  showsSecondStaleNotice,
} from '../src/pages/tasks/second-rating-model.ts'

const assignment = (extra: Partial<Parameters<typeof sampleState>[0]> = {}) => ({
  rubricVersionId: 'rv1',
  secondRatingPercent: 20,
  secondRatingSampledAt: null,
  deadline: { dueAt: '2026-11-01T20:59:59.000Z', lateAcceptanceDays: 0 },
  ...extra,
})

describe('sampleState (OG-210; DOM-BEC-024)', () => {
  test('örneklemsiz ya da rubriksiz görevde bölüm yok', () => {
    assert.equal(sampleState(assignment({ secondRatingPercent: 0 })).kind, 'none')
    assert.equal(sampleState(assignment({ rubricVersionId: null })).kind, 'none')
  })

  test('seçilmemiş örneklem çekilebilir; süreyi sunucu denetler', () => {
    const state = sampleState(assignment())
    assert.equal(state.kind, 'drawable')
    assert.match(state.text, /%20/)
    assert.match(state.text, /geç kabul dahil/)
  })

  test('seçilmiş örneklem sunucu alanından tarihle yazılır, çekilemez', () => {
    const state = sampleState(assignment({ secondRatingSampledAt: '2026-11-02T10:00:00.000Z' }))
    assert.equal(state.kind, 'drawn')
    assert.match(state.text, /seçildi/)
  })

  test('son tarihsiz görevde örneklem seçilmez, elle istem önerilir', () => {
    const state = sampleState(
      assignment({ deadline: { dueAt: null, lateAcceptanceDays: 0 } as never }),
    )
    assert.equal(state.kind, 'unavailable')
    assert.match(state.text, /teslim bazında/)
  })

  test('başarı metni sunucunun havuz ve seçim sayısından gelir', () => {
    const sample = { submissionCount: 12, submissionIds: ['a', 'b', 'c'] } as SecondRatingSample
    assert.equal(
      sampleDrawnText(sample),
      'Örneklem seçildi: 12 teslimden 3 tanesi ikinci puanlanacak.',
    )
  })
})

describe('requestState', () => {
  test('puanlanmamış sürümde istem açılır', () => {
    const state = requestState({ status: 'unscored', secondRatingRequested: false })
    assert.equal(state.kind, 'available')
  })

  test('istenmiş sürümde durum yazılır, düğme yok', () => {
    const state = requestState({ status: 'pending', secondRatingRequested: true })
    assert.equal(state.kind, 'requested')
  })

  test('puanı oluşmuş ya da ayrıntısız sürümde bölüm kapalı', () => {
    assert.equal(requestState({ status: 'settled', secondRatingRequested: false }).kind, 'closed')
    assert.equal(requestState(null).kind, 'closed')
  })
})

describe('secondScoringState (kör puan)', () => {
  const grading = (extra: Partial<TaskVersionGrading> = {}) => ({
    status: 'pending' as const,
    missing: 'second' as const,
    scoredByViewer: false,
    ...extra,
  })

  test('ikinci puan bekleyen sürümde kör form açılır', () => {
    assert.equal(secondScoringState(grading()).kind, 'blind')
  })

  test('ilk puanı veren kişi ikinci puanlayamaz', () => {
    const state = secondScoringState(grading({ scoredByViewer: true }))
    assert.equal(state.kind, 'own')
    assert.match('text' in state ? state.text : '', /başka bir öğretmen/)
  })

  test('ilk puan bekleyen, kesinleşen ve ayrıntısız sürümde kör form yok', () => {
    assert.equal(secondScoringState(grading({ missing: 'first' })).kind, 'none')
    assert.equal(secondScoringState(grading({ status: 'settled', missing: null })).kind, 'none')
    assert.equal(
      secondScoringState(grading({ status: 'disagreement', missing: null })).kind,
      'none',
    )
    assert.equal(secondScoringState(null).kind, 'none')
  })
})

describe('blindVersionView: ilk puan gösterilmez (DOM-BEC-024)', () => {
  const SECRET = 'GIZLI-ILK-PUAN-YORUMU'
  const version = {
    id: 'v1',
    number: 2,
    submittedAt: '2026-11-01T09:00:00.000Z',
    late: false,
    body: 'Öğrencinin metni',
    wordCount: { count: 120, warning: null },
    files: [],
    score: {
      settled: false,
      total: 9,
      max: 20,
      percent: 45,
      overallComment: SECRET,
      criteria: [{ criterionId: 'task', band: 3, comment: SECRET }],
    },
    grading: {
      status: 'pending',
      missing: 'second',
      raterScores: [{ raterRole: 'first', score: { overallComment: SECRET } }],
    },
  } as unknown as TaskSubmissionDetail['versions'][number]

  test('yanıtta ilk puan gelse bile görünümde puan ve puanlayıcı alanı yoktur', () => {
    const view = blindVersionView(version)
    assert.equal('score' in view, false)
    assert.equal('grading' in view, false)
    assert.equal(JSON.stringify(view).includes(SECRET), false)
    assert.equal(JSON.stringify(view).includes('raterScores'), false)
  })

  test('teslim içeriği korunur', () => {
    const view = blindVersionView(version)
    assert.equal(view.number, 2)
    assert.equal(view.body, 'Öğrencinin metni')
    assert.equal(view.wordCount, 120)
    assert.equal(view.late, false)
  })
})

describe('queueStatus ve queueAction', () => {
  const item = (
    grading: Partial<GradingQueueItem['grading']>,
    status: GradingQueueItem['status'] = 'submitted',
  ) =>
    ({
      status,
      grading: {
        awaiting: ['first'],
        awaitingResolution: false,
        samplePending: false,
        dueAt: null,
        overdue: false,
        ...grading,
      },
    }) as Pick<GradingQueueItem, 'status' | 'grading'>

  test('yalnız ikinci puan bekleyen satır ayrıdır ve kör puanlamaya gider', () => {
    const status = queueStatus(item({ awaiting: ['second'] }))
    assert.deepEqual(status, { label: 'İkinci puan bekliyor', tone: 'purple', phase: 'second' })
    assert.equal(queueAction(status.phase, 'Deniz').label, 'İkinci puanla')
    assert.match(queueAction(status.phase, 'Deniz').ariaLabel, /ikinci puanla/)
  })

  test('örneklem beklerken ilk puan verilemez, durum bunu söyler', () => {
    const status = queueStatus(item({ samplePending: true }))
    assert.equal(status.label, 'Örneklem bekliyor')
    assert.equal(status.phase, 'first')
  })

  test('hem ilk hem ikinci puan bekleyen satır ilk puan akışındadır', () => {
    const status = queueStatus(item({ awaiting: ['first', 'second'] }))
    assert.equal(status.label, 'İlk ve ikinci puan bekliyor')
    assert.equal(status.phase, 'first')
  })

  test('uyuşmazlık son puan bekler', () => {
    const status = queueStatus(item({ awaiting: [], awaitingResolution: true }))
    assert.equal(status.phase, 'resolution')
    assert.equal(status.label, 'Son puan bekliyor')
  })

  test('olağan satır teslim durumunu korur', () => {
    const status = queueStatus(item({}, 'late'))
    assert.equal(status.label, 'Geç teslim')
    assert.equal(queueAction(status.phase, 'Deniz').label, 'Puanla')
  })
})

describe('süzgeç ve hata kodları', () => {
  test('bekleyen puan süzgeci yalnız ilk ve ikinciyi tanır', () => {
    assert.equal(isAwaitingFilter('second'), true)
    assert.equal(isAwaitingFilter('resolution'), false)
    assert.equal(isAwaitingFilter(''), false)
    assert.deepEqual(
      AWAITING_OPTIONS.map((item) => item.value),
      ['', 'first', 'second'],
    )
  })

  test('kör puan eskime hataları pencerede uyarı olur', () => {
    for (const code of ['version_conflict', 'rubric_score_exists', 'second_rating_not_requested']) {
      assert.equal(showsSecondStaleNotice({ code }), true, code)
    }
    assert.equal(showsSecondStaleNotice({ code: 'not_found' }), false)
  })

  test('ikinci puan formu kör puanlamayı anlatır', () => {
    assert.match(SCORE_FORM_COPY.second.note, /size gösterilmez/)
    assert.equal(SCORE_FORM_COPY.second.submit, 'İkinci puanı kaydet')
  })
})
