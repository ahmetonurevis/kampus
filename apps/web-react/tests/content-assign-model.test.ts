import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { ContentAssignmentResults } from '@kampus/react-shared/use-content-assignments.ts'
import { assignmentBatchInputSchema } from '@kampus/school-core/skills/assignment.ts'
import {
  averageLabel,
  batchBody,
  batchFieldFor,
  canAssignContent,
  contentAssignDefaults,
  contentAssignFormSchema,
  contentTaskType,
  resultRows,
  resultTotalsLabel,
  targetKindOptions,
  type ContentAssignFormValues,
} from '../src/pages/content/content-assign-model.ts'

const names = { className: (id: string) => `Sınıf ${id}` }

const quizForm = (extra: Partial<ContentAssignFormValues> = {}): ContentAssignFormValues => ({
  ...contentAssignDefaults('quiz', 'school'),
  rows: [
    { kind: 'class', id: '9-A', dueAt: '2026-11-20T18:00' },
    { kind: 'class', id: '9-B', dueAt: '2026-11-22T09:30' },
  ],
  ...extra,
})

const messages = (values: ContentAssignFormValues) => {
  const parsed = contentAssignFormSchema.safeParse(values)
  return parsed.success
    ? {}
    : Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message]))
}

describe('içerikten atama: atanabilirlik (IST-034, DOM-BEC-049)', () => {
  test('IST-034: yalnız görev türleri atanır', () => {
    assert.equal(contentTaskType('quiz'), 'quiz')
    assert.equal(contentTaskType('homework_template'), 'homework_template')
    assert.equal(contentTaskType('reading_passage'), null)
  })

  test('DOM-BEC-049: Ata yalnız yönetici/öğretmende ve güncel yayındaki sürümde görünür', () => {
    const base = {
      role: 'ogretmen',
      contentType: 'quiz',
      currentVersionId: 'v1',
      currentStatus: 'published',
    }
    assert.equal(canAssignContent(base), true)
    assert.equal(canAssignContent({ ...base, role: 'yonetici' }), true)
    assert.equal(canAssignContent({ ...base, role: 'ogrenci' }), false)
    assert.equal(canAssignContent({ ...base, role: 'veli' }), false)
    assert.equal(canAssignContent({ ...base, contentType: 'reading_passage' }), false)
    assert.equal(canAssignContent({ ...base, currentVersionId: null, currentStatus: null }), false)
    assert.equal(canAssignContent({ ...base, currentStatus: 'archived' }), false)
  })

  test('hedef türü kurum türüne göre: okulda sınıf, dil okulunda grup; öğrenci ikisinde de', () => {
    assert.deepEqual(
      targetKindOptions('school').map((o) => o.value),
      ['class', 'student'],
    )
    assert.deepEqual(
      targetKindOptions('language_school').map((o) => o.value),
      ['group', 'student'],
    )
    assert.equal(contentAssignDefaults('quiz', 'language_school').rows[0]?.kind, 'group')
  })
})

