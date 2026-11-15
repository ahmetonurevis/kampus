import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  applyEokulImport,
  eokulImportInputSchema,
  eokulNameCase,
  parseEokulClass,
  planEokulImport,
  readEokulTable,
  suggestEokulMapping,
  type EokulImportContext,
  type EokulImportOptions,
  type EokulImportState,
  type EokulMapping,
} from '../packages/school-core/src/lib/enrollment-eokul-import.ts'
import { isValidTurkishId } from '../packages/school-core/src/lib/enrollment.ts'
import { DomainError } from '../packages/school-core/src/lib/errors.ts'

// e-Okul öğrenci listesinden içe aktarım (ON-062, IST-134; DOM-KAY-042): saf kural.

const NOW = '2026-10-06T09:00:00.000Z'

/** Denetim haneleri doğru T.C. kimlik numarası (`isValidTurkishId`). */
function tc(seed: number): string {
  const digits = [...String(100_000_000 + seed)].map(Number)
  const at = (index: number) => digits[index] ?? 0
  const tenth =
    ((((at(0) + at(2) + at(4) + at(6) + at(8)) * 7 - (at(1) + at(3) + at(5) + at(7))) % 10) + 10) %
    10
  const eleventh = (digits.reduce((sum, digit) => sum + digit, 0) + tenth) % 10
  return `${digits.join('')}${tenth}${eleventh}`
}

type Student = EokulImportState['students'][number]
const student = (overrides: Partial<Student> & { id: string }): Student =>
  ({
    name: 'Deniz Yılmaz',
    classId: 'c-9a',
    parentId: 'p-1',
    email: '',
    phone: '',
    joinedAt: NOW,
    isActive: true,
    progress: 0,
    ...overrides,
  }) as Student

function state(overrides: Partial<EokulImportState> = {}): EokulImportState {
  return {
    students: [],
    parents: [],
    classes: [
      {
        id: 'c-9a',
        name: '9-A',
        branchId: 'b-1',
        capacity: 30,
        grade: 9,
        section: 'A',
        isActive: true,
      },
      {
        id: 'c-9b',
        name: '9-B',
        branchId: 'b-1',
        capacity: 1,
        grade: 9,
        section: 'B',
        isActive: true,
      },
      {
        id: 'c-10a',
        name: '10-A',
        branchId: 'b-1',
        capacity: 30,
        grade: 10,
        section: 'A',
        isActive: true,
      },
      { id: 'c-7a-1', name: '7-A', branchId: 'b-1', capacity: 30, grade: 7, isActive: true },
      { id: 'c-7a-2', name: '7-A', branchId: 'b-2', capacity: 30, grade: 7, isActive: true },
    ],
    branches: [
      { id: 'b-1', name: 'Kadıköy Kampüsü', isActive: true },
      { id: 'b-2', name: 'Moda Kampüsü', isActive: true },
    ],
    renewals: [],
    prospects: [],
    ...overrides,
  } as EokulImportState
}

const context = (overrides: Partial<EokulImportContext> = {}): EokulImportContext => ({
  institutionType: 'school',
  today: '2026-10-06',
  now: NOW,
  identities: new Map(),
  bonds: [],
  ...overrides,
})

const HEADER =
  'S.No;Okul No;T.C. Kimlik No;Adı;Soyadı;Cinsiyeti;Sınıfı/Şubesi;Doğum Tarihi;Veli Adı Soyadı;Veli Cep Telefonu'
const file = (...lines: string[]) =>
  ['ATATÜRK ANADOLU LİSESİ;;;;;;;;;', 'Öğrenci Listesi;;;;;;;;;', HEADER, ...lines].join('\n')
const line = (
  no: string,
  id: string,
  first: string,
  last: string,
  klass: string,
  birth = '14.03.2010',
  guardian = 'AYLA DEMİR',
  phone = '05321110001',
) => `1;${no};${id};${first};${last};Kız;${klass};${birth};${guardian};${phone}`

