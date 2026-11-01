import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  assignmentBody,
  assignmentFormSchema,
  canChangeAssignment,
  defaultAssignment,
  defaultResubmissionLocal,
  formFieldFor,
  resubmissionDueError,
  scoreBody,
  scoreFormSchema,
  scoreState,
  targetsLabel,
  type AssignmentFormValues,
} from '../src/pages/tasks/task-model.ts'

const NOW = Date.parse('2026-11-01T09:00:00.000Z')
const names = { className: (id: string) => `Sınıf ${id}`, studentName: (id: string) => id }

const teacherForm = (extra: Partial<AssignmentFormValues> = {}): AssignmentFormValues => ({
  ...defaultAssignment,
  resourceId: 'r1',
  targets: ['9-A'],
  rubricVersionId: 'rv1',
  dueAt: '2026-11-20T18:00',
  ...extra,
})

describe('görev atama formu (DOM-KYN-032, DOM-BEC-041, 042, 044)', () => {
  test('öğretmen puanlı görev rubrik ve sürüm sınırıyla, Istanbul saatinden UTC son teslimle gider', () => {
    const body = assignmentBody(assignmentFormSchema.parse(teacherForm()), 'v1', 'class')
    assert.equal(body.resourceVersionId, 'v1')
    assert.deepEqual(body.targets, [{ kind: 'class', id: '9-A' }])
    assert.equal(body.settings?.deadline?.dueAt, '2026-11-20T15:00:00.000Z')
    assert.equal(body.settings?.rubricVersionId, 'rv1')
    assert.deepEqual(body.settings?.submission, {
      submissionKind: 'text',
      maxVersions: 3,
      minWords: null,
      maxWords: null,
    })
    assert.deepEqual(body.settings?.attempts, {
      kind: 'evaluation',
      maxAttempts: 1,
      countPolicy: 'first',
    })
  })

  test('otomatik puanlı görevde teslim ayarı ve rubrik gövdeye girmez; hak ve politika gider', () => {
    const values = assignmentFormSchema.parse(
      teacherForm({
        taskType: 'quiz',
        rubricVersionId: '',
        maxAttempts: '2',
        countPolicy: 'highest',
      }),
    )
    const body = assignmentBody(values, 'v2', 'group')
    assert.equal(body.settings?.submission, undefined)
    assert.equal(body.settings?.rubricVersionId, undefined)
    assert.deepEqual(body.settings?.attempts, {
      kind: 'evaluation',
      maxAttempts: 2,
      countPolicy: 'highest',
    })
    assert.deepEqual(body.targets, [{ kind: 'group', id: '9-A' }])
  })

  test('değerlendirmede son teslim, öğretmen görevinde rubrik zorunlu; alıştırmada son teslim boş olabilir', () => {
    const missing = assignmentFormSchema.safeParse(teacherForm({ dueAt: '', rubricVersionId: '' }))
    assert.equal(missing.success, false)
    const paths = missing.error?.issues.map((issue) => issue.path.join('.')) ?? []
    assert.ok(paths.includes('dueAt'))
    assert.ok(paths.includes('rubricVersionId'))
    const practice = assignmentFormSchema.safeParse(teacherForm({ kind: 'practice', dueAt: '' }))
    assert.equal(practice.success, true)
    const body = assignmentBody(
      assignmentFormSchema.parse(teacherForm({ kind: 'practice', dueAt: '' })),
      'v',
      'class',
    )
    assert.equal(body.settings?.deadline?.dueAt, null)
    assert.deepEqual(body.settings?.attempts, { kind: 'practice' })
  })

  test('sürüm sınırı 1-5, geç kabul en çok 7 gün, sözcük alt sınırı üstten büyük olamaz', () => {
    for (const extra of [
      { maxVersions: '6' },
      { maxVersions: '0' },
      { lateAcceptanceDays: '8' },
      { minWords: '200', maxWords: '100' },
    ]) {
      assert.equal(
        assignmentFormSchema.safeParse(teacherForm(extra)).success,
        false,
        JSON.stringify(extra),
      )
    }
  })

  test('sunucu hata yolu form alanına çevrilir, bilinmeyen yol form düzeyi olur', () => {
    assert.equal(formFieldFor('resourceVersionId'), 'resourceId')
    assert.equal(formFieldFor('targets.0'), 'targets')
    assert.equal(formFieldFor('settings.deadline.dueAt'), 'dueAt')
    assert.equal(formFieldFor('settings.rubricVersionId'), 'rubricVersionId')
    assert.equal(formFieldFor('settings.submission.maxWords'), 'maxWords')
    assert.equal(formFieldFor('settings.attempts.countPolicy'), 'countPolicy')
    assert.equal(formFieldFor('baska.yol'), 'root.server')
  })
})

