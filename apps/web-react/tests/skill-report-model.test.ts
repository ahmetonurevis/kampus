import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { SkillReport } from '@kampus/react-shared/use-skill-report.ts'
import {
  averageText,
  barPercent,
  evidenceText,
  groupLink,
  isGrouping,
  levelDistributionText,
  levelShares,
  resolveGrouping,
  skillAriaLabel,
  skillReportRow,
  skillReportRows,
} from '../src/pages/language/skill-report-model.ts'

// OG-100 (IST-118; DOM-BEC-037): beceri ve CEFR raporunun sunumu. Hesap sunucudadır; burada
// kanıtsız becerinin "—" ile gösterilmesi (sıfır değil), oranlar ve satır dönüşümü sınanır.

type Group = SkillReport['groups'][number]
type Skill = Group['skills'][number]

const skill = (key: Skill['skill'], average: number | null, evidence = 0, students = 0): Skill => ({
  skill: key,
  label: key,
  average,
  evidenceCount: evidence,
  studentCount: students,
})

const group: Group = {
  id: 'g1',
  name: 'B1 Akşam Grubu',
  level: 'B1',
  studentCount: 8,
  skills: [
    skill('reading', 72.5, 12, 5),
    skill('listening', null),
    skill('writing', 0, 3, 2),
    skill('speaking', 100, 1, 1),
  ],
  levels: [
    { level: 'A2', label: 'A2', count: 2 },
    { level: 'B1', label: 'B1', count: 4 },
  ],
  noLevelCount: 2,
}

test('DOM-BEC-037: kanıtsız beceri "—" gösterilir, gerçek sıfır ortalama sıfır kalır', () => {
  assert.equal(averageText(null), '—')
  assert.equal(averageText(0), '0,0')
  assert.equal(averageText(72.5), '72,5')
  assert.equal(barPercent(null), null)
  assert.equal(barPercent(0), 0)
  assert.equal(barPercent(72.5), 73)
  assert.equal(barPercent(140), 100)
})

test('DOM-BEC-037: kanıt sayısı metni ve ekran okuyucu cümlesi kanıtsızı açıkça söyler', () => {
  assert.equal(evidenceText({ evidenceCount: 0, studentCount: 0 }), 'kanıt yok')
  assert.equal(evidenceText({ evidenceCount: 1200, studentCount: 5 }), '1.200 sonuç · 5 kursiyer')
  assert.equal(skillAriaLabel(skill('listening', null)), 'listening: kanıt yok')
  assert.equal(
    skillAriaLabel(skill('reading', 72.5, 12, 5)),
    'reading: ortalama 72,5, 12 sonuç · 5 kursiyer',
  )
})

test('DOM-BEC-037: seviye dağılımı seviye sırasını korur, seviyesizler sonda ve oranlıdır', () => {
  assert.deepEqual(levelShares(group), [
    { key: 'A2', label: 'A2', count: 2, percent: 25 },
    { key: 'B1', label: 'B1', count: 4, percent: 50 },
    { key: 'none', label: 'Seviye kararı yok', count: 2, percent: 25 },
  ])
  assert.equal(levelDistributionText(group), 'A2: 2 · B1: 4 · Seviye kararı yok: 2')
  const empty = { levels: [], noLevelCount: 0, studentCount: 0 }
  assert.deepEqual(levelShares(empty), [])
  assert.equal(levelDistributionText(empty), '—')
  // Kursiyer sayısı sıfırken oran bölme hatası vermez.
  assert.equal(levelShares({ levels: [], noLevelCount: 1, studentCount: 0 })[0]?.percent, 0)
})

test('IST-118: sunucu satırı tablo satırına çevrilir; kanıtsız ortalama null kalır', () => {
  const row = skillReportRow(group)
  assert.equal(row.id, 'g1')
  assert.equal(row.level, 'B1')
  assert.equal(row.students, 8)
  assert.equal(row.reading, 72.5)
  assert.equal(row.listening, null)
  assert.equal(row.writing, 0)
  assert.equal(row.speaking, 100)
  assert.equal(row.skills.reading?.evidenceCount, 12)
  assert.equal(row.levelsText, 'A2: 2 · B1: 4 · Seviye kararı yok: 2')
  // Seviyesi olmayan satırda süzgeç seçeneği oluşmasın diye boş metin.
  assert.equal(skillReportRow({ ...group, level: null }).level, '')
  // Eksik beceri satırı gelirse (sözleşme dışı) ortalama sıfır değil null olur.
  const partial = skillReportRow({ ...group, skills: [] })
  assert.equal(partial.reading, null)
  assert.equal(partial.skills.reading, undefined)
})

test('IST-118: rapor satırları sunucu sırasını korur', () => {
  const report: SkillReport = {
    groupBy: 'class',
    computedAt: '2026-11-04T09:00:00.000Z',
    groups: [group, { ...group, id: 'g2', name: 'A1 Sabah' }],
    totals: { studentCount: 16, skills: [], levels: [], noLevelCount: 0 },
  }
  assert.deepEqual(
    skillReportRows(report).map((row) => row.id),
    ['g1', 'g2'],
  )
  assert.deepEqual(skillReportRows({ ...report, groups: [] }), [])
})

test('IST-118: kırılım adresten çözülür, geçersiz değer dil grubuna düşer', () => {
  assert.equal(isGrouping('level'), true)
  assert.equal(isGrouping('teacher'), false)
  assert.equal(isGrouping(null), false)
  assert.equal(resolveGrouping('level'), 'level')
  assert.equal(resolveGrouping('teacher'), 'class')
  assert.equal(resolveGrouping(null), 'class')
})

test('DOM-BEC-037: yalnız dil grubu satırı grup listesine bağlanır', () => {
  assert.deepEqual(groupLink('class', { id: 'g 1' }), { path: 'gruplar', search: '?grup=g%201' })
  assert.equal(groupLink('level', { id: 'B1' }), null)
})
