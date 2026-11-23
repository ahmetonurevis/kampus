import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { wordCount } from '../packages/school-core/src/content/resource.ts'
import type { Actor } from '../packages/school-core/src/lib/scope.ts'
import { deadlineSchema, type DeadlineInput } from '../packages/school-core/src/skills/scoring.ts'
import {
  SPEAKING_ATTEMPT_LIMITS,
  SPEAKING_SECONDS,
  VERSION_LIMITS,
  assertGradableVersion,
  canReadDraft,
  planDraftSave,
  planSubmissionVersion,
  submissionSettingsSchema,
  submissionStatus,
  submissionViewFor,
  versionAllowance,
  versionIsLate,
  wordCountCheck,
  type DraftRow,
  type SubmissionFile,
  type SubmissionRow,
  type SubmissionSettingsInput,
  type SubmissionVersionPlanInput,
  type VersionRow,
} from '../packages/school-core/src/skills/submission.ts'
import { isDomainError } from './support/domain-error.ts'

const due = '2026-11-05T20:59:00.000Z'
const now = '2026-11-04T09:00:00.000Z'
const plusMs = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString()
const deadline = (input: DeadlineInput = { dueAt: due }) => deadlineSchema.parse(input)
const settings = (input: SubmissionSettingsInput = { submissionKind: 'text' }) =>
  submissionSettingsSchema.parse(input)
const speaking = settings({ submissionKind: 'audio', speakingSeconds: 90 })

const submission = (input: Partial<SubmissionRow> = {}): SubmissionRow => ({
  id: 'test-sub-1',
  learnerId: 'test-s1',
  resubmissionRequestedForVersion: null,
  ...input,
})
const version = (number: number, input: Partial<VersionRow> = {}): VersionRow => ({
  id: `test-v${number}`,
  number,
  submittedAt: plusMs(now, -number * 60_000),
  body: `Sürüm ${number}`,
  fileIds: [],
  ...input,
})
const versions = (count: number) => Array.from({ length: count }, (_, i) => version(i + 1))

const essay = 'My summer holiday was great. We went to Ankara and visited Anıtkabir.'
const planText = (input: Partial<SubmissionVersionPlanInput> = {}) =>
  planSubmissionVersion({
    settings: settings(),
    deadline: deadline(),
    submission: null,
    versions: [],
    gradedVersionNumbers: [],
    input: { submissionKind: 'text', body: essay },
    files: [],
    now,
    ...input,
  })
const plan = planText

const recording = (input: Partial<SubmissionFile> = {}): SubmissionFile => ({
  id: 'test-f-rec',
  purpose: 'speaking_recording',
  contentType: 'audio/webm',
  byteSize: 500_000,
  durationSeconds: 60,
  ...input,
})
const scan = (input: Partial<SubmissionFile> = {}): SubmissionFile => ({
  id: 'test-f-scan',
  purpose: 'submission',
  contentType: 'image/jpeg',
  byteSize: 800_000,
  ...input,
})

const student: Actor = { role: 'ogrenci', links: [{ kind: 'student', recordId: 'test-s1' }] }
const otherStudent: Actor = { role: 'ogrenci', links: [{ kind: 'student', recordId: 'test-s2' }] }
const teacher: Actor = { role: 'ogretmen', links: [{ kind: 'teacher', recordId: 'test-t1' }] }
const parent: Actor = { role: 'veli', links: [{ kind: 'child', recordId: 'test-s1' }] }
const admin: Actor = { role: 'yonetici', links: [] }
const frontDesk: Actor = { role: 'onburo', links: [] }
const draft: DraftRow = {
  learnerId: 'test-s1',
  body: 'Yarım kalan metin',
  revision: 3,
  savedAt: now,
}

