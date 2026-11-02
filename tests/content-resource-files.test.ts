import test, { describe } from 'node:test'
import assert from 'node:assert/strict'

import { planCopy } from '../packages/school-core/src/content/copy.ts'
import {
  planNewVersion,
  planResourceRemoval,
  resourceVersionInputSchema,
  type ResourceContent,
} from '../packages/school-core/src/content/resource.ts'
import {
  planVersionFiles,
  resourceFileCountIssue,
  type ResourceFileRow,
} from '../packages/school-core/src/content/resource-files.ts'
import {
  CONTENT_TYPES,
  RESOURCE_FILE_LIST_MAX,
  RESOURCE_FILE_RULES,
  type ContentType,
} from '../packages/school-core/src/content/taxonomy.ts'
import { admin, author, build, now, schoolText } from './support/content-fixtures.ts'
import { isDomainError } from './support/domain-error.ts'

/** Kaynak sürümünün dosyaları (DOM-KYN-006; ADR 0003 karar 3, 5). */

const MB = 1024 * 1024

function row(id: string, patch: Partial<ResourceFileRow> = {}): ResourceFileRow {
  return {
    id,
    purpose: 'material',
    status: 'ready',
    uploadedByUserId: author.userId,
    attached: false,
    contentType: 'application/pdf',
    byteSize: 1024,
    durationSeconds: null,
    ...patch,
  }
}

const fileContent = (fileId: string): ResourceContent => ({ type: 'file', fileId })
const plan = (
  content: ResourceContent,
  fileIds: string[],
  files: ResourceFileRow[],
  kept?: string[],
) => planVersionFiles({ actorUserId: author.userId, content, fileIds, files, kept })

/** Hata kodu ve `issues` yolu. */
function rejects(run: () => unknown, code: string, path: string[]) {
  assert.throws(run, (error: unknown) => {
    assert.ok(isDomainError(code)(error), String(error))
    assert.deepEqual((error as { path: string[] }).path, path)
    return true
  })
}