describe('içerikten atama formu (DOM-BEC-049)', () => {
  test('DOM-BEC-049: her satır kendi son tarihiyle ayrı atama olur; Istanbul saati UTC ISO olur', () => {
    const { body, rowsOfItem } = batchBody(contentAssignFormSchema.parse(quizForm()), 'v1')
    assert.equal(body.items.length, 2)
    assert.deepEqual(rowsOfItem, [[0], [1]])
    assert.deepEqual(body.items[0]?.targets, [{ kind: 'class', id: '9-A' }])
    assert.equal(body.items[0]?.settings?.deadline?.dueAt, '2026-11-20T15:00:00.000Z')
    assert.deepEqual(body.items[1]?.targets, [{ kind: 'class', id: '9-B' }])
    assert.equal(body.items[1]?.settings?.deadline?.dueAt, '2026-11-22T06:30:00.000Z')
    assert.ok(body.items.every((item) => item.resourceVersionId === 'v1'))
    // Sunucunun toplu şemasından geçer (tek atama gövdeleri, aynı sürüm, tekil hedef).
    assert.equal(assignmentBatchInputSchema.safeParse(body).success, true)
  })

  test('DOM-BEC-049: aynı son tarihli satırlar tek atamada birleşir', () => {
    const values = quizForm({
      rows: [
        { kind: 'class', id: '9-A', dueAt: '2026-11-20T18:00' },
        { kind: 'class', id: '9-B', dueAt: '2026-11-22T09:30' },
        { kind: 'student', id: 's1', dueAt: '2026-11-20T18:00' },
      ],
    })
    const { body, rowsOfItem } = batchBody(contentAssignFormSchema.parse(values), 'v1')
    assert.equal(body.items.length, 2)
    assert.deepEqual(rowsOfItem, [[0, 2], [1]])
    assert.deepEqual(body.items[0]?.targets, [
      { kind: 'class', id: '9-A' },
      { kind: 'student', id: 's1' },
    ])
  })

  test('DOM-BEC-049: aynı hedef iki satırda seçilemez; boş hedef reddedilir', () => {
    const errors = messages(
      quizForm({
        rows: [
          { kind: 'class', id: '9-A', dueAt: '2026-11-20T18:00' },
          { kind: 'class', id: '9-A', dueAt: '2026-11-22T18:00' },
          { kind: 'class', id: '', dueAt: '2026-11-22T18:00' },
        ],
      }),
    )
    assert.equal(errors['rows.1.id'], 'Bu hedef zaten seçildi.')
    assert.equal(errors['rows.2.id'], 'Bir hedef seçin.')
    assert.equal(errors['rows.0.id'], undefined)
  })

  test('değerlendirmede her satıra son teslim zorunlu, alıştırmada isteğe bağlı', () => {
    const rows = [{ kind: 'class' as const, id: '9-A', dueAt: '' }]
    assert.equal(
      messages(quizForm({ rows }))['rows.0.dueAt'],
      'Değerlendirme görevine son teslim girin.',
    )
    assert.deepEqual(messages(quizForm({ rows, kind: 'practice' })), {})
    const invalid = [{ kind: 'class' as const, id: '9-A', dueAt: '2026-02-30T10:00' }]
    assert.equal(
      messages(quizForm({ rows: invalid }))['rows.0.dueAt'],
      'Geçerli bir tarih ve saat girin.',
    )
    const { body } = batchBody(
      contentAssignFormSchema.parse(quizForm({ rows, kind: 'practice' })),
      'v1',
    )
    assert.equal(body.items[0]?.settings?.deadline?.dueAt, null)
  })

  test('en az bir, en çok 20 satır; ayar denetimi tek atamayla aynı', () => {
    assert.equal(messages(quizForm({ rows: [] }))['rows'], 'En az bir hedef ekleyin.')
    const many = Array.from({ length: 21 }, (_, index) => ({
      kind: 'class' as const,
      id: `s${index}`,
      dueAt: '2026-11-20T18:00',
    }))
    assert.match(messages(quizForm({ rows: many }))['rows'] ?? '', /en fazla 20/)
    const homework = { ...quizForm(), taskType: 'homework_template' as const }
    assert.equal(messages(homework)['rubricVersionId'], 'Bir rubrik seçin.')
    assert.match(
      messages(quizForm({ countPolicy: 'highest', maxAttempts: '1' }))['countPolicy'] ?? '',
      /deneme hakkı/,
    )
  })

  test('öğretmen puanlı ödevde teslim ve rubrik her öğeye girer, dinleme hakkı girmez', () => {
    const values = { ...quizForm(), taskType: 'homework_template' as const, rubricVersionId: 'rv1' }
    const { body } = batchBody(contentAssignFormSchema.parse(values), 'v1', true)
    for (const item of body.items) {
      assert.equal(item.settings?.rubricVersionId, 'rv1')
      assert.equal(item.settings?.submission?.submissionKind, 'text')
      assert.equal('listeningPlays' in (item.settings ?? {}), false)
    }
  })

  test('dinleme kaydına bağlı quizde hak her öğeye girer', () => {
    const { body } = batchBody(
      contentAssignFormSchema.parse(quizForm({ listeningPlays: 'unlimited' })),
      'v1',
      true,
    )
    assert.ok(body.items.every((item) => item.settings?.listeningPlays === null))
  })
})

