import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import type { LearnerTaskProgress } from '@kampus/react-shared/use-learner-task-progress.ts'
import type {
  TaskAssignment,
  TaskAssignmentLearner,
} from '@kampus/react-shared/use-task-assignments.ts'
import { CHILD_SCOPED_PANEL_PARAMS, withChildSwitch } from '../src/lib/child-selection.ts'
import {
  DEFAULT_PARENT_TAB,
  parentTrackingTabs,
  resolveParentTab,
} from '../src/pages/academic/parent-tracking-tabs.ts'
import {
  childAssignments,
  childProgress,
  parentResultOf,
  parentTaskRows,
} from '../src/pages/tasks/parent-task-model.ts'
import { responseLabel, submittedTextLabel } from '../src/pages/tasks/student-task-model.ts'

// Velinin beceri görevleri (OG-992; IST-051, DOM-YTK-028, DOM-BEC-045): sekme, çocuğa daraltma,
// salt okurluk ve velinin dilindeki sonuç metinleri.

const NOW = new Date('2026-10-15T09:00:00.000Z')
const FUTURE = '2026-10-20T20:59:00.000Z'

const entry = (overrides: Partial<LearnerTaskProgress> = {}): LearnerTaskProgress => ({
  learnerId: 's1',
  status: 'pending',
  resubmissionRequested: false,
  attemptId: null,
  submissionId: null,
  lastActivityAt: null,
  used: 0,
  limit: 1,
  remaining: 1,
  canAct: true,
  actionableUntil: null,
  blockedBy: null,
  score: null,
  ...overrides,
})

const auto = (overrides: Partial<TaskAssignmentLearner> = {}): TaskAssignmentLearner => ({
  view: 'learner',
  id: 'as-1',
  resourceId: 'r-1',
  resourceVersionId: 'rv-1',
  title: 'Okuma quizi',
  contentType: 'quiz',
  scoringMode: 'auto',
  kind: 'evaluation',
  attempts: { kind: 'evaluation', maxAttempts: 1, countPolicy: 'first' },
  deadline: { dueAt: FUTURE, lateAcceptanceDays: 0 },
  timeLimitMinutes: null,
  listeningPlays: null,
  hasListening: false,
  showTranscript: false,
  submission: null,
  createdAt: '2026-10-01T09:00:00.000Z',
  learnerIds: ['s1'],
  progress: [entry()],
  ...overrides,
})

const writing = (overrides: Partial<TaskAssignmentLearner> = {}) =>
  auto({
    contentType: 'homework_template',
    scoringMode: 'teacher',
    submission: { submissionKind: 'text', maxVersions: 2, minWords: null, maxWords: null },
    ...overrides,
  })

describe('OG-992: Akademik Takip sekmeleri', () => {
  test('learning açıkken "Beceri görevleri" sekmesi `?sekme=gorevler` ile seçilir', () => {
    const tabs = parentTrackingTabs({ learning: true })
    assert.deepEqual(
      tabs.map((tab) => tab.value),
      ['notlar', 'devamsizlik', 'program', 'odevler', 'quizler', 'gorevler'],
    )
    assert.equal(tabs.at(-1)?.label, 'Beceri görevleri')
    assert.equal(resolveParentTab('gorevler', tabs), 'gorevler')
    assert.equal(resolveParentTab('bilinmeyen', tabs), DEFAULT_PARENT_TAB)
    assert.equal(resolveParentTab(null, tabs), 'notlar')
  })

  test('learning kapalıyken sekme çizilmez, adresteki `gorevler` ilk sekmeye düşer', () => {
    const tabs = parentTrackingTabs({ learning: false })
    assert.equal(
      tabs.some((tab) => tab.value === 'gorevler'),
      false,
    )
    assert.equal(tabs.length, 5)
    assert.equal(resolveParentTab('gorevler', tabs), 'notlar')
    assert.equal(resolveParentTab('gorevler', parentTrackingTabs({})), 'notlar')
  })

  test('çocuk değişince açık görev paneli (`?gorev=`) kapanır, sekme korunur', () => {
    assert.ok((CHILD_SCOPED_PANEL_PARAMS as readonly string[]).includes('gorev'))
    const next = new URLSearchParams(withChildSwitch('?cocuk=s1&sekme=gorevler&gorev=as-1', 's2'))
    assert.equal(next.get('gorev'), null)
    assert.equal(next.get('sekme'), 'gorevler')
    assert.equal(next.get('cocuk'), 's2')
  })
})

