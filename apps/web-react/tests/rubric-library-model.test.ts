import assert from 'node:assert/strict'
import { test } from 'node:test'
import type {
  RubricDetail,
  RubricListItem,
  RubricVersion,
} from '@kampus/react-shared/use-rubrics.ts'
import {
  alignmentLabel,
  defaultRubricForm,
  editTarget,
  formFieldFor,
  formFromVersion,
  NEW_RUBRIC,
  parseFormTarget,
  rubricActions,
  rubricBodyFromForm,
  rubricListQuery,
  rubricRow,
  sharedAlignment,
  totalAssignments,
  usageLabel,
  validateRubricForm,
  versionHistory,
  versionTarget,
  weightShares,
  withAddedCriterion,
  withKind,
  withSkill,
  type RubricFormValues,
} from '../src/pages/rubrics/rubric-library-model.ts'

const AT = '2026-10-20T09:00:00.000Z'
const cefr = {
  kind: 'cefr' as const,
  scale: 'Overall written production',
  level: 'B1' as const,
  index: 2,
}

const bands = (
  label: string,
  alignment: RubricVersion['criteria'][number]['bands'][number]['alignment'] = cefr,
) => [0, 1, 2, 3, 4, 5].map((band) => ({ band, description: `${label} bandı ${band}`, alignment }))

function version(overrides: Partial<RubricVersion> = {}): RubricVersion {
  return {
    id: 'test-v1',
    rubricId: 'test-r1',
    versionNumber: 1,
    status: 'draft',
    title: 'Yazma rubriği',
    kind: 'analytic',
    skill: 'writing',
    createdAt: AT,
    updatedAt: AT,
    publishedAt: null,
    archivedAt: null,
    rowVersion: 1,
    criteria: [
      { id: 'task_fulfilment', aspect: 'task_fulfilment', weight: 2, bands: bands('Görev') },
      { id: 'vocabulary', aspect: 'vocabulary', weight: 1, bands: bands('Sözcük') },
    ],
    usage: { assignmentCount: 0, scoreCount: 0 },
    ...overrides,
  }
}

const detail = (versions: RubricVersion[], canManage = true): RubricDetail => ({
  rubric: { id: 'test-r1', ownerUserId: 'test-u1', createdAt: AT, canManage },
  versions,
})

/** Formu geçerli kılan değerler (bant tanımları ve CEFR ölçeği dolu). */
function filledForm(): RubricFormValues {
  const values = defaultRubricForm()
  return {
    ...values,
    title: 'Paragraf yazma',
    criteria: values.criteria.map((criterion) => ({
      ...criterion,
      alignment: { ...criterion.alignment, scale: 'Overall written production' },
      bands: criterion.bands.map((_, band) => ({ description: `Bant ${band} tanımı` })),
    })),
  }
}

test('IST-048: liste satırı baş sürümün durumunu, sürümünü ve yayındaki sürümü gösterir', () => {
  const item: RubricListItem = {
    rubric: { id: 'test-r1', ownerUserId: 'test-u1', createdAt: AT, canManage: false },
    head: { ...version({ versionNumber: 2, status: 'draft', id: 'test-v2' }) },
    publishedVersionId: 'test-v1',
  }
  const row = rubricRow(item)
  assert.deepEqual(
    [row.title, row.skill, row.kind, row.version, row.status, row.statusKey, row.published],
    ['Yazma rubriği', 'Yazma', 'Analitik', 'v2', 'Taslak', 'draft', 'Önceki sürüm'],
  )
  assert.equal(row.canManage, false)
  assert.equal(rubricRow({ ...item, publishedVersionId: 'test-v2' }).published, 'Bu sürüm')
  assert.equal(rubricRow({ ...item, publishedVersionId: null }).published, 'Yok')
})