function plan(
  raw: string,
  st = state(),
  ctx = context(),
  options: Partial<EokulImportOptions> = {},
) {
  const table = readEokulTable(raw)
  const mapping: EokulMapping = options.mapping ?? suggestEokulMapping(table.headers)
  return { table, result: planEokulImport(st, table, ctx, { ...options, mapping }) }
}

const codes = (issues: readonly { code: string }[]) => issues.map((issue) => issue.code)

describe('e-Okul dosyası okuma ve eşleme önerisi (IST-134, ON-062)', () => {
  test('DOM-KAY-042: başlık rapor satırlarından sonra bulunur, sütunlar önerilir', () => {
    const { table } = plan(file(line('101', tc(1), 'ECE', 'DEMİR', '9. Sınıf / A Şubesi')))
    assert.equal(table.headerLine, 3)
    assert.equal(table.rows.length, 1)
    assert.deepEqual(suggestEokulMapping(table.headers), {
      schoolNumber: 1,
      identityNumber: 2,
      firstName: 3,
      lastName: 4,
      className: 6,
      birthDate: 7,
      guardianName: 8,
      guardianPhone: 9,
    })
  })

  test('DOM-KAY-042: ayrı Sınıf ve Şube sütunları, tek Ad Soyad sütunu önerilir', () => {
    assert.deepEqual(
      suggestEokulMapping(['Öğrenci No', 'TCKN', 'Adı Soyadı', 'Adı', 'Sınıf', 'Şube']),
      { schoolNumber: 0, identityNumber: 1, fullName: 2, grade: 4, section: 5 },
    )
  })

  test('DOM-KAY-042: başlıksız dosya, boş dosya ve satır sınırı dosya düzeyinde reddedilir', () => {
    assert.throws(
      () => readEokulTable('Ece Demir;10000000146\nCan Demir;10000000078'),
      (error) => error instanceof DomainError && error.code === 'import_file_header_not_found',
    )
    assert.throws(
      () => readEokulTable(''),
      (error) => error instanceof DomainError && error.code === 'csv_empty',
    )
    assert.throws(
      () => readEokulTable(HEADER),
      (error) => error instanceof DomainError && error.code === 'csv_no_rows',
    )
    const many = Array.from({ length: 3001 }, (_, index) =>
      line(String(index + 1), '', 'A', 'B', '9/A'),
    )
    assert.throws(
      () => readEokulTable(file(...many)),
      (error) => error instanceof DomainError && error.code === 'csv_too_many_rows',
    )
  })

  test('DOM-KAY-042: sayfa başında yinelenen başlık ve boş öğrenci satırı atlanır', () => {
    const { result } = plan(
      file(
        line('101', tc(2), 'Ece', 'Demir', '9/A'),
        HEADER,
        '9. Sınıf / B Şubesi;;;;;;;;;',
        line('102', tc(3), 'Can', 'Demir', '9/A'),
      ),
    )
    assert.deepEqual(
      result.rows.map((row) => row.line),
      [4, 7],
    )
  })

  test('sınıf hücresi biçimleri ve büyük harfli ad', () => {
    for (const cell of ['9. Sınıf / A Şubesi', '9/A', '9-A', '9 A', '9A', '9. SINIF / A ŞUBESİ'])
      assert.deepEqual(parseEokulClass(cell), { grade: 9, section: 'A' }, cell)
    assert.equal(parseEokulClass('Hazırlık Sınıfı / A Şubesi'), null)
    assert.equal(parseEokulClass('13/A'), null)
    assert.equal(eokulNameCase('İLKNUR ÇAĞLA IŞIK'), 'İlknur Çağla Işık')
    assert.equal(eokulNameCase('Deniz  de Souza'), 'Deniz de Souza')
    assert.ok(isValidTurkishId(tc(9)))
  })
})