describe('OG-992, DOM-YTK-028: seçili çocuğa daraltma', () => {
  const both = auto({
    id: 'as-both',
    learnerIds: ['s1', 's2'],
    progress: [
      entry({
        learnerId: 's1',
        status: 'submitted',
        used: 1,
        attemptId: 'at-1',
        score: { earned: 3, possible: 4, percent: 75 },
      }),
      entry({ learnerId: 's2' }),
    ],
  })
  const onlyEce = auto({ id: 'as-ece', learnerIds: ['s2'], progress: [entry({ learnerId: 's2' })] })
  const staff = { view: 'staff', id: 'as-staff' } as unknown as TaskAssignment
  const items: TaskAssignment[] = [both, onlyEce, staff]

  test('liste yalnız çocuğa hedeflenen kursiyer görünümündeki atamaları içerir', () => {
    assert.deepEqual(
      childAssignments(items, 's1').map((item) => item.id),
      ['as-both'],
    )
    assert.deepEqual(
      childAssignments(items, 's2').map((item) => item.id),
      ['as-both', 'as-ece'],
    )
    assert.deepEqual(childAssignments(items, ''), [])
  })

  test('satırın durumu, hakkı ve puanı o çocuğun özetinden gelir', () => {
    const [deniz] = parentTaskRows([both], 's1', NOW)
    assert.equal(deniz?.status, 'Tamamlandı')
    assert.equal(deniz?.score, '75 / 100')
    assert.equal(deniz?.rights, '1 / 1 deneme')
    const [ece] = parentTaskRows([both], 's2', NOW)
    assert.equal(ece?.status, 'Başlanmadı')
    assert.equal(ece?.score, '—')
    assert.equal(childProgress(both, 's2')?.learnerId, 's2')
    assert.equal(childProgress(both, 's9'), null)
    // Özet yoksa satır "Okunamadı" der, başka çocuğun özetine düşmez.
    assert.equal(parentTaskRows([both], 's9', NOW)[0]?.status, 'Okunamadı')
  })
})

describe('OG-992, DOM-BEC-045: panelde gösterilecek sonuç', () => {
  test('otomatik puanlıda yalnız tamamlanan deneme okunur; süren deneme okunmaz', () => {
    assert.deepEqual(
      parentResultOf(auto(), entry({ status: 'submitted', attemptId: 'at-1', used: 1 })),
      { kind: 'attempt', attemptId: 'at-1' },
    )
    assert.deepEqual(
      parentResultOf(auto(), entry({ status: 'late', attemptId: 'at-2', used: 1 })),
      { kind: 'attempt', attemptId: 'at-2' },
    )
    assert.deepEqual(
      parentResultOf(auto(), entry({ status: 'in_progress', attemptId: 'at-3', used: 1 })),
      { kind: 'running' },
    )
    assert.deepEqual(parentResultOf(auto(), entry()), { kind: 'none' })
    assert.deepEqual(parentResultOf(auto(), entry({ status: 'not_submitted' })), { kind: 'none' })
    assert.deepEqual(parentResultOf(auto(), null), { kind: 'none' })
  })

  test('öğretmen puanlıda gönderilmiş sürüm varsa teslim okunur', () => {
    assert.deepEqual(
      parentResultOf(writing(), entry({ status: 'submitted', submissionId: 'sub-1', used: 1 })),
      { kind: 'submission', submissionId: 'sub-1' },
    )
    assert.deepEqual(parentResultOf(writing(), entry({ submissionId: 'sub-1', used: 0 })), {
      kind: 'none',
    })
  })
})

describe('OG-992: velinin dili ve salt okurluk', () => {
  test('AttemptResult `audience=\'parent\'`: "Çocuğunuzun cevabı:"', () => {
    assert.equal(responseLabel('parent'), 'Çocuğunuzun cevabı: ')
    assert.equal(responseLabel('learner'), 'Cevabınız: ')
    assert.equal(responseLabel('staff'), 'Öğrencinin cevabı: ')
    assert.equal(submittedTextLabel('parent'), 'Çocuğunuzun gönderdiği metni göster')
    assert.equal(submittedTextLabel('learner'), 'Gönderdiğiniz metni göster')
    const result = readFileSync(
      new URL('../src/pages/tasks/AttemptResult.tsx', import.meta.url),
      'utf8',
    )
    assert.match(result, /responseLabel\(audience\)/)
  })

  test('veli bölümü yazma kancası ve çalışma alanı kullanmaz; itiraz (DOM-BEC-025) yalnız sürüm listesindedir', () => {
    const source = readFileSync(
      new URL('../src/pages/tasks/ParentTaskSection.tsx', import.meta.url),
      'utf8',
    )
    for (const forbidden of [
      /useStart|useSubmit|useSave|useApiCommand|useFileTaskAppeal|useDecideTaskAppeal|Resubmission/,
      /QUIZ_PARAM|WRITING_PARAM|StudentQuizWorkspace|StudentWritingWorkspace/,
      /AttemptPlayer|WritingEditor|SpeakingRecorder/,
    ])
      assert.doesNotMatch(source, forbidden)
    // Veli itiraz eder (API `fileTaskAppeal` veliye izinli); düğme ve form SubmissionVersions'tadır.
    assert.match(source, /submissionId=\{submission\.id\}/)
    assert.match(source, /audience="parent"/g)
    assert.equal(source.match(/audience="parent"/g)?.length, 2)
    assert.match(source, /Bu çocuğa atanmış görev yok\./)
  })
})
