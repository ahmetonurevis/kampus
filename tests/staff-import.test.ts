import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { delimitedRecords, delimitedRows } from '../packages/school-core/src/lib/delimited-input.ts'
import { DomainError } from '../packages/school-core/src/lib/errors.ts'
import {
  parseStaffImport,
  parseStaffRole,
  planStaffImport,
  STAFF_IMPORT_MAX_ROWS,
  STAFF_IMPORT_SAMPLE,
  staffImportInputSchema,
  type StaffImportContext,
} from '../packages/school-core/src/lib/staff-import.ts'

const context: StaffImportContext = {
  memberEmails: new Set(['uye@okul.example']),
  pendingEmails: new Set(['bekleyen@okul.example']),
  teachers: [
    {
      id: 't-a',
      name: 'Selin Kaya',
      email: 'selin@okul.example',
      subjectId: 'math',
      branchId: 'b1',
    },
    { id: 't-b', name: 'Mert Ak', email: '', subjectId: 'science', branchId: 'b2' },
    {
      id: 't-c',
      name: 'Bağlı Kişi',
      email: 'bagli@okul.example',
      subjectId: 'math',
      branchId: 'b1',
    },
    { id: 't-d', name: 'İkiz Ad', email: '', subjectId: 'math', branchId: 'b1' },
    { id: 't-e', name: 'İkiz Ad', email: '', subjectId: 'math', branchId: 'b1' },
  ],
  linkedTeacherIds: new Set(['t-c']),
  pendingTeacherIds: new Set(),
  campuses: [
    { id: 'b1', name: 'Kadıköy Kampüsü' },
    { id: 'b2', name: 'Beşiktaş Kampüsü' },
  ],
  subjects: [
    { id: 'math', name: 'Matematik' },
    { id: 'science', name: 'Fen Bilimleri' },
  ],
}

function domainCode(run: () => unknown): string | undefined {
  try {
    run()
  } catch (error) {
    if (error instanceof DomainError) return error.code
    throw error
  }
  return undefined
}

const csv = (...lines: string[]) => lines.join('\n')
const plan = (raw: string) => planStaffImport(parseStaffImport(raw), context)
const codes = (raw: string) =>
  plan(raw).issues.map((issue) => `${issue.line}:${issue.field ?? '-'}:${issue.code}`)
const many = (count: number) =>
  csv(
    'ad;e-posta;rol',
    ...Array.from({ length: count }, (_, i) => `Kişi ${i};k${i}@okul.example;onburo`),
  )