describe('teslim ayarı (DOM-BEC-040, IST-051)', () => {
  test('DOM-BEC-040 sürüm sınırı varsayılan 3, görev ayarıyla 1–5', () => {
    assert.deepEqual(settings(), {
      submissionKind: 'text',
      maxVersions: VERSION_LIMITS.default,
      minWords: null,
      maxWords: null,
    })
    for (const maxVersions of [0, 6, 2.5]) {
      assert.equal(
        submissionSettingsSchema.safeParse({ submissionKind: 'text', maxVersions }).success,
        false,
      )
    }
    assert.equal(settings({ submissionKind: 'file', maxVersions: 5 }).maxVersions, 5)
  })

  test('DOM-BEC-046 sözcük alt sınırı üst sınırı aşamaz', () => {
    const parsed = submissionSettingsSchema.safeParse({
      submissionKind: 'text',
      minWords: 200,
      maxWords: 100,
    })
    assert.equal(parsed.success, false)
    assert.deepEqual(parsed.error?.issues[0]?.path, ['maxWords'])
  })

  test('IST-051, DOM-BEC-054 konuşma deneme hakkı varsayılan 1, 1–3; süre sınırı varsayılan 3 dk, 10 sn–10 dk', () => {
    assert.equal(speaking.submissionKind === 'audio' && speaking.speakingAttempts, 1)
    assert.equal(SPEAKING_ATTEMPT_LIMITS.max, 3)
    const defaults = settings({ submissionKind: 'audio' })
    assert.equal(defaults.submissionKind === 'audio' && defaults.speakingSeconds, 180)
    assert.equal(SPEAKING_SECONDS.default, 180)
    assert.equal(SPEAKING_SECONDS.max, 600)
    const bad = [
      { speakingAttempts: 4, speakingSeconds: 60 },
      { speakingSeconds: 5 },
      { speakingSeconds: 601 },
      { speakingSeconds: 90.5 },
    ]
    for (const input of bad) {
      assert.equal(
        submissionSettingsSchema.safeParse({ submissionKind: 'audio', ...input }).success,
        false,
        JSON.stringify(input),
      )
    }
  })
})