describe('DOM-KYN-006 kaynak sürümünün dosyaları', () => {
  test('tablo her içerik türünü kapsar; dosya almayan türlerde amaç yoktur', () => {
    assert.deepEqual(Object.keys(RESOURCE_FILE_RULES).sort(), Object.keys(CONTENT_TYPES).sort())
    for (const [type, rule] of Object.entries(RESOURCE_FILE_RULES)) {
      assert.equal(rule.purposes.length === 0, rule.maxFiles === 0, type)
      // Barındırılmayan tür (dış bağlantı, kitap referansı) dosya almaz (DOM-KYN-027).
      if (!CONTENT_TYPES[type as ContentType].hosted) assert.equal(rule.maxFiles, 0, type)
    }
    assert.deepEqual(RESOURCE_FILE_RULES.audio.purposes, ['listening_audio', 'material'])
    assert.equal(RESOURCE_FILE_RULES.video.maxFiles, 1)
  })

  test('şema dosya listesini tekilleştirir, varsayılanı boştur ve üst sınırı aşan liste reddedilir', () => {
    const base = { title: 'Ünite 3 çalışma kâğıdı', content: fileContent('f-1') }
    assert.deepEqual(resourceVersionInputSchema.parse(base).fileIds, [])
    assert.deepEqual(
      resourceVersionInputSchema.parse({ ...base, fileIds: ['f-1', 'f-2', 'f-1'] }).fileIds,
      ['f-1', 'f-2'],
    )
    const many = Array.from({ length: RESOURCE_FILE_LIST_MAX + 1 }, (_, i) => `f-${i}`)
    assert.equal(resourceVersionInputSchema.safeParse({ ...base, fileIds: many }).success, false)
  })

  test('sayı denetimi formla aynıdır: dosya almayan tür ve tür sınırı', () => {
    assert.equal(resourceFileCountIssue('file', []), null)
    assert.equal(resourceFileCountIssue('link', [])?.code, undefined)
    assert.equal(resourceFileCountIssue('link', ['f-1'])?.code, 'resource_files_not_allowed')
    assert.equal(resourceFileCountIssue('video', ['f-1', 'f-2'])?.code, 'resource_files_limit')
    const ten = Array.from({ length: 10 }, (_, i) => `f-${i}`)
    assert.equal(resourceFileCountIssue('file', ten), null)
    assert.match(
      resourceFileCountIssue('file', [...ten, 'f-x'])?.message ?? '',
      /en fazla 10 dosya/,
    )
  })

  test('başarılı yol: yeni dosyalar bağlanır, sıra korunur, girdi değişmez', () => {
    const files = [row('f-1'), row('f-2', { contentType: 'image/png' })]
    const before = structuredClone(files)
    assert.deepEqual(plan(fileContent('f-1'), ['f-1', 'f-2'], files), {
      fileIds: ['f-1', 'f-2'],
      attach: ['f-1', 'f-2'],
    })
    assert.deepEqual(files, before)
    // Metin gövdeyle yazılıp ek dosya taşıyabilir; dosyasız metin boş liste döner.
    assert.deepEqual(plan({ type: 'text', body: 'Metin', fileId: null }, [], []), {
      fileIds: [],
      attach: [],
    })
  })

  test('dinleme sesi ve soru görseli kendi amacıyla bağlanır', () => {
    const audio = row('a-1', { purpose: 'listening_audio', contentType: 'audio/mp4' })
    const content: ResourceContent = {
      type: 'audio',
      fileId: 'a-1',
      transcript: null,
      captionsVtt: null,
    }
    assert.deepEqual(plan(content, ['a-1'], [audio]).attach, ['a-1'])
    rejects(
      () => plan(content, ['a-1'], [row('a-1', { purpose: 'question_image' })]),
      'file_purpose_mismatch',
      ['fileIds', '0'],
    )
  })

  test('başkasının, olmayan, silinmiş ve reddedilmiş dosyası bulunamadı sayılır', () => {
    const content = fileContent('f-1')
    for (const files of [
      [],
      [row('f-1', { uploadedByUserId: 'u-other' })],
      [row('f-1', { status: 'deleted' })],
      [row('f-1', { status: 'rejected' })],
    ])
      rejects(() => plan(content, ['f-1'], files), 'file_unavailable', ['fileIds', '0'])
  })

  test('yanlış amaç, bağlı ve hazır olmayan dosya ayrı kodla reddedilir', () => {
    const content = fileContent('f-1')
    rejects(
      () => plan(content, ['f-1'], [row('f-1', { purpose: 'submission' })]),
      'file_purpose_mismatch',
      ['fileIds', '0'],
    )
    rejects(
      () => plan(content, ['f-1'], [row('f-1', { attached: true })]),
      'file_already_attached',
      ['fileIds', '0'],
    )
    for (const status of ['pending', 'processing'] as const)
      rejects(() => plan(content, ['f-1'], [row('f-1', { status })]), 'file_not_ready', [
        'fileIds',
        '0',
      ])
    // Amaç sınırı (materyalde video dışı 50 MB) bağlamada da denetlenir.
    rejects(() => plan(content, ['f-1'], [row('f-1', { byteSize: 51 * MB })]), 'file_too_large', [
      'fileIds',
      '0',
    ])
  })

  test('tür sınırı ve dosya almayan tür 422 türünde reddedilir', () => {
    const files = Array.from({ length: 11 }, (_, i) => row(`f-${i}`))
    rejects(
      () =>
        plan(
          fileContent('f-0'),
          files.map((f) => f.id),
          files,
        ),
      'resource_files_limit',
      ['fileIds'],
    )
    rejects(
      () => plan({ type: 'link', url: 'https://example.com', provider: null }, ['f-0'], files),
      'resource_files_not_allowed',
      ['fileIds'],
    )
  })

  test('içerikteki dosya sürümün listesinde olmalıdır', () => {
    rejects(() => plan(fileContent('f-1'), [], []), 'resource_file_unlinked', ['content', 'fileId'])
    rejects(() => plan(fileContent('f-1'), ['f-2'], [row('f-2')]), 'resource_file_unlinked', [
      'content',
      'fileId',
    ])
  })

  test('önceki sürümden gelen dosya yeniden denetlenmez, yalnız yeni dosya bağlanır', () => {
    const inherited = row('f-1', { attached: true, uploadedByUserId: 'u-other' })
    assert.deepEqual(plan(fileContent('f-1'), ['f-1', 'f-2'], [inherited, row('f-2')], ['f-1']), {
      fileIds: ['f-1', 'f-2'],
      attach: ['f-2'],
    })
  })

  test('yeni sürüm ve kopya dosya listesini miras alır; kaldırma bütün sürüm dosyalarını sayar', () => {
    const { resource, version: published } = build(
      schoolText({ content: fileContent('f-1'), fileIds: ['f-1', 'f-2'] }),
      {
        version: { status: 'published', publishedAt: now },
        resource: { shareScope: 'institution' },
      },
    )
    const next = planNewVersion({
      actor: author,
      institutionType: 'school',
      resource,
      versions: [published],
      versionId: 'test-r1-v2',
      now,
    })
    assert.deepEqual(next.fileIds, ['f-1', 'f-2'])
    const copy = planCopy({
      actor: author,
      institutionType: 'school',
      source: { origin: 'institution', resource, version: published },
      ids: { resourceId: 'test-copy', versionId: 'test-copy-v1' },
      now,
    })
    assert.deepEqual(copy.version.fileIds, ['f-1', 'f-2'])
    const removal = planResourceRemoval({
      actor: admin,
      resource,
      versions: [published, { ...next, fileIds: ['f-3'] }],
      reason: 'Telif ihlali bildirimi',
      now,
    })
    assert.deepEqual(removal.fileIds, ['f-1', 'f-2', 'f-3'])
  })
})
