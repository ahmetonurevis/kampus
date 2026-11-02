import assert from 'node:assert/strict'
import { test } from 'node:test'
import { subjects } from '@kampus/school-core/data/curriculum.ts'
import { coordinatorDutyInputSchema } from '@kampus/school-core/lib/coordinator-duties.ts'
import type { InstitutionMember } from '@kampus/react-shared/institution-lists.ts'
import type { CoordinatorDuty } from '@kampus/react-shared/use-coordinator-duties.ts'
import { DUTY_ERROR_FIELDS } from '../src/pages/management/coordinator-duty-forms.ts'
import {
  canManageDuties,
  dutyCsvRows,
  dutyRows,
  dutyTexts,
  scopeLabel,
  scopeOptions,
  sortedDutyRows,
  teacherBranchOf,
  teacherOptions,
  UNKNOWN_TEACHER,
} from '../src/pages/management/coordinator-duty-rows.ts'

const member = (
  id: string,
  name: string,
  overrides: Partial<InstitutionMember> = {},
): InstitutionMember => ({
  id,
  userId: `u-${id}`,
  name,
  email: `${id}@kampus.test`,
  role: 'ogretmen',
  status: 'active',
  links: [{ kind: 'teacher', name }],
  createdAt: '2026-10-01T08:00:00.000Z',
  ...overrides,
})
const duty = (
  id: string,
  membershipId: string,
  scopeId: string,
  kind: 'subject_head' | 'academic_coordinator',
) =>
  ({
    id,
    membershipId,
    kind,
    scopeId,
    createdAt: '2026-11-02T09:00:00.000Z',
    archivedAt: null,
    rowVersion: 4,
  }) satisfies CoordinatorDuty

const math = subjects.find((subject) => subject.name === 'Matematik')?.id ?? ''

test('DOM-YTK-027: yalnız yönetici görev verir ve kaldırır', () => {
  assert.equal(canManageDuties('yonetici'), true)
  for (const role of ['ogretmen', 'onburo', 'ogrenci', 'veli', undefined])
    assert.equal(canManageDuties(role), false, String(role))
})

test('IST-005: metinler kurum türüne göre; okulda zümre başkanı ve ders, dil okulunda koordinatör ve seviye', () => {
  const school = dutyTexts('school')
  assert.equal(school.kindLabel, 'Zümre başkanı')
  assert.equal(school.scopeLabel, 'Ders')
  assert.equal(school.addLabel, 'Zümre başkanı ata')
  const language = dutyTexts('language_school')
  assert.equal(language.kindLabel, 'Akademik koordinatör')
  assert.equal(language.scopeLabel, 'Seviye')
  assert.equal(language.addLabel, 'Koordinatör ata')
})

test('DOM-YTK-027: kapsam seçenekleri okulda müfredat dersleri, dil okulunda CEFR seviyeleri düşükten yükseğe', () => {
  assert.deepEqual(
    scopeOptions('school').map((option) => option.value),
    subjects.map((subject) => subject.id),
  )
  assert.deepEqual(
    scopeOptions('language_school').map((option) => option.label),
    ['Pre-A1', 'A1', 'A2', 'A2+', 'B1', 'B1+', 'B2', 'B2+', 'C1', 'C2'],
  )
  assert.equal(scopeLabel('school', math), 'Matematik')
  assert.equal(scopeLabel('language_school', 'B1+'), 'B1+')
  // Müfredatta olmayan kapsam kimliği olduğu gibi gösterilir (satır düşmez).
  assert.equal(scopeLabel('school', 'bilinmeyen'), 'bilinmeyen')
})

test('DOM-YTK-027: atanabilir öğretmenler yalnız etkin öğretmen üyelikleri, Türkçe ada göre', () => {
  const members = [
    member('m1', 'Zeynep Çelik'),
    member('m2', 'Ahmet Yıldız'),
    member('m3', 'Pasif Hoca', { status: 'passive' }),
    member('m4', 'Ayşe Veli', { role: 'veli' }),
    member('m5', 'Çağlar Ak'),
  ]
  assert.deepEqual(
    teacherOptions(members).map((option) => option.label),
    ['Ahmet Yıldız', 'Çağlar Ak', 'Zeynep Çelik'],
  )
})

