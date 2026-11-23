import assert from 'node:assert/strict'
import { test } from 'node:test'
import { csvCell, csvFilename, toCsv } from '../src/lib/csv.ts'

test('formül olarak yorumlanabilecek metin hücreleri kaçılır', () => {
  for (const value of ['=1+1', '+90 555', '-2', '@SUM(A1)', '  =cmd', '\t=x', '\rabc'])
    assert.ok(csvCell(value).startsWith(`"'`), JSON.stringify(value))
  assert.equal(csvCell('Deniz Yılmaz'), '"Deniz Yılmaz"')
  assert.equal(csvCell('a=b'), '"a=b"')
})

test('sayılar kaçılmadan yazılır; boş ve sonsuz değerler boş hücre olur', () => {
  assert.equal(csvCell(-1500), '-1500')
  assert.equal(csvCell(0), '0')
  assert.equal(csvCell(Number.NaN), '')
  assert.equal(csvCell(null), '""')
  assert.equal(csvCell(undefined), '""')
})

test('çift tırnak ikilenir; ayırıcı ve satır sonu hücre içinde güvenlidir', () => {
  assert.equal(csvCell('5" ekran; "yeni"'), '"5"" ekran; ""yeni"""')
  assert.equal(csvCell('satır\nsonu'), '"satır\nsonu"')
})

test('başlık ve tüm satırlar sütun sırasıyla, ; ve CRLF ile yazılır', () => {
  const csv = toCsv(
    [
      { key: 'name', label: 'Öğrenci' },
      { key: 'amount', label: 'Tutar' },
    ],
    [
      { name: 'Ece', amount: 1250, extra: 'yok' },
      { name: '=HYPERLINK("x")', amount: null },
    ],
  )
  assert.equal(csv, '"Öğrenci";"Tutar"\r\n"Ece";1250\r\n"\'=HYPERLINK(""x"")";""')
})

test('dosya adı güvenli karakterlere indirgenir ve .csv ile biter', () => {
  assert.equal(csvFilename('finans/raporu:ekim'), 'finans-raporu-ekim.csv')
  assert.equal(csvFilename('rapor.csv'), 'rapor.csv')
  assert.equal(csvFilename('   '), 'rapor.csv')
})