describe('tek teslim ve değişmez sürümler (DOM-BEC-040)', () => {
  test('DOM-BEC-040 ilk gönderim teslim kaydını açar ve 1. sürümü ekler', () => {
    const result = plan()
    assert.equal(result.createSubmission, true)
    assert.deepEqual(result.version, { number: 1, submittedAt: now, body: essay, fileIds: [] })
    assert.equal(result.consumesResubmission, false)
    assert.equal(result.wordCount?.count, 12)
  })

  test('DOM-BEC-040 yeniden gönderim aynı teslim kaydına yeni sürüm ekler, öncekilere dokunmaz', () => {
    const existing = versions(2)
    const snapshot = structuredClone(existing)
    const result = plan({ submission: submission(), versions: existing })
    assert.equal(result.createSubmission, false)
    assert.equal(result.version.number, 3)
    assert.deepEqual(existing, snapshot)
  })

  test('DOM-BEC-040 sürüm sınırı aşılınca gönderim reddedilir', () => {
    const existing = versions(3)
    assert.throws(
      () => plan({ submission: submission(), versions: existing }),
      (error: unknown) =>
        isDomainError('version_limit_reached')(error) &&
        (error as Error).message === 'En fazla 3 sürüm gönderebilirsiniz.',
    )
    assert.equal(existing.length, 3)
    const one = settings({ submissionKind: 'text', maxVersions: 1 })
    assert.throws(
      () => plan({ settings: one, submission: submission(), versions: versions(1) }),
      isDomainError('version_limit_reached'),
    )
    assert.equal(
      plan({
        settings: settings({ submissionKind: 'text', maxVersions: 5 }),
        versions: versions(4),
      }).version.number,
      5,
    )
  })

  test('DOM-BEC-040 puanlanan teslime yeni sürüm yalnız yeniden teslim isteğiyle açılır', () => {
    const existing = versions(1)
    assert.throws(
      () => plan({ submission: submission(), versions: existing, gradedVersionNumbers: [1] }),
      isDomainError('resubmission_not_requested', 'conflict'),
    )
    const requested = submission({ resubmissionRequestedForVersion: 1 })
    const result = plan({ submission: requested, versions: existing, gradedVersionNumbers: [1] })
    assert.equal(result.version.number, 2)
    assert.equal(result.consumesResubmission, true)
  })

  test('DOM-BEC-040 yeniden teslim isteği sürüm sınırına sayılmaz, eski sürüm isteği geçersizdir', () => {
    const existing = versions(3)
    const requested = submission({ resubmissionRequestedForVersion: 3 })
    assert.equal(
      plan({ submission: requested, versions: existing, gradedVersionNumbers: [3] }).version.number,
      4,
    )
    const stale = submission({ resubmissionRequestedForVersion: 1 })
    assert.throws(
      () => plan({ submission: stale, versions: versions(2), gradedVersionNumbers: [1, 2] }),
      isDomainError('resubmission_not_requested', 'conflict'),
    )
  })

  test('DOM-BEC-040 hak özeti kalan sürümü ve engel nedenini verir', () => {
    const base = { settings: settings(), submission: submission(), gradedVersionNumbers: [] }
    assert.deepEqual(versionAllowance({ ...base, versions: versions(1) }), {
      limit: 3,
      used: 1,
      remaining: 2,
      resubmissionOpen: false,
      canSubmit: true,
      blockedBy: null,
    })
    assert.equal(versionAllowance({ ...base, versions: versions(3) }).blockedBy, 'limit')
    assert.equal(
      versionAllowance({ ...base, versions: versions(4), gradedVersionNumbers: [4] }).remaining,
      0,
    )
  })

  test('DOM-BEC-040 öğretmen yalnız son sürümü puanlar', () => {
    const existing = versions(3)
    assert.equal(assertGradableVersion(existing, 'test-v3').number, 3)
    assert.throws(
      () => assertGradableVersion(existing, 'test-v2'),
      isDomainError('version_not_latest', 'conflict'),
    )
    assert.throws(
      () => assertGradableVersion(existing, 'test-v9'),
      isDomainError('submission_version_not_found', 'not_found'),
    )
  })

  test('DOM-BEC-040 gövde şeması ve tür uyuşmazlığı reddedilir', () => {
    assert.throws(() => plan({ input: { submissionKind: 'text', body: '   ' } }), {
      name: 'ZodError',
    })
    assert.throws(() => plan({ input: { submissionKind: 'text', body: 'a'.repeat(50_001) } }), {
      name: 'ZodError',
    })
    assert.throws(
      () => plan({ input: { submissionKind: 'audio', recordingFileId: 'test-f-rec' } }),
      isDomainError('submission_kind_mismatch'),
    )
    assert.throws(
      () =>
        plan({
          settings: settings({ submissionKind: 'file' }),
          input: { submissionKind: 'file', fileIds: ['a', 'a'] },
        }),
      { name: 'ZodError' },
    )
  })
})

describe('geç teslim (DOM-BEC-044)', () => {
  test('DOM-BEC-044 son teslim anında gönderim zamanındadır, sonrası geçtir ve saklanmaz', () => {
    const onTime = plan({ now: due })
    assert.equal(versionIsLate(onTime.version, deadline()), false)
    assert.equal('isLate' in onTime.version, false)
    const late = plan({
      deadline: deadline({ dueAt: due, lateAcceptanceDays: 3 }),
      now: plusMs(due, 1),
    })
    assert.equal(versionIsLate(late.version, deadline()), true)
  })

  test('DOM-BEC-044 geç kabul kapalıysa son teslimden sonra gönderim reddedilir', () => {
    assert.throws(
      () => plan({ now: plusMs(due, 1) }),
      (error: unknown) =>
        isDomainError('submission_closed')(error) &&
        (error as Error).message === 'Son teslim tarihi geçti; bu görev geç teslim kabul etmiyor.',
    )
  })

  test('DOM-BEC-044 geç kabul süresinin son anı açık, sonrası kapalıdır', () => {
    const d = deadline({ dueAt: due, lateAcceptanceDays: 2 })
    const closesAt = plusMs(due, 2 * 86_400_000)
    assert.equal(plan({ deadline: d, now: closesAt }).version.submittedAt, closesAt)
    assert.throws(
      () => plan({ deadline: d, now: plusMs(closesAt, 1) }),
      (error: unknown) =>
        isDomainError('submission_closed')(error) &&
        (error as Error).message === 'Geç teslim süresi doldu; bu görev artık teslim alınmıyor.',
    )
  })

  test('DOM-BEC-044 teslim edilmeyen görev kapanınca teslim edilmedi olur', () => {
    assert.equal(submissionStatus([], deadline(), due), 'pending')
    assert.equal(submissionStatus([], deadline(), plusMs(due, 1)), 'not_submitted')
    assert.equal(
      submissionStatus([], deadline({ dueAt: null }), '2099-01-01T00:00:00.000Z'),
      'pending',
    )
    assert.equal(submissionStatus(versions(1), deadline(), plusMs(due, 1)), 'submitted')
    assert.equal(
      submissionStatus([version(1, { submittedAt: plusMs(due, 1) })], deadline(), plusMs(due, 1)),
      'late',
    )
  })
})