test('DOM-YTK-027: kadro branşı yalnız adı tek etkin öğretmen kaydıyla eşleşince bulunur', () => {
  const selin = member('m1', 'Selin Kaya')
  const unique = [{ name: 'Selin Kaya', subjectId: math, isActive: true }]
  assert.equal(teacherBranchOf(selin, unique), math)
  assert.equal(teacherBranchOf(member('m1', ' selin kaya '), unique), math)
  // Aynı adlı iki etkin kayıt belirsizdir; arşivdeki kayıt sayılmaz.
  assert.equal(
    teacherBranchOf(selin, [...unique, { name: 'Selin Kaya', subjectId: 'x', isActive: true }]),
    null,
  )
  assert.equal(
    teacherBranchOf(selin, [...unique, { name: 'Selin Kaya', subjectId: 'x', isActive: false }]),
    math,
  )
  assert.equal(teacherBranchOf(selin, []), null)
  assert.equal(teacherBranchOf(undefined, unique), null)
  assert.equal(teacherBranchOf(member('m1', 'Selin Kaya', { links: [] }), unique), null)
})

test('DOM-YTK-027: görev satırı öğretmen adı, kapsam adı ve okunan sürümü taşır; üyelik bulunamazsa satır düşmez', () => {
  const members = [member('m1', 'Selin Kaya'), member('m2', 'Pasif Hoca', { status: 'passive' })]
  const rows = dutyRows(
    'school',
    [
      duty('d1', 'm1', math, 'subject_head'),
      duty('d2', 'm2', math, 'subject_head'),
      duty('d3', 'yok', math, 'subject_head'),
    ],
    members,
  )
  assert.deepEqual(
    rows.map((row) => [row.teacher, row.scope, row.kind, row.passive, row.version]),
    [
      ['Selin Kaya', 'Matematik', 'Zümre başkanı', false, 4],
      ['Pasif Hoca', 'Matematik', 'Zümre başkanı', true, 4],
      [UNKNOWN_TEACHER, 'Matematik', 'Zümre başkanı', false, 4],
    ],
  )
  const language = dutyRows(
    'language_school',
    [duty('d4', 'm1', 'B1+', 'academic_coordinator')],
    members,
  )
  assert.deepEqual(
    language.map((row) => [row.scope, row.kind]),
    [['B1+', 'Akademik koordinatör']],
  )
})

test('IST-005: satırlar öğretmen adına, sonra kapsama göre sıralanır; CSV tarihi okunur yazar', () => {
  const members = [member('m1', 'Zeynep Çelik'), member('m2', 'Ahmet Yıldız')]
  const rows = sortedDutyRows(
    dutyRows(
      'language_school',
      [
        duty('d1', 'm1', 'A1', 'academic_coordinator'),
        duty('d2', 'm2', 'C1', 'academic_coordinator'),
        duty('d3', 'm2', 'B2', 'academic_coordinator'),
      ],
      members,
    ),
  )
  assert.deepEqual(
    rows.map((row) => `${row.teacher}/${row.scope}`),
    ['Ahmet Yıldız/B2', 'Ahmet Yıldız/C1', 'Zeynep Çelik/A1'],
  )
  assert.match(String(dutyCsvRows(rows)[0]?.createdAt), /2026/)
})

test('DOM-YTK-027: form çekirdek şemayla doğrulanır; sunucu kuralı reddi ilgili alana bağlanır', () => {
  const result = coordinatorDutyInputSchema.safeParse({ membershipId: '', scopeId: '' })
  assert.equal(result.success, false)
  assert.deepEqual(
    result.error?.issues.map((issue) => [issue.path.join('.'), issue.message]),
    [
      ['membershipId', 'Bir öğretmen seçin.'],
      ['scopeId', 'Ders veya seviye seçin.'],
    ],
  )
  assert.deepEqual(DUTY_ERROR_FIELDS, {
    duty_requires_teacher: 'membershipId',
    teacher_record_required: 'membershipId',
    duty_outside_branch: 'scopeId',
    invalid_cefr_level: 'scopeId',
    coordinator_duty_exists: 'scopeId',
  })
})
