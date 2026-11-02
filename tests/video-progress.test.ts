import test from 'node:test'
import assert from 'node:assert/strict'
import { createSeed, type State } from '../packages/school-core/src/data/seed.ts'
import type { Participant } from '../packages/school-core/src/lib/communication.ts'
import {
  recordVideoProgress,
  recordVideoProgressSchema,
  videoProgressPercent,
} from '../packages/school-core/src/lib/video-progress.ts'
import { isDomainError } from './support/domain-error.ts'

// Deniz (s1) 7-A (c1, "7. Sınıf"); v1 ve v2 7. Sınıf videosudur. Ece (s2) 5-A (c2, "5. Sınıf").
// Tohum ilerleme: s1/v1 %35, s1/v2 %0, s2/v1 %100.
const seed = () => createSeed(new Date('2026-10-06T10:00:00.000Z'))
const person = (
  role: Participant['role'],
  kind: 'student' | 'teacher' | 'child',
  recordId: string,
) => ({ role, links: [{ kind, recordId }], userId: `u-${recordId}` }) satisfies Participant
const deniz = person('ogrenci', 'student', 's1')
const ece = person('ogrenci', 'student', 's2')
const parent = person('veli', 'child', 's1')
const teacher = person('ogretmen', 'teacher', 't1')
const admin: Participant = { role: 'yonetici', links: [], userId: 'u-admin' }

const progressOf = (state: State, studentId = 's1', videoId = 'v1') =>
  state.videoProgress.find((p) => p.studentId === studentId && p.videoId === videoId)

function unchanged(state: State, action: () => unknown, check: (error: unknown) => boolean) {
  const before = JSON.stringify(state.videoProgress)
  assert.throws(action, check)
  assert.equal(JSON.stringify(state.videoProgress), before)
}

test('DOM-KYN-005: yüzde konum ve süreden hesaplanır, 0–100 arasına sıkıştırılır', () => {
  assert.equal(videoProgressPercent(30, 120), 25)
  assert.equal(videoProgressPercent(0, 120), 0)
  assert.equal(videoProgressPercent(121, 120), 100)
  assert.equal(videoProgressPercent(-5, 120), 0)
  assert.equal(videoProgressPercent(10, 0), 0)
})

test('DOM-KYN-005: ilk istek kaydı açar; yüzde, konum ve süre saklanır', () => {
  const state = seed()
  state.videoProgress.length = 0
  const outcome = recordVideoProgress(state, deniz, 'v1', {
    positionSeconds: 30,
    durationSeconds: 120,
  })
  assert.equal(outcome.created, true)
  assert.deepEqual(progressOf(state), {
    studentId: 's1',
    videoId: 'v1',
    progress: 25,
    positionSeconds: 30,
    durationSeconds: 120,
  })
})

test('DOM-KYN-005: ilerleme geri gitmez, son konum ve süre ayrı saklanır', () => {
  const state = seed()
  recordVideoProgress(state, deniz, 'v1', { positionSeconds: 90, durationSeconds: 100 })
  const back = recordVideoProgress(state, deniz, 'v1', {
    positionSeconds: 10,
    durationSeconds: 100,
  })
  assert.equal(back.created, false)
  assert.equal(progressOf(state)?.progress, 90)
  assert.equal(progressOf(state)?.positionSeconds, 10)
  assert.equal(
    state.videoProgress.filter((p) => p.studentId === 's1' && p.videoId === 'v1').length,
    1,
  )
})

test('DOM-KYN-005: tohum kaydı (konumsuz %35) yeni konumla güncellenir, yüzde yükselmezse korunur', () => {
  const state = seed()
  recordVideoProgress(state, deniz, 'v1', { positionSeconds: 10, durationSeconds: 100 })
  assert.equal(progressOf(state)?.progress, 35)
  assert.equal(progressOf(state)?.positionSeconds, 10)
})

