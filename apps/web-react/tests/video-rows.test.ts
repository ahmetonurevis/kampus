import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSeed } from '@kampus/school-core/data/seed.ts'
import {
  progressByVideo,
  progressText,
  resumeByVideo,
  videoRow,
  watchAction,
  watchState,
} from '../src/pages/learning/video-rows.ts'

const NOW = new Date('2026-10-15T09:00:00.000Z')
const seed = createSeed(NOW)
const wrap = <T extends { id: string }>(record: T) => ({
  id: record.id,
  version: 1,
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
  archivedAt: null,
  record,
})
const [first, second] = seed.videos
if (!first || !second) throw new Error('örnek veride iki video bekleniyor')

test('watchState ve progressText: izlenmemiş, devam eden ve tamamlanan video ayrı metin alır', () => {
  assert.equal(watchState(0), 'new')
  assert.equal(watchState(35), 'started')
  assert.equal(watchState(100), 'completed')
  assert.equal(progressText(0), 'Henüz izlenmedi')
  assert.equal(progressText(35), '%35 izlendi · Devam et')
  assert.equal(progressText(100), 'Tamamlandı')
  assert.equal(watchAction(0), 'Dersi izle')
  assert.equal(watchAction(35), 'Devam et')
})

test('progressByVideo: yüzde 0–100 arasına çekilir, aynı video için en yüksek kayıt geçerlidir', () => {
  const byVideo = progressByVideo([
    { studentId: 's1', videoId: 'v1', progress: 35 },
    { studentId: 's1', videoId: 'v1', progress: 20 },
    { studentId: 's1', videoId: 'v2', progress: 140 },
    { studentId: 's1', videoId: 'v3', progress: -5 },
    { studentId: 's1', videoId: 'v4', progress: Number.NaN },
  ])
  assert.equal(byVideo.get('v1'), 35)
  assert.equal(byVideo.get('v2'), 100)
  assert.equal(byVideo.get('v3'), 0)
  assert.equal(byVideo.get('v4'), 0)
})

test('videoRow: ilerleme ve öğretmen adı eşlemelerden gelir; kayıt bulunmazsa uydurulmaz', () => {
  const row = videoRow(
    wrap(first),
    new Map([[first.id, 35]]),
    new Map([[first.teacherId, 'Selin Kaya']]),
  )
  assert.equal(row.title, first.title)
  assert.equal(row.progress, 35)
  assert.equal(row.watch, 'started')
  assert.equal(row.teacher, 'Selin Kaya')
  assert.equal(row.src, first.src)
  assert.equal(row.captions, first.captions)

  const unseen = videoRow(wrap(second), new Map(), new Map())
  assert.equal(unseen.progress, 0)
  assert.equal(unseen.watch, 'new')
  assert.equal(unseen.teacher, '—')
})

test('videoRow: yalnız künye olan kayıtta oynatılabilir dosya adresi yoktur', () => {
  const meta: Partial<typeof first> = { ...first }
  delete meta.src
  delete meta.poster
  delete meta.captions
  const row = videoRow(wrap(meta as typeof first), new Map(), new Map())
  assert.equal(row.src, null)
  assert.equal(row.poster, null)
  assert.equal(row.captions, null)
})

test('DOM-KYN-005 resumeByVideo: son konum yüzdeyle birlikte gelir, aynı videoda en yüksek yüzdeli kayıt geçerlidir', () => {
  const byVideo = resumeByVideo([
    { studentId: 's1', videoId: 'v1', progress: 35 },
    { studentId: 's1', videoId: 'v1', progress: 60, positionSeconds: 72, durationSeconds: 120 },
    { studentId: 's1', videoId: 'v1', progress: 20, positionSeconds: 10, durationSeconds: 120 },
    { studentId: 's1', videoId: 'v2', progress: 140, positionSeconds: 5, durationSeconds: 50 },
    { studentId: 's1', videoId: 'v3', progress: 0 },
  ])
  assert.deepEqual(byVideo.get('v1'), { progress: 60, positionSeconds: 72 })
  assert.deepEqual(byVideo.get('v2'), { progress: 100, positionSeconds: 5 })
  assert.deepEqual(byVideo.get('v3'), { progress: 0, positionSeconds: undefined })
  assert.equal(byVideo.get('v4'), undefined)
})
