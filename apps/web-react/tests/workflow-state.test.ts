import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSeed, type State } from '@kampus/school-core/data/seed.ts'
import {
  workflowCreateActions,
  workflowDetails,
  workflowForm,
  workflowRows,
} from '@kampus/school-core/lib/workflow-presentation.ts'
import { schoolModules } from '@kampus/school-core/modules/school-workflows.ts'
import type { Role } from '@kampus/school-core/modules/navigation.ts'
import {
  buildWorkflowState,
  coreSession,
  dependentResets,
  formDefaults,
  formPreview,
  isWorkflowModuleKey,
  localDateTime,
  versionMap,
  workflowScopeLabel,
  workflowSources,
  workflowTableRow,
  type WorkflowModuleKey,
} from '../src/pages/workflows/workflow-state.ts'

const NOW = '2026-10-30T09:00:00.000Z'
const seed = createSeed(new Date(NOW))

type Links = Parameters<typeof coreSession>[0]['links']
const LINKS: Record<Role, Links> = {
  yonetici: [],
  onburo: [],
  ogretmen: [{ kind: 'teacher', recordId: 't1' }],
  ogrenci: [{ kind: 'student', recordId: 's1' }],
  veli: [
    { kind: 'child', recordId: 's1' },
    { kind: 'child', recordId: 's2' },
  ],
}

/** İstemcinin okuduğu koleksiyonlarla kurulan State (sunucu kapsamı burada yok sayılır). */
function clientState(module: WorkflowModuleKey, role: Role): State {
  const records = Object.fromEntries(
    workflowSources(module, role).map(({ collection }) => [collection, seed[collection]]),
  )
  return buildWorkflowState(records, { modules: seed.modules, academicYear: 2026 })
}

const pages = schoolModules.filter((m) => isWorkflowModuleKey(m.key))

test('okunan koleksiyonlar her modülde ve rolde tam örnek veriyle aynı satırları üretir', () => {
  for (const page of pages) {
    const key = page.key as WorkflowModuleKey
    for (const role of page.roles) {
      const session = coreSession({ role, links: LINKS[role] }, role === 'veli' ? 's2' : '')
      const expected = workflowRows(seed, session, page.path, NOW)
      const actual = workflowRows(clientState(key, role), session, page.path, NOW)
      assert.deepEqual(actual, expected, `${page.key} / ${role}`)
      assert.deepEqual(
        workflowCreateActions(clientState(key, role), session, page.path),
        workflowCreateActions(seed, session, page.path),
      )
    }
  }
})

test('detay işlemleri ve yemek formu istemci State ile kurulur', () => {
  const session = coreSession({ role: 'yonetici', links: [] }, '')
  const state = clientState('meals', 'yonetici')
  const [first] = workflowRows(state, session, 'yemek-menusu', NOW)
  assert.ok(first)
  const details = workflowDetails(state, session, first)
  assert.deepEqual(
    details.actions.map((a) => [a.command, a.recordId]),
    [['meal', first.id]],
  )
  const form = workflowForm(state, session, 'meal', first.id, {}, NOW)
  assert.equal(form.title, 'Menüyü düzenle')
  assert.equal(
    first.kind === 'meal' && form.initial.title,
    first.kind === 'meal' && first.source.title,
  )
})

test('ana koleksiyon ilk sırada, kurum dışı rollerde kapsam kaynakları eklenir', () => {
  const admin = workflowSources('meals', 'yonetici').map((s) => s.collection)
  assert.deepEqual(admin, ['mealMenus', 'branches', 'students', 'teachers', 'classes'])
  const teacher = workflowSources('clubs', 'ogretmen')
  assert.deepEqual(
    teacher.filter((s) => s.primary).map((s) => s.collection),
    ['clubs'],
  )
  // Kulüpler hem modül hem kapsam kaynağıdır; tek kez okunur.
  assert.equal(teacher.filter((s) => s.collection === 'clubs').length, 1)
  assert.ok(teacher.some((s) => s.collection === 'assignments'))
  assert.equal(isWorkflowModuleKey('optical'), false)
  assert.equal(isWorkflowModuleKey('toString'), false)
})

test('veli oturumu seçili çocuğu taşır; diğer rollerde çocuk yoktur', () => {
  assert.deepEqual(coreSession({ role: 'veli', links: LINKS.veli }, 's2'), {
    role: 'veli',
    links: LINKS.veli,
    childId: 's2',
  })
  assert.equal('childId' in coreSession({ role: 'ogretmen', links: LINKS.ogretmen }, 's2'), false)
  assert.equal(workflowScopeLabel('veli'), 'Seçili çocuğunuzun kayıtları')
  assert.equal(workflowScopeLabel('ogretmen'), 'Görev kapsamınızdaki kayıtlar')
  assert.equal(workflowScopeLabel('onburo'), 'Okul iş akışları')
})

test('tablo satırı düz alanlardır; sürüm haritası kimliğe bağlanır', () => {
  const session = coreSession({ role: 'yonetici', links: [] }, '')
  const [first] = workflowRows(seed, session, 'yemek-menusu', NOW)
  assert.ok(first)
  const row = workflowTableRow(first)
  assert.deepEqual(Object.keys(row), ['id', 'kind', 'title', 'subtitle', 'body', 'status', 'date'])
  assert.equal(row.kind, 'meal')
  assert.equal(versionMap([{ id: 'm1', version: 4 }]).get('m1'), 4)
})

test('tarih-saat alanı yerel biçime çevrilir, bağımlı alanlar sıfırlanır', () => {
  assert.equal(localDateTime('2026-11-06T09:00:00.000Z'), '2026-11-06T12:00')
  assert.equal(localDateTime('2026-11-06T12:00'), '2026-11-06T12:00')
  assert.equal(localDateTime(undefined), '')
  const session = coreSession({ role: 'yonetici', links: [] }, '')
  const form = workflowForm(
    clientState('calendar', 'yonetici'),
    session,
    'event',
    undefined,
    {},
    NOW,
  )
  const values = formDefaults(form.fields, form.initial)
  assert.equal(values.date, '2026-11-06T12:00')
  assert.equal(form.initial.date, '2026-11-06T09:00:00.000Z')
  assert.deepEqual(dependentResets({ ...values, classId: 'c1' }, 'branchId', 'b2'), [
    ['classId', ''],
  ])
  assert.deepEqual(dependentResets(values, 'title', 'Gezi'), [])
})

test('önizleme seçenek adını, onay kutusunu ve boş değeri okunur yazar', () => {
  const lines = formPreview(
    [
      {
        key: 'branchId',
        label: 'Kampüs',
        type: 'select',
        options: [{ value: 'b1', label: 'Merkez' }],
      },
      { key: 'classId', label: 'Sınıf', type: 'select', options: [] },
      { key: 'requiresConsent', label: 'Veli onayı gerekli', type: 'checkbox' },
      { key: 'days', label: 'Günler', type: 'multi', options: [{ value: 'a', label: 'Pzt' }] },
      { key: 'date', label: 'Başlangıç', type: 'datetime' },
      { key: 'note', label: 'Not', type: 'textarea' },
    ],
    { branchId: 'b1', classId: '', requiresConsent: true, days: ['a'], date: '2026-11-06T12:00' },
  )
  assert.deepEqual(
    lines.map((l) => l.value),
    ['Merkez', 'Seçilmedi', 'Evet', 'Pzt', '2026-11-06 12:00', '—'],
  )
})
