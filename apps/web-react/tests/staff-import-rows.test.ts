import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { actionLabel } from '../src/pages/settings/audit-labels.ts'
import {
  decodeImportFile,
  importFileProblem,
  importFormSchema,
  importPreviewRows,
  importSummary,
  issueText,
  SAMPLE_CSV,
} from '../src/pages/settings/staff-import-rows.ts'

// Toplu personel aktarımı penceresinin modeli (IST-007, DOM-YTK-070).

const csv = [
  'ad;e-posta;rol;branş;kampüs',
  'Ali Can;ali@kampus.example;Ön büro;;',
  'Bora Er;bozuk;ogretmen;Matematik;Kadıköy Kampüsü',
  'Cem Su;cem@kampus.example;veli;;',
].join('\n')

describe('toplu personel aktarımı modeli (IST-007)', () => {
  test('IST-007: önizleme satırları dosya satırını, rol etiketini ve sunucunun satır hatalarını taşır', () => {
    const { rows, fileError } = importPreviewRows(csv, [
      {
        line: 3,
        field: 'email',
        code: 'email_invalid',
        message: 'Geçerli bir e-posta adresi girin.',
      },
      { line: 4, field: 'role', code: 'role_invalid', message: 'Rol geçersiz.' },
      { line: 4, field: null, code: 'extra_cells', message: 'Fazla hücre.' },
    ])
    assert.equal(fileError, null)
    assert.deepEqual(
      rows.map((row) => [row.line, row.roleLabel, row.status, row.problemText]),
      [
        [2, 'Ön büro', 'Hazır', ''],
        [3, 'Öğretmen', 'Hatalı', 'E-posta: Geçerli bir e-posta adresi girin.'],
        [4, 'veli', 'Hatalı', 'Rol: Rol geçersiz. · Fazla hücre.'],
      ],
    )
    assert.equal(rows[1]?.subject, 'Matematik')
    assert.equal(rows[1]?.campus, 'Kadıköy Kampüsü')
  })

  test('IST-007: dosya düzeyindeki sorun satırsız ve Türkçe iletiyle döner', () => {
    assert.deepEqual(importPreviewRows('ad;e-posta\nA;b', []), {
      rows: [],
      fileError: 'Başlıkta zorunlu sütun eksik: rol.',
    })
  })

  test('IST-007: özet hatalı satır ve hata sayısını ya da davet edilecek personeli verir', () => {
    assert.equal(importSummary(3, []), '3 satır doğrulandı · 3 personel davet edilecek')
    assert.equal(
      importSummary(3, [
        { line: 3, field: 'email', code: 'a', message: 'x' },
        { line: 3, field: 'name', code: 'b', message: 'y' },
        { line: 4, field: null, code: 'c', message: 'z' },
      ]),
      '3 satır · 2 satırda 3 hata · Hiçbir personel aktarılmadı',
    )
    assert.equal(
      issueText({ line: 2, field: 'subject', code: 'x', message: 'Yok.' }),
      'Branş: Yok.',
    )
  })

  test('IST-007: dosya seçimi CSV/TXT ve 1 MB ile sınırlı; Windows-1254 Türkçe harfleri çözülür', () => {
    assert.equal(importFileProblem({ name: 'personel.csv', size: 10 }), null)
    assert.equal(importFileProblem({ name: 'personel.TXT', size: 10 }), null)
    assert.ok(importFileProblem({ name: 'personel.xlsx', size: 10 }))
    assert.ok(importFileProblem({ name: 'personel.csv', size: 2 * 1024 * 1024 }))
    assert.equal(decodeImportFile(new TextEncoder().encode('Şule Öğretmen')), 'Şule Öğretmen')
    // "Ş" ve "ğ" Windows-1254'te 0xDE ve 0xF0'dır; katı UTF-8 çözümü başarısız olur.
    assert.equal(decodeImportFile(new Uint8Array([0xde, 0x75, 0x6c, 0x65, 0x20, 0xf0])), 'Şule ğ')
  })

  test('IST-007: form boş içeriği reddeder; örnek dosya BOM ve başlıkla başlar', () => {
    assert.equal(importFormSchema.safeParse({ csv: '  ' }).success, false)
    assert.equal(importFormSchema.safeParse({ csv: 'ad;e-posta;rol' }).success, true)
    assert.ok(SAMPLE_CSV.startsWith('\uFEFFad;e-posta;rol;branş;kampüs\n'))
    assert.deepEqual(importPreviewRows(SAMPLE_CSV, []).rows.length, 2)
  })

  test('IST-007: denetim kaydında aktarım eylemi Türkçe adlandırılır', () => {
    assert.equal(actionLabel('staff.import'), 'Personel toplu aktarımla davet edildi')
  })
})