describe('e-Okul eşleme denetimi (IST-134)', () => {
  test('DOM-KAY-042: zorunlu eşleme, çakışan ve dosyada olmayan sütun satır işlemeden döner', () => {
    const raw = file(line('101', tc(4), 'Ece', 'Demir', '9/A'))
    const { result } = plan(raw, state(), context(), {
      mapping: { firstName: 3, schoolNumber: 3, birthDate: 40, className: 6, grade: 6 },
    })
    assert.deepEqual(codes(result.mappingIssues).sort(), [
      'class_column_conflict',
      'column_duplicate',
      'column_duplicate',
      'column_missing',
      'name_column_required',
    ])
    assert.equal(result.rows.length, 0)
    const none = plan(raw, state(), context(), { mapping: { firstName: 3, lastName: 4 } })
    assert.deepEqual(codes(none.result.mappingIssues), ['match_column_required'])
  })

  test('DOM-KAY-042: bilinmeyen kampüs ve kampüs dışındaki sabit sınıf eşleme sorunudur', () => {
    const raw = file(line('101', tc(5), 'Ece', 'Demir', ''))
    const { result } = plan(raw, state(), context(), { branchId: 'b-yok' })
    assert.deepEqual(codes(result.mappingIssues), ['campus_not_found'])
    const other = plan(raw, state(), context(), { branchId: 'b-2', fallbackClassId: 'c-9a' })
    assert.deepEqual(codes(other.result.mappingIssues), ['fallback_class_not_found'])
  })

  test('IST-134: onay gövdesi en az bir seçili satır ister, satır tekrarlanamaz', () => {
    const base = { fileBase64: 'QQ==' }
    assert.equal(eokulImportInputSchema.safeParse({ ...base, dryRun: true }).success, true)
    assert.equal(eokulImportInputSchema.safeParse({ ...base, dryRun: false }).success, false)
    assert.equal(
      eokulImportInputSchema.safeParse({ ...base, dryRun: false, lines: [4, 4] }).success,
      false,
    )
    assert.equal(
      eokulImportInputSchema.safeParse({ ...base, lines: [4], institutionId: 'x' }).success,
      false,
    )
  })
})