test('IST-048: liste sorgusu süzgeçleri beyaz listeden alır, arama en az 2 karakter, "benimkiler" sahip kimliği', () => {
  const base = { page: 2, pageSize: 25, userId: 'test-u1' }
  assert.deepEqual(
    rubricListQuery({
      ...base,
      q: '  yazma ',
      filters: { skill: 'speaking', kind: 'holistic', status: 'published', mine: 'yes' },
    }),
    {
      page: 2,
      pageSize: 25,
      q: 'yazma',
      skill: 'speaking',
      kind: 'holistic',
      status: 'published',
      ownerUserId: 'test-u1',
    },
  )
  assert.deepEqual(
    rubricListQuery({ ...base, q: 'y', filters: { skill: 'reading', kind: 'x', mine: '' } }),
    { page: 2, pageSize: 25 },
  )
  // Sunucu en çok 100 karakter kabul eder (aşınca 400); sorgu metni kesilir.
  assert.equal(rubricListQuery({ ...base, q: 'a'.repeat(150), filters: {} }).q?.length, 100)
})

test('DOM-BEC-021: ağırlık payı yüzde olarak gösterilir; geçersiz ağırlık sıfır sayılır', () => {
  assert.deepEqual(weightShares([2, 1, 1]), [50, 25, 25])
  assert.deepEqual(weightShares([1, Number.NaN]), [100, 0])
  assert.deepEqual(weightShares([]), [])
})

test('DOM-BEC-020: eşleme etiketi CEFR tanımlayıcısını ya da kazanımı anar; ortak eşleme bantlar aynıysa', () => {
  assert.equal(alignmentLabel(cefr), 'CEFR B1 · Overall written production · 2. tanımlayıcı')
  assert.equal(
    alignmentLabel({ kind: 'outcome', outcomeId: 'E.9.1.W1', outcomeSource: 'platform' }),
    'Kazanım E.9.1.W1 · Öğretim programı',
  )
  const criterion = version().criteria[0]!
  assert.deepEqual(sharedAlignment(criterion), cefr)
  const mixed = {
    ...criterion,
    bands: criterion.bands.map((band) =>
      band.band === 5 ? { ...band, alignment: { ...cefr, level: 'B2' as const } } : band,
    ),
  }
  assert.equal(sharedAlignment(mixed), null)
})

test('DOM-BEC-022: eylemler tek açık taslağa ve yayındaki sürüme yönelir; yalnız sahip ya da yönetici', () => {
  const draftOnly = rubricActions(detail([version()]))
  assert.deepEqual(
    [draftOnly.canPublish, draftOnly.canEditDraft, draftOnly.canOpenVersion, draftOnly.canArchive],
    [true, true, false, false],
  )
  const published = version({ status: 'published', publishedAt: AT })
  const withDraft = detail([published, version({ id: 'test-v2', versionNumber: 2 })])
  const actions = rubricActions(withDraft)
  assert.equal(actions.head?.id, 'test-v2')
  assert.equal(actions.published?.id, 'test-v1')
  assert.deepEqual(
    [actions.canPublish, actions.canOpenVersion, actions.canArchive],
    [true, false, true],
  )
  const onlyPublished = rubricActions(detail([published]))
  assert.deepEqual([onlyPublished.canOpenVersion, onlyPublished.canArchive], [true, true])
  // Kullanılmış taslak düzenlenmez ama yayımlanabilir.
  const used = rubricActions(detail([version({ usage: { assignmentCount: 1, scoreCount: 0 } })]))
  assert.deepEqual([used.canEditDraft, used.canPublish], [false, true])
  const foreign = rubricActions(
    detail([published, version({ id: 'test-v2', versionNumber: 2 })], false),
  )
  assert.deepEqual(
    [foreign.canPublish, foreign.canEditDraft, foreign.canOpenVersion, foreign.canArchive],
    [false, false, false, false],
  )
  const archived = rubricActions(detail([version({ status: 'archived', archivedAt: AT })]))
  assert.deepEqual([archived.canOpenVersion, archived.canArchive], [true, false])
})