describe('rubrik puan formu (DOM-BEC-020, 021)', () => {
  const values = (band: number | null, comment = '') => ({
    criteria: [{ criterionId: 'task', band, comment }],
    overallComment: 'Güzel bir yazı.',
  })

  test('hedefin altındaki bant (0-2) kriter yorumu ister, 3 ve üstü istemez', () => {
    const low = scoreFormSchema.safeParse(values(2))
    assert.equal(low.success, false)
    assert.deepEqual(low.error?.issues[0]?.path, ['criteria', 0, 'comment'])
    assert.equal(scoreFormSchema.safeParse(values(2, 'Zaman uyumu')).success, true)
    assert.equal(scoreFormSchema.safeParse(values(3)).success, true)
  })

  test('bant seçilmemiş kriter ve kısa genel yorum reddedilir', () => {
    assert.equal(scoreFormSchema.safeParse(values(null)).success, false)
    const short = scoreFormSchema.safeParse({ ...values(4), overallComment: 'ok' })
    assert.equal(short.success, false)
  })

  test('gövde yalnız bant, yorum ve genel yorum taşır; toplam ve yüzde istemciden gitmez', () => {
    const body = scoreBody(values(4, '  '), 2)
    assert.deepEqual(body, {
      versionNumber: 2,
      criteria: [{ criterionId: 'task', band: 4, comment: null }],
      overallComment: 'Güzel bir yazı.',
    })
    for (const key of ['total', 'max', 'percent', 'weighted']) assert.equal(key in body, false)
  })
})

describe('yeniden teslim isteği (DOM-BEC-040)', () => {
  test('varsayılan tarih bir hafta sonrasıdır ve geçerlidir', () => {
    const local = defaultResubmissionLocal(NOW)
    assert.equal(local, '2026-11-08T23:59')
    assert.equal(resubmissionDueError(local, NOW), null)
  })

  test('geçmiş, boş ve 14 günden uzak tarih reddedilir', () => {
    assert.match(resubmissionDueError('', NOW) ?? '', /girin/)
    assert.match(resubmissionDueError('2026-11-01T10:00', NOW) ?? '', /ileri/)
    assert.match(resubmissionDueError('2026-11-20T10:00', NOW) ?? '', /14 gün/)
    assert.equal(resubmissionDueError('2026-11-14T10:00', NOW), null)
  })
})

describe('görev yetkisi ve hedef özeti (DOM-YTK-028)', () => {
  test('atamayı yalnız atayan ve yönetici değiştirir', () => {
    const item = { assignedByUserId: 'u1' }
    assert.equal(canChangeAssignment(item, 'u1', 'ogretmen'), true)
    assert.equal(canChangeAssignment(item, 'u2', 'ogretmen'), false)
    assert.equal(canChangeAssignment(item, 'u9', 'yonetici'), true)
  })

  test('hedef özeti sınıf adlarını ve öğrenci sayısını gösterir', () => {
    const targets = [
      { kind: 'class' as const, id: 'a' },
      { kind: 'class' as const, id: 'b' },
      { kind: 'student' as const, id: 's' },
    ]
    assert.equal(targetsLabel(targets, names), 'Sınıf a, Sınıf b · 1 öğrenci')
    assert.equal(targetsLabel([], names), '—')
  })

  test('puan durumu: puansız, kesinleşmiş ve kesinleşmemiş', () => {
    const base = { latestVersion: null } as never
    assert.equal(scoreState(base).label, 'Teslim yok')
    const version = (score: unknown) => ({ latestVersion: { score } }) as never
    assert.equal(scoreState(version(null)).label, 'Puan bekliyor')
    assert.equal(scoreState(version({ settled: true, percent: 80 })).label, 'Puanlandı · %80')
    assert.equal(scoreState(version({ settled: false, percent: 80 })).label, 'Kesinleşmedi · %80')
  })
})
