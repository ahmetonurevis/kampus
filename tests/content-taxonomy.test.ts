import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CEFR_LEVELS,
  COPYRIGHT_DECLARATION,
  CONTENT_TYPES,
  FILE_PURPOSES,
  LICENSE_KINDS,
  MIME,
  OPEN_LICENSES,
  PRIMARY_SKILLS,
  QUESTION_TYPES,
  SHARE_SCOPES,
  SKILLS,
  assertFileAllowed,
  canonicalMimeType,
  enumKeys,
} from '../packages/school-core/src/content/taxonomy.ts'
import { isDomainError } from './support/domain-error.ts'

const MB = 1024 * 1024

test('CEFR ölçeği resmî on seviyedir ve sırası ölçek sırasıdır', () => {
  assert.deepEqual(Object.keys(CEFR_LEVELS), [
    'Pre-A1',
    'A1',
    'A2',
    'A2+',
    'B1',
    'B1+',
    'B2',
    'B2+',
    'C1',
    'C2',
  ])
  const ranks = Object.values(CEFR_LEVELS).map((level) => level.rank)
  assert.deepEqual(
    ranks,
    [...ranks].sort((a, b) => a - b),
  )
  assert.equal(new Set(ranks).size, ranks.length)
  assert.deepEqual(enumKeys(CEFR_LEVELS), Object.keys(CEFR_LEVELS))
  assert.ok(!enumKeys(CEFR_LEVELS).includes('C1+' as never), 'resmî olmayan ara seviye yok')
})

test('Beceri sözlüğü dört temel beceriyi, aracılığı ve dil kullanımını ayırır', () => {
  const core = Object.entries(SKILLS)
    .filter(([, skill]) => skill.group === 'core')
    .map(([key]) => key)
  assert.deepEqual(core, ['reading', 'listening', 'writing', 'speaking'])
  assert.equal(SKILLS.language_use.group, 'component', 'dil kullanımı dört beceriden sayılmaz')
  assert.ok(PRIMARY_SKILLS.every((skill) => skill in SKILLS))
  assert.ok(
    !(PRIMARY_SKILLS as readonly string[]).includes('grammar'),
    'alt bileşen birincil olmaz',
  )
})

test('Her sözlük Türkçe etiket taşır', () => {
  for (const dictionary of [SKILLS, CONTENT_TYPES, QUESTION_TYPES, LICENSE_KINDS, SHARE_SCOPES]) {
    for (const entry of Object.values(dictionary)) assert.ok(entry.label.trim().length > 0)
  }
  assert.equal(LICENSE_KINDS.platform_derived.label, 'Kampüs örnek içeriğinden türetildi')
  assert.deepEqual(Object.keys(QUESTION_TYPES), [
    'multiple_choice',
    'true_false',
    'matching',
    'gap_fill',
    'ordering',
    'short_answer',
  ])
})

test('Harici kaynak türleri platformda barındırılmaz', () => {
  const external = Object.entries(CONTENT_TYPES)
    .filter(([, type]) => !type.hosted)
    .map(([key]) => key)
  assert.deepEqual(external, ['link', 'book_reference'])
})

test('Açık lisans listesinde ticari olmayan ve türev yasaklayan lisans yoktur', () => {
  for (const key of Object.keys(OPEN_LICENSES)) {
    assert.doesNotMatch(key, /NC|ND/)
  }
})

test('Dosya amacı türü ve boyutu içerik türüne göre kabul eder', () => {
  assert.doesNotThrow(() =>
    assertFileAllowed('material', { contentType: MIME.mp4, byteSize: 150 * MB }),
  )
  assert.doesNotThrow(() =>
    assertFileAllowed('listening_audio', {
      contentType: MIME.mp3,
      byteSize: 5 * MB,
      durationSeconds: 900,
    }),
  )
  assert.equal(FILE_PURPOSES.speaking_recording.requiresConsent, true)
})

test('Dosya amacı yanlış türü, büyük dosyayı ve uzun kaydı reddeder', () => {
  assert.throws(
    () => assertFileAllowed('question_image', { contentType: 'image/svg+xml', byteSize: 1000 }),
    isDomainError('file_type_not_allowed'),
  )
  assert.throws(
    () => assertFileAllowed('material', { contentType: MIME.pdf, byteSize: 51 * MB }),
    isDomainError('file_too_large'),
    'video sınırı yalnız videoya uygulanır',
  )
  assert.throws(
    () => assertFileAllowed('material', { contentType: MIME.mp4, byteSize: 201 * MB }),
    isDomainError('file_too_large'),
  )
  assert.throws(
    () => assertFileAllowed('submission', { contentType: MIME.pdf, byteSize: 0 }),
    isDomainError('file_too_large'),
  )
  assert.throws(
    () =>
      assertFileAllowed('speaking_recording', {
        contentType: MIME.m4a,
        byteSize: MB,
        durationSeconds: 601,
      }),
    isDomainError('file_too_long'),
  )
  assert.doesNotThrow(() =>
    assertFileAllowed('speaking_recording', {
      contentType: MIME.m4a,
      byteSize: MB,
      durationSeconds: null,
    }),
  )
})

test("DOM-KYN-004 bildirilen tür kanonik MIME'a çevrilir: takma ad, parametre ve harf farkı", () => {
  assert.equal(canonicalMimeType('audio/x-m4a'), MIME.m4a)
  assert.equal(canonicalMimeType('audio/m4a'), MIME.m4a)
  assert.equal(canonicalMimeType('audio/x-wav'), MIME.wav)
  assert.equal(canonicalMimeType('audio/mp3'), MIME.mp3)
  assert.equal(canonicalMimeType('image/jpg'), MIME.jpeg)
  assert.equal(canonicalMimeType('video/webm'), MIME.webmAudio)
  assert.equal(canonicalMimeType('audio/webm;codecs=opus'), MIME.webmAudio)
  assert.equal(canonicalMimeType(' Application/PDF ; charset=binary'), MIME.pdf)
  assert.equal(canonicalMimeType('application/octet-stream'), null)
  assert.equal(canonicalMimeType('constructor'), null)
  assert.equal(canonicalMimeType(''), null)
  // Her takma ad izinli bir kanonik türe gider.
  for (const type of ['audio/x-m4a', 'audio/x-wav', 'audio/mp3', 'image/jpg', 'video/webm']) {
    const canonical = canonicalMimeType(type)
    assert.ok(canonical !== null && Object.values(MIME).includes(canonical), type)
  }
})

test('DOM-KYN-020: telif beyanı kullanma hakkını ve incelemeyi anlatır', () => {
  assert.match(COPYRIGHT_DECLARATION, /kullanma hakkım var/)
  assert.match(COPYRIGHT_DECLARATION, /telif ihlali bildirilirse/i)
  assert.ok(COPYRIGHT_DECLARATION.length < 200)
})