test('IST-048: kullanım ve sürüm geçmişi; aynı rubrik birçok görevde sayılır', () => {
  assert.equal(usageLabel({ assignmentCount: 0, scoreCount: 0 }), 'Henüz görevde kullanılmadı')
  assert.equal(usageLabel({ assignmentCount: 3, scoreCount: 5 }), '3 görevde kullanılıyor · 5 puan')
  const versions = [
    version({ usage: { assignmentCount: 2, scoreCount: 0 } }),
    version({ id: 'test-v2', versionNumber: 2, usage: { assignmentCount: 1, scoreCount: 0 } }),
  ]
  assert.equal(totalAssignments(versions), 3)
  assert.deepEqual(
    versionHistory(versions).map((v) => v.versionNumber),
    [2, 1],
  )
})

test('DOM-BEC-020: geçerli form core şemasından gövde üretir; kriter kimliği niteliksel yön', () => {
  const result = validateRubricForm(filledForm(), 'school')
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.body.title, 'Paragraf yazma')
  assert.deepEqual(
    result.body.criteria.map((criterion) => [
      criterion.id,
      criterion.aspect,
      criterion.bands.length,
    ]),
    [
      ['task_fulfilment', 'task_fulfilment', 6],
      ['coherence_cohesion', 'coherence_cohesion', 6],
    ],
  )
  assert.deepEqual(result.body.criteria[0]?.bands[3]?.alignment, {
    kind: 'cefr',
    scale: 'Overall written production',
    level: 'B1',
    index: 1,
  })
})

test('DOM-BEC-020: boş form core hatalarını form alanlarına yazar', () => {
  const result = validateRubricForm(defaultRubricForm(), 'school')
  assert.equal(result.ok, false)
  if (result.ok) return
  const fields = result.issues.map((issue) => issue.field)
  assert.ok(fields.includes('title'))
  assert.ok(fields.includes('criteria.0.bands.0.description'))
  assert.ok(fields.includes('criteria.0.alignment.scale'))
  // Aynı alana tek hata (altı bandın ölçek hatası tek alana düşer).
  assert.equal(new Set(fields).size, fields.length)
})

test('DOM-BEC-020: ağırlık 1–10 ve analitikte en az iki kriter core kuralıyla denetlenir', () => {
  const heavy = filledForm()
  heavy.criteria[0]!.weight = 11
  const result = validateRubricForm(heavy, 'school')
  assert.equal(result.ok, false)
  if (!result.ok)
    assert.deepEqual(result.issues, [
      { field: 'criteria.0.weight', message: 'Ağırlık en fazla 10 olabilir.' },
    ])
  const single = filledForm()
  single.criteria = single.criteria.slice(0, 1)
  const one = validateRubricForm(single, 'school')
  assert.equal(one.ok, false)
  if (!one.ok)
    assert.deepEqual(one.issues, [
      { field: 'criteria.root', message: 'Analitik rubrikte en az iki kriter olmalıdır.' },
    ])
})

test('DOM-BEC-020: dil okulunda kazanım eşlemesi kriterin eşleme alanında reddedilir', () => {
  const values = filledForm()
  values.criteria[1]!.alignment = {
    ...values.criteria[1]!.alignment,
    kind: 'outcome',
    outcomeId: 'E.9.1.W1',
  }
  assert.equal(validateRubricForm(values, 'school').ok, true)
  const result = validateRubricForm(values, 'language_school')
  assert.equal(result.ok, false)
  if (!result.ok)
    assert.deepEqual(result.issues, [
      {
        field: 'criteria.1.alignment.kind',
        message: 'Dil okulunda bantlar CEFR tanımlayıcısına bağlanır.',
      },
    ])
})

test('DOM-BEC-020: bütüncül rubrik tek genel kriter, ağırlık 1; analitiğe dönüşte iki kriter', () => {
  const holistic = withKind(filledForm(), 'holistic')
  assert.deepEqual(
    holistic.criteria.map((criterion) => [criterion.aspect, criterion.weight]),
    [['overall', 1]],
  )
  // Yazılmış bant tanımları korunur.
  assert.equal(holistic.criteria[0]?.bands[2]?.description, 'Bant 2 tanımı')
  assert.equal(validateRubricForm(holistic, 'school').ok, true)
  assert.equal(withAddedCriterion(holistic), holistic)
  const analytic = withKind(holistic, 'analytic')
  assert.deepEqual(
    analytic.criteria.map((criterion) => criterion.aspect),
    ['task_fulfilment', 'coherence_cohesion'],
  )
})

