import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  applyStudentImport,
  parseStudentImport,
  planStudentImport,
  STUDENT_IMPORT_SAMPLE,
  type StudentImportContext,
  type StudentImportRow,
  type StudentImportState,
} from '../packages/school-core/src/lib/enrollment-import.ts'
import {
  importFileInputSchema,
  parseImportDay,
  parseImportPhone,
} from '../packages/school-core/src/lib/enrollment-import-cells.ts'
import { isValidTurkishId } from '../packages/school-core/src/lib/enrollment.ts'
import { DomainError } from '../packages/school-core/src/lib/errors.ts'

// Pilot verisi aktarımı (ON-060, IST-007; DOM-KAY-010, DOM-KAY-012, DOM-KAY-013): saf kural.

const NOW = '2026-10-06T09:00:00.000Z'
const TC = ['10000000146', '10000000078', '10000000214', '10000000382']

function state(overrides: Partial<StudentImportState> = {}): StudentImportState {
  return {
    students: [],
    parents: [],
    classes: [
      { id: 'c-1', name: '7-A', branchId: 'b-1', capacity: 2, grade: 7, isActive: true },
      { id: 'c-2', name: '5-B', branchId: 'b-1', capacity: 30, grade: 5, isActive: true },
      { id: 'c-3', name: '5-B', branchId: 'b-2', capacity: 30, grade: 5, isActive: true },
      { id: 'c-pasif', name: '6-C', branchId: 'b-1', capacity: 30, grade: 6, isActive: false },
    ],
    branches: [
      { id: 'b-1', name: 'Kadıköy Kampüsü', isActive: true },
      { id: 'b-2', name: 'Moda Kampüsü', isActive: true },
    ],
    renewals: [],
    prospects: [],
    ...overrides,
  } as StudentImportState
}

const context = (overrides: Partial<StudentImportContext> = {}): StudentImportContext => ({
  institutionType: 'school',
  today: '2026-10-06',
  now: NOW,
  identityHolders: new Map(),
  bonds: [],
  ...overrides,
})

let lineNo = 1
const row = (overrides: Partial<StudentImportRow> = {}): StudentImportRow => ({
  line: ++lineNo,
  name: 'Ece Demir',
  className: '7-A',
  campus: '',
  identityKind: '',
  identityNumber: TC[0] ?? '',
  birthDate: '2013-03-14',
  guardianName: 'Ayla Demir',
  guardianPhone: '05321110001',
  relationship: 'Anne',
  studentPhone: '',
  extraCells: false,
  ...overrides,
})

const codes = (issues: readonly { code: string }[]) => issues.map((issue) => issue.code)

describe('aktarım hücreleri (IST-007)', () => {
  test('tarih yerel ve ISO biçimlerini okur, geçersiz günü reddeder', () => {
    assert.equal(parseImportDay('14.03.2013'), '2013-03-14')
    assert.equal(parseImportDay('4/3/2013'), '2013-03-04')
    assert.equal(parseImportDay('2013-03-14'), '2013-03-14')
    assert.equal(parseImportDay('31.02.2013'), null)
    assert.equal(parseImportDay('dün'), null)
  })

  test('telefon baştaki sıfırı düşmüş ve +90 önekli değeri düzeltir', () => {
    assert.equal(parseImportPhone('5321110001'), '05321110001')
    assert.equal(parseImportPhone('+90 532 111 00 01'), '05321110001')
    assert.equal(parseImportPhone('(0532) 111-00-01'), '05321110001')
    assert.equal(parseImportPhone('12345'), null)
  })

  test('dosya gövdesi base64 ister, bilinmeyen alanı reddeder', () => {
    assert.equal(importFileInputSchema.safeParse({ fileBase64: 'QUJD' }).success, true)
    assert.equal(importFileInputSchema.parse({ fileBase64: 'QUJD' }).dryRun, false)
    assert.equal(importFileInputSchema.safeParse({ fileBase64: '%%%' }).success, false)
    assert.equal(
      importFileInputSchema.safeParse({ fileBase64: 'QUJD', institutionId: 'x' }).success,
      false,
    )
  })

  test('örnek dosyanın kimlikleri geçerlidir ve dosya ayrıştırılır', () => {
    const rows = parseStudentImport(STUDENT_IMPORT_SAMPLE)
    assert.equal(rows.length, 2)
    assert.ok(rows.every((item) => isValidTurkishId(item.identityNumber)))
    assert.equal(rows[0]?.line, 2)
  })

  test('başlıksız dosya, eksik zorunlu sütun ve satır sınırı dosya düzeyinde reddedilir', () => {
    assert.throws(
      () => parseStudentImport('Ece;Demir\nCan;Demir'),
      (error: DomainError) => error.code === 'csv_unknown_column',
    )
    assert.throws(
      () => parseStudentImport('öğrenci adı;sınıf\nEce;7-A'),
      (error: DomainError) => error.code === 'csv_missing_column',
    )
    const header = 'öğrenci adı;sınıf;kimlik no;doğum tarihi'
    const body = Array.from({ length: 1001 }, () => 'Ece;7-A;1;2013-03-14')
    assert.throws(
      () => parseStudentImport([header, ...body].join('\n')),
      (error: DomainError) => error.code === 'csv_too_many_rows',
    )
  })
})

