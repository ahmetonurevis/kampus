import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { SkillCurve } from '@kampus/react-shared/skill-progress.ts'
import {
  chartPoints,
  emptySkillText,
  pointHref,
  skillPointRows,
  skillSummary,
} from '../src/pages/academic/skill-progress-model.ts'

// OG-080 (IST-057; DOM-BEC-035): beceri ilerleme panosunun sunumu ve görev sonucuna bağlantılar.

const QUIZ = '00000000-0000-4000-8000-0000a0000001'
const ATTEMPT = '00000000-0000-4000-8000-0000a0000002'
const WRITING = '00000000-0000-4000-8000-0000b0000001'
const SUBMISSION = '00000000-0000-4000-8000-0000b0000002'

const reading: SkillCurve = {
  skill: 'reading',
  label: 'Okuma',
  points: [
    {
      assignmentId: QUIZ,
      attemptId: ATTEMPT,
      submissionId: null,
      title: 'Okuma quizi',
      performedAt: '2026-10-20T09:00:00.000Z',
      percent: 60,
    },
    {
      assignmentId: '00000000-0000-4000-8000-0000a0000003',
      attemptId: '00000000-0000-4000-8000-0000a0000004',
      submissionId: null,
      title: '',
      performedAt: '2026-11-02T09:00:00.000Z',
      percent: 80,
    },
  ],
  latest: 80,
  trend: 'up',
}

const writingPoint = {
  assignmentId: WRITING,
  attemptId: null,
  submissionId: SUBMISSION,
  title: 'Hafta sonu yazısı',
  performedAt: '2026-11-01T09:00:00.000Z',
  percent: 70,
}

const empty = (skill: SkillCurve['skill'], label: string): SkillCurve => ({
  skill,
  label,
  points: [],
  latest: null,
  trend: null,
})

test('DOM-BEC-035: öğrenci noktası kendi çalışma alanına gider; deneme quize, teslim yazmaya', () => {
  assert.equal(pointHref(reading.points[0]!, { kind: 'student' }), `/ogrenci/soru-coz?coz=${QUIZ}`)
  assert.equal(pointHref(writingPoint, { kind: 'student' }), `/ogrenci/odevler?yaz=${WRITING}`)
})

test('DOM-BEC-035: veli noktası çocuğun beceri görevleri sekmesinde görevi açar', () => {
  assert.equal(
    pointHref(writingPoint, { kind: 'parent', childId: 's1' }),
    `/veli/akademik-takip?cocuk=s1&sekme=gorevler&gorev=${WRITING}`,
  )
})

test('DOM-BEC-035: özet son puanı, eğilimi ve görev sayısını yazar; boş beceri kendi adıyla', () => {
  assert.equal(skillSummary(reading), 'Son puan %80 · Yükseliyor · 2 görev')
  assert.equal(
    skillSummary({ ...reading, points: reading.points.slice(0, 1), latest: 60, trend: null }),
    'Son puan %60 · 1 görev',
  )
  assert.equal(skillSummary(empty('speaking', 'Konuşma')), 'Henüz puanlanmış konuşma görevi yok.')
  assert.equal(emptySkillText({ label: 'Dinleme' }), 'Henüz puanlanmış dinleme görevi yok.')
})

test('DOM-BEC-035: grafik tarih sırasında, satırlar en yeni üstte; her satır sonuca bağlı', () => {
  assert.deepEqual(
    chartPoints(reading).map((point) => point.value),
    [60, 80],
  )
  const rows = skillPointRows(reading, { kind: 'student' })
  assert.deepEqual(
    rows.map((row) => [row.title, row.percent]),
    [
      ['Adsız görev', '%80'],
      ['Okuma quizi', '%60'],
    ],
  )
  assert.equal(rows[1]?.key, ATTEMPT)
  assert.equal(rows[1]?.href, `/ogrenci/soru-coz?coz=${QUIZ}`)
  assert.match(rows[1]?.linkLabel ?? '', /^Okuma quizi, .*2026, %60 sonucunu aç$/)
  assert.deepEqual(skillPointRows(empty('listening', 'Dinleme'), { kind: 'student' }), [])
})