describe('e-Okul satır sınıflaması (IST-134; DOM-KAY-042)', () => {
  const known = tc(10)
  const existing = () =>
    state({
      students: [
        student({ id: 's-1', name: 'Deniz Yılmaz', classId: 'c-9a', number: '101' }),
        student({ id: 's-2', name: 'Ece Kaya', classId: 'c-9a', number: '102' }),
        student({ id: 's-3', name: 'Mert Can', classId: 'c-9a', number: '103' }),
        student({
          id: 's-pasif',
          name: 'Lale Ak',
          classId: 'c-9a',
          number: '104',
          isActive: false,
        }),
      ],
    })
  const withIdentities = context({
    identities: new Map([
      ['s-1', { number: known, birthDate: '2010-03-14' }],
      ['s-pasif', { number: tc(11), birthDate: '2010-01-01' }],
    ]),
  })

  test('DOM-KAY-042: T.C. kimlikle eşleşen öğrencide değişiklik yok, büyük harf fark sayılmaz', () => {
    const { result } = plan(
      file(line('101', known, 'DENİZ', 'YILMAZ', '9/A')),
      existing(),
      withIdentities,
    )
    assert.equal(result.rows[0]?.status, 'unchanged')
    assert.deepEqual(result.rows[0]?.changes, [])
    assert.deepEqual(result.updates, [])
  })

  test('DOM-KAY-042: okul numarasıyla eşleşen öğrenciye ad, şube ve eksik kimlik yazılacak', () => {
    const id = tc(12)
    const { result } = plan(
      file(line('102', id, 'Ece', 'Kaya', '9/B', '01.02.2010')),
      existing(),
      withIdentities,
    )
    const row = result.rows[0]
    assert.equal(row?.status, 'update')
    assert.deepEqual(
      row?.changes.map((change) => change.field),
      ['class', 'identity'],
    )
    assert.deepEqual(
      row?.changes.find((change) => change.field === 'identity'),
      {
        field: 'identity',
        before: null,
        after: null,
      },
    )
    assert.deepEqual(result.updates, [
      { studentId: 's-2', classId: 'c-9b', identity: { number: id, birthDate: '2010-02-01' } },
    ])
    assert.ok(!JSON.stringify(result.rows).includes(id), 'tam kimlik önizlemede olmamalı')
  })

  test('DOM-KAY-042: düzey farkı sınıfı değiştirmez, doğum tarihi farkı bilgi olarak döner', () => {
    const { result } = plan(
      file(line('109', known, 'Deniz', 'Yılmaz Öz', '10/A', '15.03.2010')),
      existing(),
      withIdentities,
    )
    const row = result.rows[0]
    assert.equal(row?.status, 'update')
    assert.deepEqual(
      row?.changes.map((change) => [change.field, change.before, change.after]),
      [
        ['name', 'Deniz Yılmaz', 'Deniz Yılmaz Öz'],
        ['schoolNumber', '101', '109'],
      ],
    )
    assert.deepEqual(codes(row?.notices ?? []), ['grade_change_skipped', 'birth_date_differs'])
  })

  test('DOM-KAY-042: çakışan eşleşme, pasif öğrenci, farklı kimlik ve ad hatalıdır', () => {
    const { result } = plan(
      file(
        line('102', known, 'Deniz', 'Yılmaz', '9/A'),
        line('104', tc(11), 'Lale', 'Ak', '9/A'),
        line('101', tc(13), 'Deniz', 'Yılmaz', '9/A'),
        line('103', '', 'Başka', 'Ad', '9/A'),
      ),
      existing(),
      withIdentities,
    )
    assert.deepEqual(
      result.rows.map((row) => [row.status, codes(row.issues)]),
      [
        ['invalid', ['match_conflict']],
        ['invalid', ['student_inactive']],
        ['invalid', ['identity_mismatch']],
        ['invalid', ['school_number_name_mismatch']],
      ],
    )
    assert.deepEqual(result.updates, [])
    assert.deepEqual(result.created, [])
  })

  test('DOM-KAY-042: hücre hataları ve dosya içindeki tekrar satırda raporlanır', () => {
    const id = tc(14)
    const { result } = plan(
      file(
        line('201', id, 'Ece', 'Demir', '9/A'),
        line('201', id, 'Can', 'Demir', '9/A'),
        line('', '12345678901', 'X', '', '9/A', '2099-01-01'),
        line('', '', 'Adsız', 'Numara', '9/A'),
        line('20A', '', 'Ali', 'Veli', '9/A'),
      ),
    )
    assert.deepEqual(
      result.rows.map((row) => codes(row.issues).sort()),
      [
        [],
        ['duplicate_identity', 'duplicate_school_number'],
        ['birth_date_invalid', 'identity_invalid', 'name_invalid'],
        ['match_key_required'],
        ['school_number_invalid'],
      ],
    )
    assert.equal(result.rows[0]?.status, 'new')
    assert.equal(result.created.length, 0, 'hatalı satır varken hiçbir şey yazılmaz')
  })

  test('DOM-KAY-012, DOM-KAY-042: yeni öğrenci pilot kuralıyla doğrulanır; veli zorunlu, sınıf yoksa hata', () => {
    const { result } = plan(
      file(
        line('301', tc(15), 'Ece', 'Demir', '9/A'),
        line('302', tc(16), 'Can', 'Demir', '9/A', '02.09.2011', '', ''),
        line('303', tc(17), 'Ali', 'Kurt', '11/C'),
        line('304', tc(18), 'Su', 'Ay', '7/A'),
        line('305', '', 'Yeni', 'Numara', '9/A'),
      ),
    )
    assert.deepEqual(
      result.rows.map((row) => [row.status, codes(row.issues).sort()]),
      [
        ['new', []],
        ['invalid', ['guardian_name_required', 'guardian_phone_invalid']],
        ['invalid', ['class_not_found']],
        ['invalid', ['class_ambiguous']],
        ['invalid', ['identity_required_for_new']],
      ],
    )
    assert.equal(result.rows[1]?.issues[0]?.field, 'guardianName')
    assert.equal(result.rows[0]?.guardianMatch, 'new')
    assert.equal(result.rows[0]?.guardianPhoneMasked.includes('1110001'), false)
  })

  test('DOM-KAY-042: kampüs seçimi aynı adlı sınıfı ayırır, sabit sınıf sınıfsız dosyaya uygulanır', () => {
    const raw = file(line('401', tc(19), 'Su', 'Ay', '7/A'))
    const scoped = plan(raw, state(), context(), { branchId: 'b-2' })
    assert.equal(scoped.result.rows[0]?.status, 'new')
    assert.equal(scoped.result.created[0]?.classId, 'c-7a-2')
    const noClass = file(line('402', tc(20), 'Su', 'Ay', ''))
    const fixed = plan(noClass, state(), context(), { fallbackClassId: 'c-10a' })
    assert.equal(fixed.result.created[0]?.classId, 'c-10a')
    const missing = plan(noClass)
    assert.deepEqual(codes(missing.result.rows[0]?.issues ?? []), ['class_required'])
  })

  test('DOM-KAY-010: şube değişikliği kontenjanı tüketir, yeni öğrenci aynı sayımı görür', () => {
    const st = state({
      students: [student({ id: 's-1', name: 'Deniz Yılmaz', classId: 'c-9a', number: '101' })],
    })
    const { result } = plan(
      file(line('101', '', 'Deniz', 'Yılmaz', '9/B'), line('501', tc(21), 'Ece', 'Demir', '9/B')),
      st,
      context(),
    )
    assert.deepEqual(
      result.rows.map((row) => [row.status, codes(row.issues)]),
      [
        ['update', []],
        ['invalid', ['class_capacity_full']],
      ],
    )
  })

  test('IST-134: yalnız seçilen satırlar planlanır; dosyada olmayan satır hatadır', () => {
    const raw = file(
      line('601', tc(22), 'Ece', 'Demir', '9/A'),
      line('602', '123', 'Bozuk', 'Satır', '9/A'),
    )
    const { result } = plan(raw, state(), context(), { lines: [4] })
    assert.deepEqual(
      result.rows.map((row) => row.line),
      [4],
    )
    assert.equal(result.created.length, 1)
    const wrong = plan(raw, state(), context(), { lines: [4, 99] })
    assert.deepEqual(codes(wrong.result.issues), ['line_not_found'])
    assert.equal(wrong.result.created.length, 0)
  })
})