test('DOM-BEC-020: beceri değişince yönler beceriye uyar; kriter ekleme kullanılmayan yönü alır', () => {
  const speaking = withSkill(filledForm(), 'speaking')
  assert.deepEqual(
    speaking.criteria.map((criterion) => criterion.aspect),
    ['range', 'accuracy'],
  )
  const added = withAddedCriterion(speaking)
  assert.equal(added.criteria.at(-1)?.aspect, 'fluency')
  let full = speaking
  for (let i = 0; i < 10; i += 1) full = withAddedCriterion(full)
  // Konuşmanın altı yönü var; yedinci eklenmez.
  assert.equal(full.criteria.length, 6)
})

test('DOM-BEC-022: yeni sürüm formu sürümün içeriğiyle başlar; farklı bant eşlemeleri korunur', () => {
  const base = version()
  const values = formFromVersion(base)
  assert.equal(values.title, 'Yazma rubriği')
  assert.equal(values.criteria[0]?.weight, 2)
  assert.equal(values.criteria[0]?.bandAlignments, null)
  assert.equal(values.criteria[0]?.bands[4]?.description, 'Görev bandı 4')
  const mixedBands = bands('Görev').map((band) =>
    band.band === 5 ? { ...band, alignment: { ...cefr, level: 'B2' as const } } : band,
  )
  const mixed = formFromVersion(
    version({
      criteria: [
        { id: 'task', aspect: 'task_fulfilment', weight: 1, bands: mixedBands },
        { id: 'vocabulary', aspect: 'vocabulary', weight: 1, bands: bands('Sözcük') },
      ],
    }),
  )
  assert.equal(mixed.criteria[0]?.bandAlignments?.length, 6)
  const body = rubricBodyFromForm(mixed)
  assert.deepEqual(
    body.criteria[0]?.bands.map((band) => band.alignment),
    mixedBands.map((band) => band.alignment),
  )
  // Kriter kimliği yeni sürümde niteliksel yönden türer.
  assert.equal(body.criteria[0]?.id, 'task_fulfilment')
})

test('Sunucu hata yolu form alanına çevrilir', () => {
  assert.equal(formFieldFor(['title']), 'title')
  assert.equal(
    formFieldFor(['criteria', '0', 'bands', '3', 'alignment']),
    'criteria.0.alignment.kind',
  )
  assert.equal(
    formFieldFor(['criteria', 1, 'bands', 2, 'alignment', 'index']),
    'criteria.1.alignment.index',
  )
  assert.equal(
    formFieldFor(['criteria', 0, 'bands', 2, 'description']),
    'criteria.0.bands.2.description',
  )
  assert.equal(formFieldFor(['criteria', 0, 'id']), 'criteria.0.aspect')
  assert.equal(formFieldFor(['criteria', 0, 'bands']), 'criteria.0.bands.0.description')
  assert.equal(formFieldFor(['criteria']), 'criteria.root')
  assert.equal(formFieldFor([]), 'root.server')
})

test('Form penceresi adresi: yeni, yeni sürüm ve taslak düzenleme', () => {
  assert.deepEqual(parseFormTarget(NEW_RUBRIC), { mode: 'create' })
  assert.deepEqual(parseFormTarget(versionTarget('test-r1')), {
    mode: 'version',
    rubricId: 'test-r1',
  })
  assert.deepEqual(parseFormTarget(editTarget('test-r1')), { mode: 'edit', rubricId: 'test-r1' })
  assert.equal(parseFormTarget(''), null)
  assert.equal(parseFormTarget('surum-'), null)
  assert.equal(parseFormTarget('baska'), null)
})