describe('toplu personel aktarımı (IST-007, DOM-YTK-070)', () => {
  test('IST-007: örnek dosya ayrışır; başlık takma adla ve sırasız eşleşir, isteğe bağlı sütun olmayabilir', () => {
    const sample = parseStaffImport(STAFF_IMPORT_SAMPLE)
    assert.equal(sample.length, 2)
    assert.equal(sample[0]?.subject, 'Matematik')
    assert.deepEqual(
      plan(STAFF_IMPORT_SAMPLE).issues.map((issue) => issue.code),
      ['teacher_not_found'],
    )
    const rows = parseStaffImport(
      '\uFEFFE-Posta,Rol,Ad Soyad\r\nali@okul.example,Yönetici,Ali Can\r\n',
    )
    assert.deepEqual(rows, [
      {
        line: 2,
        name: 'Ali Can',
        email: 'ali@okul.example',
        role: 'Yönetici',
        subject: '',
        campus: '',
        extraCells: false,
      },
    ])
  })

  test('IST-007: dosya düzeyindeki sorunlar DomainError; 1.001 satır reddedilir, 1.000 kabul', () => {
    assert.equal(
      domainCode(() => parseStaffImport('')),
      'csv_empty',
    )
    assert.equal(
      domainCode(() => parseStaffImport('ad;e-posta;rol')),
      'csv_no_rows',
    )
    assert.equal(
      domainCode(() => parseStaffImport('ad;e-posta\nA;b')),
      'csv_missing_column',
    )
    assert.equal(
      domainCode(() => parseStaffImport('ad;e-posta;rol;yas\nA;b;c;1')),
      'csv_unknown_column',
    )
    assert.equal(
      domainCode(() => parseStaffImport('ad;ad soyad;e-posta;rol\nA;B;b;c')),
      'csv_duplicate_column',
    )
    assert.equal(
      domainCode(() => parseStaffImport('ad;e-posta;rol\n"A;b;c')),
      'csv_unclosed_quote',
    )
    assert.equal(parseStaffImport(many(STAFF_IMPORT_MAX_ROWS)).length, STAFF_IMPORT_MAX_ROWS)
    assert.equal(plan(many(STAFF_IMPORT_MAX_ROWS)).invitations.length, STAFF_IMPORT_MAX_ROWS)
    assert.throws(
      () => parseStaffImport(many(STAFF_IMPORT_MAX_ROWS + 1)),
      (error) =>
        error instanceof DomainError &&
        error.code === 'csv_too_many_rows' &&
        /1\.000/.test(error.message),
    )
  })

  test('IST-007: satır numarası dosyadaki fiziksel satırdır (boş satır ve tırnak içi satır sonu)', () => {
    const rows = parseStaffImport(
      csv('ad;e-posta;rol', '', '"Ali', 'Can";a@okul.example;onburo', 'Veli;v@okul.example;onburo'),
    )
    assert.deepEqual(
      rows.map((row) => row.line),
      [3, 5],
    )
    assert.deepEqual(delimitedRows('a;b\n1;2'), [
      ['a', 'b'],
      ['1', '2'],
    ])
    assert.equal(delimitedRecords('a\n\nb')[1]?.line, 3)
    assert.equal(
      domainCode(() => delimitedRecords('a;b\n1;x"y')),
      'csv_invalid_quote',
    )
    assert.equal(
      domainCode(() => delimitedRecords('a;b\n"1"x;2')),
      'csv_invalid_character',
    )
  })

  test('DOM-YTK-070: rol kod ya da etiketle; personel dışı rol geçersiz', () => {
    assert.equal(parseStaffRole('Öğretmen'), 'ogretmen')
    assert.equal(parseStaffRole('ÖN BÜRO'), 'onburo')
    assert.equal(parseStaffRole('Ön Büro & Satış'), 'onburo')
    assert.equal(parseStaffRole('yonetici'), 'yonetici')
    assert.equal(parseStaffRole('veli'), null)
    assert.equal(parseStaffRole('ogrenci'), null)
  })

  test('IST-007: geçerli dosya davet listesi verir; öğretmen e-postayla ya da ad, branş ve kampüsle bağlanır', () => {
    const result = plan(
      csv(
        'ad;e-posta;rol;branş;kampüs',
        'Selin Kaya;SELIN@okul.example;Öğretmen;;',
        'Mert Ak;mert@okul.example;ogretmen;science;b2',
        'Yeni Öğretmen;yeni@okul.example;ogretmen;;',
        'Ali Can;ali@okul.example;Ön büro;;',
      ),
    )
    assert.deepEqual(result.issues, [])
    assert.deepEqual(result.invitations, [
      {
        line: 2,
        name: 'Selin Kaya',
        email: 'selin@okul.example',
        role: 'ogretmen',
        teacherId: 't-a',
      },
      { line: 3, name: 'Mert Ak', email: 'mert@okul.example', role: 'ogretmen', teacherId: 't-b' },
      { line: 4, name: 'Yeni Öğretmen', email: 'yeni@okul.example', role: 'ogretmen' },
      { line: 5, name: 'Ali Can', email: 'ali@okul.example', role: 'onburo' },
    ])
  })

  test('IST-007: tek hatalı satır bütün daveti boşaltır; hatalar satır ve alanla döner', () => {
    const result = plan(
      csv(
        'ad;e-posta;rol',
        'Ali Can;ali@okul.example;onburo',
        'A;gecersiz;veli',
        'Uye Kisi;UYE@okul.example;onburo',
        'Bekleyen;bekleyen@okul.example;onburo',
        'Ali İkinci;ali@okul.example;yonetici',
      ),
    )
    assert.deepEqual(result.invitations, [])
    assert.deepEqual(
      result.issues.map((issue) => `${issue.line}:${issue.field ?? '-'}:${issue.code}`),
      [
        '3:name:name_invalid',
        '3:email:email_invalid',
        '3:role:role_invalid',
        '4:email:member_exists',
        '5:email:invitation_exists',
        '6:email:duplicate_email',
      ],
    )
    const message = (code: string) => result.issues.find((issue) => issue.code === code)?.message
    assert.equal(message('duplicate_email'), 'Bu e-posta dosyanın 2. satırında da var.')
    assert.equal(message('member_exists'), 'Bu e-posta adresi kurumda zaten kayıtlı.')
    assert.equal(message('email_invalid'), 'Geçerli bir e-posta adresi girin.')
  })

  test('DOM-YTK-070: branş ve kampüs yalnız öğretmende, kayıtla uyuşmalı; bağlı ve belirsiz kayıt reddedilir', () => {
    assert.deepEqual(
      codes(
        csv(
          'ad;e-posta;rol;branş;kampüs;',
          'Ali Can;ali@okul.example;onburo;Matematik;Kadıköy Kampüsü',
          'Selin Kaya;selin@okul.example;ogretmen;Fen Bilimleri;Beşiktaş Kampüsü',
          'Kim Bu;kim@okul.example;ogretmen;Matematik;Kadıköy Kampüsü',
          'X Y;xy@okul.example;ogretmen;Tarih;Ankara',
          'Bağlı Kişi;bagli@okul.example;ogretmen;;',
          'İkiz Ad;ikiz@okul.example;ogretmen;Matematik;Kadıköy Kampüsü',
          'Fazla;fazla@okul.example;onburo;;;taşan',
        ),
      ),
      [
        '2:subject:teacher_only',
        '2:campus:teacher_only',
        '3:subject:subject_mismatch',
        '3:campus:campus_mismatch',
        '4:-:teacher_not_found',
        '5:subject:subject_unknown',
        '5:campus:campus_unknown',
        '6:-:teacher_already_linked',
        '7:-:teacher_ambiguous',
        '8:-:extra_cells',
      ],
    )
  })

  test('DOM-YTK-070: aynı öğretmen kaydı iki satırda bağlanamaz', () => {
    assert.deepEqual(
      codes(
        csv(
          'ad;e-posta;rol;branş;kampüs',
          'Mert Ak;mert@okul.example;ogretmen;science;b2',
          'Mert Ak;mert.ak@okul.example;ogretmen;Fen Bilimleri;Beşiktaş Kampüsü',
        ),
      ),
      ['3:-:duplicate_teacher'],
    )
  })

  test('DOM-YTK-070: ad, branş ve kampüsle eşleşme yalnız e-postasız kayda bağlanır', () => {
    // Selin Kaya kaydının e-postası selin@: başka e-postalı adaşı o kayda bağlanmaz.
    const result = plan(
      csv(
        'ad;e-posta;rol;branş;kampüs',
        'Selin Kaya;baska@okul.example;ogretmen;Matematik;Kadıköy Kampüsü',
        'Mert Ak;mert@okul.example;ogretmen;Fen Bilimleri;Beşiktaş Kampüsü',
      ),
    )
    assert.deepEqual(
      result.issues.map((issue) => `${issue.line}:${issue.field ?? '-'}:${issue.code}`),
      ['2:-:teacher_email_mismatch'],
    )
    assert.match(result.issues[0]?.message ?? '', /başka bir e-posta/)
    assert.deepEqual(result.invitations, [])
    // Aynı ad, branş ve kampüste e-postalı ve e-postasız iki kayıt: e-postasız olana bağlanır.
    const mixed = planStaffImport(
      parseStaffImport(
        csv('ad;e-posta;rol;branş;kampüs', 'Mert Ak;mert@okul.example;ogretmen;science;b2'),
      ),
      {
        ...context,
        teachers: [
          ...context.teachers,
          {
            id: 't-f',
            name: 'Mert Ak',
            email: 'mert.baska@okul.example',
            subjectId: 'science',
            branchId: 'b2',
          },
        ],
      },
    )
    assert.deepEqual(mixed.issues, [])
    assert.equal(mixed.invitations[0]?.teacherId, 't-b')
  })

  test('DOM-YTK-070: bekleyen davetin tuttuğu öğretmen kaydı bağlanamaz', () => {
    const result = planStaffImport(
      parseStaffImport(
        csv(
          'ad;e-posta;rol;branş;kampüs',
          'Selin Kaya;selin@okul.example;ogretmen;;',
          'Mert Ak;mert@okul.example;ogretmen;science;b2',
        ),
      ),
      { ...context, pendingTeacherIds: new Set(['t-b']) },
    )
    assert.deepEqual(
      result.issues.map((issue) => `${issue.line}:${issue.field ?? '-'}:${issue.code}`),
      ['3:-:teacher_invitation_pending'],
    )
    assert.deepEqual(result.invitations, [])
  })

  test('IST-007: gövde şeması dryRun varsayılanı false; boş ve fazladan alan reddedilir', () => {
    assert.deepEqual(staffImportInputSchema.parse({ csv: 'x' }), { csv: 'x', dryRun: false })
    assert.equal(staffImportInputSchema.safeParse({ csv: '' }).success, false)
    assert.equal(staffImportInputSchema.safeParse({ csv: 'x', institutionId: 'i' }).success, false)
  })
})