describe('planStudentImport (ON-060, DOM-KAY-012, DOM-KAY-013)', () => {
  test('geçerli satır hazırdır; kimlik ve telefon önizlemede maskelidir (DOM-KAY-012)', () => {
    const plan = planStudentImport(state(), [row()], context())
    assert.deepEqual(plan.issues, [])
    assert.equal(plan.students.length, 1)
    const first = plan.rows[0]
    assert.equal(first?.status, 'ready')
    assert.equal(first?.identityMasked, '*******0146')
    assert.equal(JSON.stringify(plan.rows).includes(TC[0] ?? ''), false)
    assert.equal(JSON.stringify(plan.rows).includes('05321110001'), false)
    assert.equal(plan.newGuardianCount, 1)
  })

  test('bir hata bütün planı boşaltır, satır numarası ve alan döner (IST-007)', () => {
    const plan = planStudentImport(
      state(),
      [row({ line: 2 }), row({ line: 3, identityNumber: '11111111111' })],
      context(),
    )
    assert.deepEqual(plan.students, [])
    assert.deepEqual(plan.issues[0], {
      line: 3,
      field: 'identityNumber',
      code: 'identity_invalid',
      message: 'Geçerli bir T.C. kimlik numarası girin.',
    })
    assert.equal(plan.rows[0]?.status, 'ready')
    assert.equal(plan.rows[1]?.status, 'invalid')
  })

  test('yabancı kimlik T.C. denetiminden geçmez, kısa numara ve bilinmeyen tür reddedilir', () => {
    const plan = planStudentImport(
      state(),
      [
        row({ identityKind: 'Yabancı', identityNumber: 'P1234567' }),
        row({ identityKind: 'Yabancı', identityNumber: 'P1', guardianPhone: '05321110002' }),
        row({
          identityKind: 'Pasaport',
          identityNumber: TC[1] ?? '',
          guardianPhone: '05321110003',
        }),
      ],
      context(),
    )
    assert.equal(plan.rows[0]?.status, 'ready')
    assert.deepEqual(codes(plan.rows[1]?.issues ?? []), ['foreign_identity_invalid'])
    assert.deepEqual(codes(plan.rows[2]?.issues ?? []), ['identity_kind_invalid'])
  })

  test('dosyada yinelenen kimlik ve fazla hücre satır hatasıdır', () => {
    const plan = planStudentImport(
      state(),
      [row({ line: 5 }), row({ line: 6, extraCells: true })],
      context(),
    )
    assert.deepEqual(codes(plan.rows[1]?.issues ?? []).sort(), [
      'duplicate_identity',
      'extra_cells',
    ])
    assert.match(plan.rows[1]?.issues[1]?.message ?? '', /5\. satırında/)
  })

  test('sınıf kampüsle ayrışır, pasif sınıf ve bilinmeyen kampüs bulunmaz', () => {
    const plan = planStudentImport(
      state(),
      [
        row({ className: '5-B', guardianPhone: '05321110010' }),
        row({
          className: '5-B',
          campus: 'moda kampüsü',
          identityNumber: TC[1] ?? '',
          guardianPhone: '05321110011',
        }),
        row({ className: '6-C', identityNumber: TC[2] ?? '', guardianPhone: '05321110012' }),
        row({ campus: 'Yok', identityNumber: TC[3] ?? '', guardianPhone: '05321110013' }),
      ],
      context(),
    )
    assert.deepEqual(codes(plan.rows[0]?.issues ?? []), ['class_ambiguous'])
    assert.deepEqual(plan.rows[1]?.issues, [])
    assert.deepEqual(codes(plan.rows[2]?.issues ?? []), ['class_not_found'])
    assert.deepEqual(codes(plan.rows[3]?.issues ?? []), ['campus_not_found'])
  })

  test('kontenjan aktif öğrenci ve planlı yenilemeyle dolar (DOM-KAY-010)', () => {
    const full = state({
      students: [
        { id: 's-1', name: 'A B', classId: 'c-1', parentId: 'p', isActive: true },
        { id: 's-pasif', name: 'P B', classId: 'c-1', parentId: 'p', isActive: false },
      ] as StudentImportState['students'],
      renewals: [
        { studentId: 's-2', targetClassId: 'c-1', status: 'Planlandı' },
      ] as StudentImportState['renewals'],
    })
    const plan = planStudentImport(full, [row()], context())
    assert.deepEqual(codes(plan.issues), ['class_capacity_full'])
  })

  test('aynı telefon ve ad kardeşi aynı veliye bağlar; ad ya da yakınlık farkı hatadır (DOM-KAY-013)', () => {
    const plan = planStudentImport(
      state(),
      [
        row({ line: 2, className: '5-B', campus: 'Kadıköy Kampüsü' }),
        row({
          line: 3,
          className: '5-B',
          campus: 'Kadıköy Kampüsü',
          identityNumber: TC[1] ?? '',
          guardianName: 'AYLA DEMİR',
          guardianPhone: '5321110001',
        }),
        row({
          line: 4,
          className: '5-B',
          campus: 'Kadıköy Kampüsü',
          identityNumber: TC[2] ?? '',
          guardianName: 'Başka Veli',
        }),
        row({
          line: 5,
          className: '5-B',
          campus: 'Kadıköy Kampüsü',
          identityNumber: TC[3] ?? '',
          relationship: 'Baba',
        }),
      ],
      context(),
    )
    assert.equal(plan.rows[1]?.guardianMatch, 'file')
    assert.deepEqual(codes(plan.rows[1]?.notices ?? []), ['sibling_in_file'])
    assert.deepEqual(codes(plan.rows[2]?.issues ?? []), ['guardian_phone_conflict'])
    assert.deepEqual(codes(plan.rows[3]?.issues ?? []), ['guardian_relationship_conflict'])
    assert.equal(plan.newGuardianCount, 1)
  })

  const withParent = (overrides: object = {}) =>
    state({
      parents: [
        {
          id: 'p-1',
          name: 'Ayla Demir',
          phone: '05321110001',
          relationship: 'mother',
          studentIds: ['s-1'],
          ...overrides,
        },
      ] as StudentImportState['parents'],
    })

  test('kurumdaki veliyle eşleşme gösterilir, onayla bağlanır (DOM-KAY-013)', () => {
    const plan = planStudentImport(withParent(), [row()], context())
    assert.equal(plan.rows[0]?.guardianMatch, 'existing')
    assert.deepEqual(codes(plan.rows[0]?.notices ?? []), ['existing_guardian'])
    assert.equal(plan.existingGuardianCount, 1)
    assert.equal(plan.newGuardianCount, 0)
    const again = planStudentImport(
      withParent(),
      [row({ line: 2 }), row({ line: 3, identityNumber: TC[1] ?? '' })],
      context(),
    )
    assert.equal(again.rows[1]?.guardianMatch, 'existing')
    assert.deepEqual(codes(again.rows[1]?.notices ?? []), ['sibling_in_file'])
  })

  test('kurumdaki veliyle ad ya da yakınlık uyuşmazlığı ve çift kayıt hatadır', () => {
    assert.deepEqual(
      codes(
        planStudentImport(withParent(), [row({ guardianName: 'Sena Kaya' })], context()).issues,
      ),
      ['guardian_phone_conflict'],
    )
    assert.deepEqual(
      codes(planStudentImport(withParent(), [row({ relationship: 'Baba' })], context()).issues),
      ['guardian_relationship_conflict'],
    )
    const twins = state({
      parents: [
        { id: 'p-1', name: 'Ayla Demir', phone: '05321110001', studentIds: [] },
        { id: 'p-2', name: 'Ayla Demir', phone: '05321110001', studentIds: [] },
      ] as StudentImportState['parents'],
    })
    assert.deepEqual(codes(planStudentImport(twins, [row()], context()).issues), [
      'guardian_ambiguous',
    ])
  })

  test('velayetsiz ya da kısıtlı veliye bağlanmaz; yetişkinin kendi satırı eşleşmez (DOM-ILT-070, -074)', () => {
    const restricted = context({
      bonds: [{ parentId: 'p-1', custody: 'none', contactRestricted: true }],
    })
    assert.deepEqual(codes(planStudentImport(withParent(), [row()], restricted).issues), [
      'parent_not_guardian',
    ])
    const self = planStudentImport(withParent({ relationship: 'self' }), [row()], context())
    assert.equal(self.rows[0]?.guardianMatch, 'new')
  })

  const held = (isActive: boolean, name = 'Ece Demir') => ({
    students: state({
      students: [
        { id: 's-9', name, classId: 'c-1', parentId: 'p', isActive },
      ] as StudentImportState['students'],
    }),
    context: context({ identityHolders: new Map([[TC[0] ?? '', 's-9']]) }),
  })

  test('kayıtlı kimlik: aynı adlı etkin öğrenci atlanır, ikinci yükleme mükerrer açmaz (IST-007)', () => {
    const { students, context: ctx } = held(true)
    const plan = planStudentImport(students, [row()], ctx)
    assert.deepEqual(plan.issues, [])
    assert.deepEqual(plan.students, [])
    assert.equal(plan.rows[0]?.status, 'skipped')
    assert.deepEqual(codes(plan.rows[0]?.notices ?? []), ['already_imported'])
  })

  test('kayıtlı kimlik: başka ad ve pasif öğrenci hatadır (DOM-KAY-012)', () => {
    const other = held(true, 'Başka Ad')
    assert.deepEqual(codes(planStudentImport(other.students, [row()], other.context).issues), [
      'student_identity_conflict',
    ])
    const passive = held(false)
    assert.deepEqual(codes(planStudentImport(passive.students, [row()], passive.context).issues), [
      'student_identity_inactive',
    ])
  })

  test('doğum tarihi geçmiş bir gün olmalı; öğrenci telefonu doğrulanır', () => {
    const plan = planStudentImport(
      state(),
      [
        row({ birthDate: '2026-10-06' }),
        row({ identityNumber: TC[1] ?? '', studentPhone: '123', guardianPhone: '05321110002' }),
        row({ identityNumber: TC[2] ?? '', name: 'X', guardianPhone: '05321110003' }),
      ],
      context(),
    )
    assert.deepEqual(codes(plan.rows[0]?.issues ?? []), ['birth_date_invalid'])
    assert.deepEqual(codes(plan.rows[1]?.issues ?? []), ['student_phone_invalid'])
    assert.deepEqual(codes(plan.rows[2]?.issues ?? []), ['name_invalid'])
  })

  test('kursta 18 yaş üstünde veli alınmaz, altında zorunlu; okulda her yaşta zorunlu (DOM-KAY-012)', () => {
    const course = context({ institutionType: 'language_school' })
    const adult = { birthDate: '1999-03-14', guardianName: '', guardianPhone: '', relationship: '' }
    const self = planStudentImport(state(), [row(adult)], course)
    assert.equal(self.rows[0]?.guardianMatch, 'self')
    assert.equal(self.rows[0]?.relationship, null)
    assert.deepEqual(self.issues, [])
    assert.deepEqual(
      codes(planStudentImport(state(), [row({ birthDate: '1999-03-14' })], course).issues),
      ['guardian_not_applicable'],
    )
    assert.ok(
      codes(
        planStudentImport(state(), [row({ ...adult, birthDate: '2015-01-01' })], course).issues,
      ).includes('guardian_name_required'),
    )
    assert.ok(
      codes(planStudentImport(state(), [row(adult)], context()).issues).includes(
        'guardian_phone_invalid',
      ),
    )
  })

  test('planlama durumu değiştirmez (doğrulama hatasında kayıt değişmez)', () => {
    const before = withParent()
    const copy = structuredClone(before)
    planStudentImport(before, [row(), row({ identityNumber: 'x' })], context())
    assert.deepEqual(before, copy)
  })
})