describe('sözcük sayısı (DOM-BEC-046)', () => {
  test('DOM-BEC-046 Türkçe ve İngilizce metinde ek, kısaltma ve tire tek sözcüktür', () => {
    assert.equal(wordCount("İstanbul'a gittim, Boğaz'ı gördüm."), 4)
    assert.equal(wordCount("I don't think it's a well-known fact."), 7)
    assert.equal(wordCount('Çağrı, ılık ŞUBAT günü; öğle — 12:30.'), 7)
    assert.equal(wordCount('e-mail‑address co‐operate'), 2)
    assert.equal(wordCount('  \n\t … — !?  '), 0)
    assert.equal(wordCount(''), 0)
  })

  test('DOM-BEC-046 ayrışık yazılmış harf (NFD) sözcüğü bölmez', () => {
    const composed = 'İzmir’de öğrenciyiz'
    assert.equal(wordCount(composed.normalize('NFD')), wordCount(composed))
    assert.equal(wordCount(composed.normalize('NFD')), 2)
  })

  test('DOM-BEC-046 sınır dışı metin uyarıyla kabul edilir, reddedilmez', () => {
    assert.deepEqual(wordCountCheck('one two three', { minWords: 5, maxWords: null }), {
      count: 3,
      status: 'below',
      warning: 'Metin 3 sözcük; en az 5 sözcük isteniyor.',
    })
    assert.equal(wordCountCheck('one two three', { minWords: null, maxWords: 2 }).status, 'above')
    assert.deepEqual(wordCountCheck('one two', { minWords: 2, maxWords: 2 }), {
      count: 2,
      status: 'ok',
      warning: null,
    })
    const limited = settings({ submissionKind: 'text', minWords: 50, maxWords: 120 })
    const result = plan({ settings: limited })
    assert.equal(result.version.body, essay)
    assert.equal(result.wordCount?.status, 'below')
  })
})

describe('el yazısı teslimi (DOM-BEC-046)', () => {
  const fileSettings = settings({ submissionKind: 'file' })

  test('DOM-BEC-046 el yazısı görüntü veya PDF olarak yüklenir', () => {
    const pdf = scan({ id: 'test-f-pdf', contentType: 'application/pdf' })
    const result = plan({
      settings: fileSettings,
      input: { submissionKind: 'file', fileIds: ['test-f-scan', 'test-f-pdf'] },
      files: [scan(), pdf],
    })
    assert.deepEqual(result.version.fileIds, ['test-f-scan', 'test-f-pdf'])
    assert.equal(result.version.body, null)
    assert.equal(result.wordCount, null)
  })

  test('DOM-BEC-046 Word dosyası, başka amaçlı dosya ve büyük dosya reddedilir', () => {
    const docx = scan({
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })
    const cases: [SubmissionFile[], string, string][] = [
      [[docx], 'file_type_not_allowed', 'rule'],
      [[scan({ purpose: 'material' })], 'submission_file_not_found', 'not_found'],
      [[], 'submission_file_not_found', 'not_found'],
      [[scan({ byteSize: 21 * 1024 * 1024 })], 'file_too_large', 'rule'],
      [[scan({ contentType: 'text/html' })], 'file_type_not_allowed', 'rule'],
    ]
    for (const [files, code, kind] of cases) {
      assert.throws(
        () =>
          plan({
            settings: fileSettings,
            input: { submissionKind: 'file', fileIds: ['test-f-scan'] },
            files,
          }),
        (error: unknown) =>
          isDomainError(code, kind)(error) &&
          (error as { path: string[] }).path.join('.') === 'fileIds.0',
        code,
      )
    }
  })
})