test('DOM-KYN-005: konum süreyi aşamaz, tam sayı saniyeye yuvarlanır', () => {
  const state = seed()
  recordVideoProgress(state, deniz, 'v2', { positionSeconds: 130.4, durationSeconds: 120.2 })
  const record = progressOf(state, 's1', 'v2')
  assert.equal(record?.positionSeconds, 120)
  assert.equal(record?.durationSeconds, 120)
  assert.equal(record?.progress, 100)
})

test('DOM-KYN-005: aynı istek iki kez aynı kaydı verir (idempotent)', () => {
  const state = seed()
  const input = { positionSeconds: 40, durationSeconds: 80 }
  recordVideoProgress(state, deniz, 'v2', input)
  const once = JSON.stringify(state.videoProgress)
  recordVideoProgress(state, deniz, 'v2', input)
  assert.equal(JSON.stringify(state.videoProgress), once)
})

test('DOM-KYN-005: kapsam dışı düzeyin videosu 404, kayıt değişmez', () => {
  const state = seed()
  unchanged(
    state,
    () => recordVideoProgress(state, ece, 'v1', { positionSeconds: 5, durationSeconds: 50 }),
    isDomainError('video_not_found', 'not_found'),
  )
})

test('DOM-KYN-005: olmayan video 404', () => {
  const state = seed()
  unchanged(
    state,
    () => recordVideoProgress(state, deniz, 'v-yok', { positionSeconds: 5, durationSeconds: 50 }),
    isDomainError('video_not_found', 'not_found'),
  )
})

test('DOM-KYN-005: yalnız öğrenci yazar; veli, öğretmen ve yönetici reddedilir', () => {
  const state = seed()
  for (const by of [parent, teacher, admin])
    unchanged(
      state,
      () => recordVideoProgress(state, by, 'v1', { positionSeconds: 5, durationSeconds: 50 }),
      isDomainError('permission_denied', 'forbidden'),
    )
})

test('DOM-KYN-005: öğrenci bağlantısı olmayan oturum 403 student_scope_denied', () => {
  const state = seed()
  const unlinked: Participant = { role: 'ogrenci', links: [], userId: 'u-x' }
  unchanged(
    state,
    () => recordVideoProgress(state, unlinked, 'v1', { positionSeconds: 5, durationSeconds: 50 }),
    isDomainError('student_scope_denied', 'forbidden'),
  )
})

test('DOM-KYN-005: modül kapalıyken 403 module_disabled', () => {
  const state = seed()
  state.modules = { ...state.modules, learning: false }
  unchanged(
    state,
    () => recordVideoProgress(state, deniz, 'v1', { positionSeconds: 5, durationSeconds: 50 }),
    isDomainError('module_disabled', 'forbidden'),
  )
})

test('DOM-KYN-005: pasif öğrenci 422 student_inactive', () => {
  const state = seed()
  const target = state.students.find((s) => s.id === 's1')
  assert.ok(target)
  target.isActive = false
  unchanged(
    state,
    () => recordVideoProgress(state, deniz, 'v2', { positionSeconds: 5, durationSeconds: 50 }),
    isDomainError('student_inactive'),
  )
})

test('DOM-KYN-005: geçersiz gövde reddedilir (eksi konum, sıfır süre, fazla alan, 24 saat üstü)', () => {
  const bad = [
    { positionSeconds: -1, durationSeconds: 10 },
    { positionSeconds: 1, durationSeconds: 0 },
    { positionSeconds: 1 },
    { positionSeconds: '1', durationSeconds: 10 },
    { positionSeconds: Number.NaN, durationSeconds: 10 },
    { positionSeconds: 1, durationSeconds: 100_000 },
    { positionSeconds: 1, durationSeconds: 10, progress: 100 },
  ]
  for (const input of bad) assert.equal(recordVideoProgressSchema.safeParse(input).success, false)
  const state = seed()
  const before = JSON.stringify(state.videoProgress)
  assert.throws(
    () => recordVideoProgress(state, deniz, 'v1', { positionSeconds: -1, durationSeconds: 10 }),
    (error) => error instanceof Error && error.name === 'ZodError',
  )
  assert.equal(JSON.stringify(state.videoProgress), before)
})