describe('sunucu hata yolu satıra eşlenir (DOM-BEC-049)', () => {
  const rowsOfItem = [[0, 2], [1]]
  test('DOM-BEC-049: items.<öğe>.targets.<sıra> ilgili satırın hedef alanına düşer', () => {
    assert.equal(batchFieldFor('items.0.targets.1', rowsOfItem), 'rows.2.id')
    assert.equal(batchFieldFor('items.0.targets.1.kind', rowsOfItem), 'rows.2.id')
    assert.equal(batchFieldFor('items.1.targets.0', rowsOfItem), 'rows.1.id')
    // Çakışma (assignment_overlap) yolu sırasızdır: öğenin ilk satırı.
    assert.equal(batchFieldFor('items.1.targets', rowsOfItem), 'rows.1.id')
  })

  test('son tarih hatası satırın son tarih alanına, ayar hatası ortak alana düşer', () => {
    assert.equal(batchFieldFor('items.1.settings.deadline.dueAt', rowsOfItem), 'rows.1.dueAt')
    assert.equal(batchFieldFor('items.0.settings.rubricVersionId', rowsOfItem), 'rubricVersionId')
    assert.equal(batchFieldFor('items.0.settings.attempts.maxAttempts', rowsOfItem), 'maxAttempts')
    assert.equal(
      batchFieldFor('items.0.settings.deadline.lateAcceptanceDays', rowsOfItem),
      'lateAcceptanceDays',
    )
  })

  test('bilinmeyen öğe ya da sürüm hatası form düzeyidir', () => {
    assert.equal(batchFieldFor('items.5.targets.0', rowsOfItem), 'root.server')
    assert.equal(batchFieldFor('items.0.resourceVersionId', rowsOfItem), 'root.server')
    assert.equal(batchFieldFor('items', rowsOfItem), 'root.server')
    assert.equal(batchFieldFor('institutionId', rowsOfItem), 'root.server')
  })
})

describe('içeriğe bağlı sonuç özeti (DOM-BEC-036)', () => {
  const tally = { learners: 0, completed: 0, scored: 0, averagePercent: null }
  const results: ContentAssignmentResults = {
    resourceId: 'r1',
    computedAt: '2026-11-03T09:00:00.000Z',
    truncated: false,
    assignments: [
      {
        assignmentId: 'a1',
        title: 'Past Simple Quiz',
        kind: 'evaluation',
        scoringMode: 'auto',
        deadline: { dueAt: '2026-11-20T15:00:00.000Z', lateAcceptanceDays: 0 },
        createdAt: '2026-11-03T08:00:00.000Z',
        targets: [
          { kind: 'class', id: '9-A', learners: 24, completed: 3, scored: 2, averagePercent: 72.5 },
          { kind: 'student', id: 's1', learners: 1, completed: 0, scored: 0, averagePercent: null },
        ],
        totals: { learners: 25, completed: 3, scored: 2, averagePercent: 72.5 },
      },
    ],
    totals: { ...tally, learners: 25, completed: 3, scored: 2, averagePercent: 72.5 },
  }

  test('DOM-BEC-036: atama ve hedef başına satır; ortalama Türkçe biçimde', () => {
    const rows = resultRows(results, names)
    assert.equal(rows.length, 2)
    assert.equal(rows[0]?.target, 'Sınıf 9-A')
    assert.equal(rows[0]?.completed, '3/24')
    assert.equal(rows[0]?.average, '%72,5')
    assert.equal(rows[0]?.kind, 'Değerlendirme')
    assert.match(rows[0]?.dueAt ?? '', /20 Kas 2026/)
    assert.equal(rows[1]?.target, 'Öğrenci')
    assert.equal(rows[1]?.average, '—')
  })

  test('DOM-BEC-036: toplam satırı ve ortalama biçimi', () => {
    assert.equal(
      resultTotalsLabel(results),
      '1 atama · 25 kursiyer · 3 tamamlayan · ortalama %72,5',
    )
    assert.equal(averageLabel(80), '%80')
    assert.equal(averageLabel(null), '—')
  })
})