describe('konuşma deneme hakkı (IST-051)', () => {
  const input = { submissionKind: 'audio', recordingFileId: 'test-f-rec' }
  const plan = (extra: Partial<SubmissionVersionPlanInput> = {}) =>
    planText({ recordingConsent: true, ...extra })

  test('IST-051 gönderilen kayıt yeni sürüm açar', () => {
    const result = plan({ settings: speaking, input, files: [recording()] })
    assert.deepEqual(result.version.fileIds, ['test-f-rec'])
    assert.equal(result.version.body, null)
  })

  test('IST-051 deneme hakkı aşılamaz; etkin sınır hak ile sürüm sınırının küçüğüdür', () => {
    assert.throws(
      () =>
        plan({
          settings: speaking,
          input,
          files: [recording()],
          submission: submission(),
          versions: versions(1),
        }),
      (error: unknown) =>
        isDomainError('version_limit_reached')(error) &&
        (error as Error).message === 'Konuşma deneme hakkınız doldu.',
    )
    const three = settings({
      submissionKind: 'audio',
      speakingSeconds: 90,
      speakingAttempts: 3,
      maxVersions: 2,
    })
    const allowance = versionAllowance({
      settings: three,
      submission: submission(),
      versions: versions(1),
      gradedVersionNumbers: [],
    })
    assert.equal(allowance.limit, 2)
    assert.equal(allowance.remaining, 1)
  })

  test('IST-051, DOM-BEC-054 kayıt süre sınırını aşamaz; tam sınır kabul edilir, boş ve ölçülmemiş kayıt reddedilir', () => {
    for (const durationSeconds of [1, 90])
      assert.doesNotThrow(() =>
        plan({ settings: speaking, input, files: [recording({ durationSeconds })] }),
      )
    const cases: [number | null | undefined, string][] = [
      [90.01, 'recording_too_long'],
      [0, 'recording_empty'],
      [0.4, 'recording_empty'],
      [null, 'recording_not_measured'],
      [undefined, 'recording_not_measured'],
    ]
    for (const [durationSeconds, code] of cases) {
      assert.throws(
        () =>
          plan({
            settings: speaking,
            input,
            files: [recording({ durationSeconds: durationSeconds as number | null })],
          }),
        (error: unknown) =>
          isDomainError(code)(error) &&
          (error as { path: string[] }).path.join('.') === 'recordingFileId',
        String(durationSeconds),
      )
    }
  })

  test('DOM-BEC-050 rıza yoksa sesli teslim 403 consent_required; kapalı pencereden ve hak sınırından önce gelir', () => {
    for (const recordingConsent of [false, undefined]) {
      assert.throws(
        () =>
          planText({
            settings: speaking,
            input,
            files: [recording()],
            ...(recordingConsent === undefined ? {} : { recordingConsent }),
          }),
        isDomainError('consent_required', 'forbidden'),
      )
    }
    assert.throws(
      () =>
        planText({
          settings: speaking,
          input,
          files: [recording()],
          submission: submission(),
          versions: versions(1),
          now: plusMs(due, 86_400_000),
        }),
      isDomainError('consent_required', 'forbidden'),
    )
    // Rıza yalnız sesli teslimde aranır: yazma ve dosyalı teslim rızasız geçer.
    assert.doesNotThrow(() => planText())
    assert.doesNotThrow(() =>
      planText({
        settings: settings({ submissionKind: 'file' }),
        input: { submissionKind: 'file', fileIds: ['test-f-scan'] },
        files: [scan()],
      }),
    )
  })

  test('IST-051 konuşma kaydı yalnız kayıt amaçlı ses dosyası olabilir', () => {
    assert.throws(
      () =>
        plan({
          settings: speaking,
          input,
          files: [recording({ purpose: 'listening_audio' })],
        }),
      isDomainError('submission_file_not_found', 'not_found'),
    )
    assert.throws(
      () => plan({ settings: speaking, input, files: [recording({ contentType: 'video/mp4' })] }),
      (error: unknown) =>
        isDomainError('file_type_not_allowed')(error) &&
        (error as { path: string[] }).path.join('.') === 'recordingFileId',
    )
  })
})