describe('applyStudentImport (ON-060)', () => {
  let counter = 0
  const makeId = (prefix: string) => `${prefix}-${++counter}`

  test('kardeşler tek veli kaydı açar; öğrenciye velinin telefonu yazılmaz (DOM-KAY-003, -013)', () => {
    const target = state()
    const plan = planStudentImport(
      target,
      [
        row({ line: 2, className: '5-B', campus: 'Kadıköy Kampüsü' }),
        row({
          line: 3,
          className: '5-B',
          campus: 'Kadıköy Kampüsü',
          identityNumber: TC[1] ?? '',
          name: 'Can Demir',
          studentPhone: '05321110099',
        }),
      ],
      context(),
    )
    const applied = applyStudentImport(target, plan.students, makeId, NOW)
    assert.equal(target.parents.length, 1)
    assert.equal(target.students.length, 2)
    const parent = target.parents[0]
    assert.deepEqual(
      parent?.studentIds,
      target.students.map((student) => student.id),
    )
    assert.equal(parent?.relationship, 'mother')
    assert.equal(target.students[0]?.phone, '')
    assert.equal(target.students[1]?.phone, '05321110099')
    assert.equal(target.students[0]?.joinedAt, NOW)
    assert.ok(applied.every((item) => item.bond?.parentId === parent?.id && !item.bond?.existing))
    assert.equal(applied[1]?.identity.number, TC[1])
  })

  test('mevcut veliye eklenir, yeni veli açılmaz; yetişkin kendi satırını alır', () => {
    const target = state({
      parents: [
        {
          id: 'p-1',
          name: 'Ayla Demir',
          phone: '05321110001',
          relationship: 'mother',
          studentIds: ['s-1'],
        },
      ] as StudentImportState['parents'],
    })
    const plan = planStudentImport(target, [row()], context())
    const [one] = applyStudentImport(target, plan.students, makeId, NOW)
    assert.equal(target.parents.length, 1)
    assert.deepEqual(target.parents[0]?.studentIds, ['s-1', one?.studentId])
    assert.equal(one?.bond?.existing, true)

    const course = state()
    const adultPlan = planStudentImport(
      course,
      [row({ birthDate: '1999-03-14', guardianName: '', guardianPhone: '', relationship: '' })],
      context({ institutionType: 'language_school' }),
    )
    const [adult] = applyStudentImport(course, adultPlan.students, makeId, NOW)
    assert.equal(adult?.bond, null)
    assert.equal(course.parents[0]?.relationship, 'self')
    assert.equal(course.parents[0]?.name, 'Ece Demir')
  })
})