describe('e-Okul planının uygulanması (IST-134)', () => {
  test('DOM-KAY-042: güncelleme alanları ve yeni öğrencinin okul numarası yazılır, aynı veli bir kez açılır', () => {
    const st = state({
      students: [student({ id: 's-1', name: 'Deniz Yılmaz', classId: 'c-9a' })],
    })
    const known = tc(30)
    const ctx = context({
      identities: new Map([['s-1', { number: known, birthDate: '2010-03-14' }]]),
    })
    const { result } = plan(
      file(
        line('101', known, 'DENİZ', 'YILMAZ ÖZ', '9/A'),
        line('701', tc(31), 'Ece', 'Demir', '9/A'),
        line('702', tc(32), 'Can', 'Demir', '9/A'),
      ),
      st,
      ctx,
    )
    assert.equal(result.issues.length, 0)
    assert.equal(result.newGuardianCount, 1)
    let next = 0
    const applied = applyEokulImport(st, result, (prefix) => `yeni-${prefix}-${++next}`, NOW)
    assert.equal(applied.updatedCount, 1)
    assert.equal(applied.created.length, 2)
    assert.deepEqual(applied.identities, [])
    const deniz = st.students.find((item) => item.id === 's-1')
    assert.equal(deniz?.name, 'Deniz Yılmaz Öz')
    assert.equal(deniz?.number, '101')
    const created = st.students.filter((item) => item.id !== 's-1')
    assert.deepEqual(
      created.map((item) => [item.name, item.number, item.classId]),
      [
        ['Ece Demir', '701', 'c-9a'],
        ['Can Demir', '702', 'c-9a'],
      ],
    )
    assert.equal(st.parents.length, 1)
    assert.equal(st.parents[0]?.name, 'Ayla Demir')
  })
})