describe('taslak (IST-047, ADR 0004 karar 6)', () => {
  const save = (input: Partial<Parameters<typeof planDraftSave>[0]> = {}) =>
    planDraftSave({
      settings: settings(),
      deadline: deadline(),
      draft: null,
      learnerId: 'test-s1',
      input: { body: 'İlk paragraf', expectedRevision: 0 },
      now,
      ...input,
    })

  test('IST-047 taslak kursiyer × atama başına tek satır olarak üzerine yazılır', () => {
    assert.deepEqual(save(), {
      learnerId: 'test-s1',
      body: 'İlk paragraf',
      revision: 1,
      savedAt: now,
    })
    const next = save({ draft, input: { body: 'Güncel metin', expectedRevision: 3 } })
    assert.equal(next.revision, 4)
    assert.equal(next.body, 'Güncel metin')
    assert.equal(draft.revision, 3)
    assert.equal(save({ input: { body: '', expectedRevision: 0 } }).body, '')
  })

  test('IST-047 bayat taslak sürümü çakışmadır, kayıt değişmez', () => {
    const before = structuredClone(draft)
    assert.throws(
      () => save({ draft, input: { body: 'Eski pencere', expectedRevision: 2 } }),
      isDomainError('draft_conflict', 'conflict'),
    )
    assert.throws(
      () => save({ input: { body: 'x', expectedRevision: 1 } }),
      isDomainError('draft_conflict', 'conflict'),
    )
    assert.deepEqual(draft, before)
  })

  test('IST-047 taslak yalnız yazma görevinde, teslim açıkken ve kendi satırında tutulur', () => {
    assert.throws(() => save({ settings: speaking }), isDomainError('draft_not_supported'))
    assert.throws(() => save({ now: plusMs(due, 1) }), isDomainError('submission_closed'))
    assert.throws(
      () => save({ draft, learnerId: 'test-s2', input: { body: 'x', expectedRevision: 3 } }),
      isDomainError('draft_not_found', 'not_found'),
    )
    assert.throws(() => save({ input: { body: 'x', expectedRevision: -1 } }), { name: 'ZodError' })
  })

  test('IST-047 taslak öğretmene, yöneticiye, ön büroya ve veliye görünmez', () => {
    assert.equal(canReadDraft(student, draft), true)
    for (const actor of [otherStudent, teacher, admin, frontDesk, parent]) {
      assert.equal(canReadDraft(actor, draft), false, actor.role)
    }
  })

  test('IST-047 teslim görünümü sürümleri eskiden yeniye verir, taslağı yalnız kursiyere', () => {
    const list = [version(2), version(1), version(3)]
    const teacherView = submissionViewFor(teacher, { versions: list, draft })
    assert.deepEqual(
      teacherView.versions.map((v) => v.number),
      [1, 2, 3],
    )
    assert.equal(teacherView.draft, null)
    assert.equal(submissionViewFor(parent, { versions: list, draft }).draft, null)
    assert.equal(submissionViewFor(student, { versions: list, draft }).draft, draft)
    assert.equal(submissionViewFor(student, { versions: [], draft: null }).draft, null)
    assert.deepEqual(
      list.map((v) => v.number),
      [2, 1, 3],
    )
  })
})
