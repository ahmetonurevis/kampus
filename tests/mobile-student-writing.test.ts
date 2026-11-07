import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ApiError } from '../packages/api-client/src/errors.ts'
import type { KampusClient } from '../packages/api-client/src/client.ts'
import { runRequest } from '../packages/react-shared/src/api-result.ts'
import {
  createCommandSession,
  routeCommandErrors,
  runCommand,
} from '../packages/react-shared/src/commands.ts'
import { createDraftSaver } from '../packages/react-shared/src/draft-autosave-model.ts'
import { dateTimeLabel } from '../packages/react-shared/src/task-labels.ts'
import {
  TASK_DRAFT_ALREADY_SUBMITTED_MESSAGE,
  TASK_DRAFT_SAVED_ELSEWHERE_MESSAGE,
  submitTaskDraftCommand,
} from '../packages/react-shared/src/use-task-submissions.ts'
import type { TaskAssignmentLearner } from '../packages/react-shared/src/use-task-assignments.ts'
import { timeLabel } from '../packages/school-core/src/lib/format.ts'
import {
  DRAFT_NOT_SAVED_TEXT,
  SUBMIT_CONFIRM_TEXT,
  SUBMIT_DONE_TEXT,
  UNSAVED_CLOSE_TEXT,
  autosaveEnabled,
  checkWritingBody,
  closeNeedsConfirm,
  draftStatusText,
  flushFailureText,
  initialWritingMode,
  isWritingTask,
  mobileTone,
  newVersionText,
  submitWriting,
  teacherTasks,
  writingFieldFor,
  writingSheetReady,
  writingSubmitFailure,
  writingTaskMatches,
  writingTaskRow,
} from '../apps/mobile/src/api/student-writing.ts'

// Mobil öğrenci yazma görevi (OG-061; IST-124, IST-047; DOM-BEC-040, 044, 045, 046): liste satırı,
// pencere kipi, durum metinleri, teslim onayı ve hata görünümü. Taslak metni cihaza yazılmaz.

const apiError = (status: number, code: string, message = 'Sunucu mesajı') =>
  new ApiError({ status, code, message })
const networkError = () => apiError(0, 'network_error')

const NOW = new Date('2026-11-03T09:00:00.000Z')

type Progress = TaskAssignmentLearner['progress'][number]

const progress = (extra: Partial<Progress> = {}): Progress => ({
  learnerId: 's1',
  status: 'pending',
  resubmissionRequested: false,
  attemptId: null,
  submissionId: null,
  lastActivityAt: null,
  used: 0,
  limit: 3,
  remaining: 3,
  canAct: true,
  actionableUntil: null,
  blockedBy: null,
  score: null,
  ...extra,
})

const task = (extra: Partial<TaskAssignmentLearner> = {}): TaskAssignmentLearner => ({
  view: 'learner',
  id: 'a1',
  resourceId: 'r1',
  resourceVersionId: 'rv1',
  title: 'My weekend',
  contentType: 'homework_template',
  scoringMode: 'teacher',
  kind: 'practice',
  attempts: { kind: 'practice' },
  deadline: { dueAt: '2026-11-20T20:59:00.000Z', lateAcceptanceDays: 0 },
  timeLimitMinutes: null,
  listeningPlays: null,
  hasListening: false,
  showTranscript: false,
  submission: { submissionKind: 'text', maxVersions: 3, minWords: null, maxWords: null },
  createdAt: '2026-11-01T09:00:00.000Z',
  learnerIds: ['s1'],
  progress: [progress()],
  ...extra,
})

describe('IST-124: yazma görevi ayrımı (DOM-BEC-040)', () => {
  test('yalnız öğretmen puanlı metin teslimi açılır; konuşma, dosya ve otomatik görev açılmaz', () => {
    assert.equal(isWritingTask(task()), true)
    assert.equal(
      isWritingTask(task({ submission: { submissionKind: 'audio' } as never })),
      false,
      'konuşma',
    )
    assert.equal(
      isWritingTask(task({ submission: { submissionKind: 'file', maxVersions: 3 } })),
      false,
      'el yazısı',
    )
    assert.equal(isWritingTask(task({ submission: null })), false, 'teslimsiz')
    assert.equal(isWritingTask(task({ scoringMode: 'auto', submission: null })), false, 'quiz')
  })

  test('teacherTasks otomatik puanlı görevleri listeden çıkarır ve sırayı korur', () => {
    const items = [
      task({ id: 'a' }),
      task({ id: 'b', scoringMode: 'auto', submission: null }),
      task({ id: 'c' }),
    ]
    assert.deepEqual(
      teacherTasks(items).map((item) => item.id),
      ['a', 'c'],
    )
  })

  test('mobileTone gri tonu sakin birincil tona çevirir, diğerlerini korur', () => {
    assert.equal(mobileTone('gray'), 'primary')
    for (const tone of ['green', 'amber', 'red'] as const) assert.equal(mobileTone(tone), tone)
  })
})

describe('IST-124: Görevler satırı (DOM-BEC-044, 045)', () => {
  test('bekleyen yazma görevi: durum, hak, son teslim ve erişilebilir ad', () => {
    const row = writingTaskRow(task(), NOW)
    assert.equal(row.status, 'Bekliyor')
    assert.equal(row.tone, 'amber')
    assert.equal(row.writable, true)
    assert.equal(row.score, null)
    assert.equal(
      row.subtitle,
      [
        'Yazma ödevi',
        'Alıştırma',
        `Son teslim: ${dateTimeLabel('2026-11-20T20:59:00.000Z')}`,
        '0 / 3 sürüm',
      ].join(' · '),
    )
    assert.equal(row.label, 'My weekend, Bekliyor. Görevi aç')
  })

  test('son tarihsiz görev "Belirtilmemiş" yazar; sınırsız hak alt başlığa girmez', () => {
    const row = writingTaskRow(
      task({
        deadline: { dueAt: null, lateAcceptanceDays: 0 },
        progress: [progress({ limit: null, remaining: null })],
      }),
      NOW,
    )
    assert.match(row.subtitle, /Son teslim: Belirtilmemiş/)
    assert.doesNotMatch(row.subtitle, /sürüm/)
  })

  test('puan yalnız sunucu açtıysa görünür (DOM-BEC-045)', () => {
    const hidden = writingTaskRow(
      task({ progress: [progress({ status: 'submitted', used: 1, score: null })] }),
      NOW,
    )
    assert.equal(hidden.score, null)
    assert.equal(hidden.status, 'Teslim edildi')
    assert.equal(hidden.tone, 'green')
    const released = writingTaskRow(
      task({
        progress: [
          progress({
            status: 'submitted',
            used: 1,
            score: { earned: 8, possible: 10, percent: 80 },
          }),
        ],
      }),
      NOW,
    )
    assert.equal(released.score, '80 / 100')
  })

  test('son teslimi geçen başlanmamış görev "Teslim edilmedi" olur ve kırmızı görünür', () => {
    const row = writingTaskRow(
      task({ deadline: { dueAt: '2026-11-01T09:00:00.000Z', lateAcceptanceDays: 0 } }),
      NOW,
    )
    assert.equal(row.status, 'Teslim edilmedi')
    assert.equal(row.tone, 'red')
  })

  test('yeniden teslim istenen görev kehribar rozetle görünür', () => {
    const row = writingTaskRow(
      task({
        progress: [progress({ status: 'submitted', used: 1, resubmissionRequested: true })],
      }),
      NOW,
    )
    assert.equal(row.status, 'Yeniden teslim istendi')
    assert.equal(row.tone, 'amber')
  })

  test('özeti olmayan satır "Okunamadı" gösterir ama diğer satırlar etkilenmez', () => {
    const broken = writingTaskRow(task({ id: 'x', progress: [] }), NOW)
    assert.equal(broken.status, 'Okunamadı')
    assert.equal(broken.tone, 'red')
    assert.equal(writingTaskRow(task({ id: 'y' }), NOW).status, 'Bekliyor')
  })

  test('konuşma görevi satırda görünür ama açılmaz ve adı "Görevi aç" demez', () => {
    const row = writingTaskRow(task({ submission: { submissionKind: 'audio' } as never }), NOW)
    assert.equal(row.writable, false)
    assert.equal(row.label, 'My weekend, Bekliyor')
  })

  test('arama başlık ve alt başlıkta Türkçe büyük/küçük harf duyarsız çalışır', () => {
    const row = { title: 'Işık ve gölge', subtitle: 'Yazma ödevi · Alıştırma' }
    assert.equal(writingTaskMatches(row, ''), true)
    assert.equal(writingTaskMatches(row, '   '), true)
    assert.equal(writingTaskMatches(row, 'IŞIK'), true)
    assert.equal(writingTaskMatches(row, 'yazma'), true)
    assert.equal(writingTaskMatches(row, 'konuşma'), false)
  })
})

describe('IST-124: yazma penceresinin açılış kipi (IST-047)', () => {
  const base = {
    canAct: true,
    versionCount: 1,
    draftSavedAt: null,
    latestSubmittedAt: '2026-11-02T09:00:00.000Z',
  }

  test('hiç sürüm yoksa editör açılır', () => {
    assert.equal(
      initialWritingMode({ ...base, versionCount: 0, latestSubmittedAt: null }),
      'editor',
    )
  })

  test('son sürümden yeni taslak varsa editör, eski ya da yoksa salt okur açılır', () => {
    assert.equal(
      initialWritingMode({ ...base, draftSavedAt: '2026-11-03T08:00:00.000Z' }),
      'editor',
    )
    assert.equal(
      initialWritingMode({ ...base, draftSavedAt: '2026-11-01T08:00:00.000Z' }),
      'readonly',
    )
    assert.equal(initialWritingMode(base), 'readonly')
  })

  test('teslim kapalıyken (canAct yok) her durumda salt okur; taslak görünse bile yazılmaz', () => {
    assert.equal(initialWritingMode({ ...base, canAct: false, versionCount: 0 }), 'readonly')
    assert.equal(
      initialWritingMode({ ...base, canAct: false, draftSavedAt: '2026-11-03T08:00:00.000Z' }),
      'readonly',
    )
  })

  test('sürüm var, son gönderim zamanı yok ve taslak var: editör', () => {
    assert.equal(
      initialWritingMode({
        canAct: true,
        versionCount: 1,
        draftSavedAt: '2026-11-03T08:00:00.000Z',
        latestSubmittedAt: null,
      }),
      'editor',
    )
  })

  test('yeni sürüm düğmesi metni', () => {
    assert.equal(newVersionText(0), 'Yazmaya başla')
    assert.equal(newVersionText(2), 'Yeni sürüm yaz')
  })
})

describe('IST-124: taslak durum metni (web ile aynı)', () => {
  const idle = { state: 'idle', savedAt: null, conflict: false, canSubmit: true } as const

  test('teslim kapalıysa her şeyden önce bu söylenir', () => {
    assert.equal(
      draftStatusText({ ...idle, state: 'error', conflict: true, canSubmit: false }),
      'Teslim şu an açık değil.',
    )
  })

  test('kaydediliyor, hata, çakışma, kaydedildi ve boşta metinleri', () => {
    assert.equal(draftStatusText({ ...idle, state: 'saving' }), 'Taslak kaydediliyor…')
    assert.equal(
      draftStatusText({ ...idle, state: 'error' }),
      'Taslak kaydedilemedi; yazmaya devam edebilirsiniz.',
    )
    assert.equal(draftStatusText({ ...idle, conflict: true }), TASK_DRAFT_SAVED_ELSEWHERE_MESSAGE)
    const savedAt = '2026-11-03T09:05:00.000Z'
    assert.equal(
      draftStatusText({ ...idle, state: 'saved', savedAt }),
      `Taslak kaydedildi (${timeLabel(savedAt)}).`,
    )
    assert.equal(draftStatusText(idle), 'Taslak otomatik kaydedilir.')
    assert.equal(draftStatusText({ ...idle, state: 'saved' }), 'Taslak otomatik kaydedilir.')
  })

  test('kayıt hatası çakışmadan önce söylenir (yazı kaybı riski önce gelir)', () => {
    assert.equal(
      draftStatusText({ ...idle, state: 'error', conflict: true }),
      'Taslak kaydedilemedi; yazmaya devam edebilirsiniz.',
    )
  })
})

describe('IST-124: teslim onayından önce metin denetimi (DOM-BEC-040)', () => {
  test('boş ve yalnız boşluktan oluşan metin "Metni yazın." hatası verir', () => {
    assert.equal(checkWritingBody(''), 'Metni yazın.')
    assert.equal(checkWritingBody('   \n '), 'Metni yazın.')
  })

  test('geçerli metin hatasızdır; 50.000 karakter sınırdır, aşan metin reddedilir', () => {
    assert.equal(checkWritingBody('I went to the park.'), null)
    assert.equal(checkWritingBody('a'.repeat(50_000)), null)
    assert.notEqual(checkWritingBody('a'.repeat(50_001)), null)
  })

  test('teslim onay metni sürümün sonradan değişmeyeceğini söyler', () => {
    assert.match(SUBMIT_CONFIRM_TEXT, /sonradan değiştirilemez/)
    assert.equal(SUBMIT_DONE_TEXT, 'Teslim edildi.')
  })
})

describe('IST-124: teslim hatası görünümü (DOM-BEC-044, 046)', () => {
  test('taslağa ait kodlar metin alanına, diğerleri forma bağlanır', () => {
    assert.equal(writingFieldFor(apiError(409, 'draft_already_submitted')), 'body')
    assert.equal(writingFieldFor(apiError(422, 'draft_empty')), 'body')
    assert.equal(writingFieldFor(apiError(409, 'draft_conflict')), undefined)
    assert.equal(writingFieldFor(apiError(409, 'submission_closed')), undefined)
  })

  test('alan maddesi varsa mesaj alanın altındadır, genel mesaj yoktur', () => {
    const failure = writingSubmitFailure(apiError(409, 'draft_already_submitted'), {
      body: TASK_DRAFT_ALREADY_SUBMITTED_MESSAGE,
    })
    assert.equal(failure.message, null)
    assert.deepEqual(failure.fields, { body: TASK_DRAFT_ALREADY_SUBMITTED_MESSAGE })
    assert.equal(failure.retryable, false)
  })

  test('süre dolması Türkçe sözlük mesajıyla gelir ve yeniden denenmez', () => {
    const failure = writingSubmitFailure(apiError(409, 'submission_closed'), {})
    assert.equal(failure.message, 'Bu görevin teslim süresi doldu.')
    assert.equal(failure.retryable, false)
  })

  test('ağ hatası ve 5xx belirsizdir: yeniden denenebilir', () => {
    assert.equal(writingSubmitFailure(networkError(), {}).retryable, true)
    assert.equal(writingSubmitFailure(apiError(503, 'unavailable'), {}).retryable, true)
  })

  test('kayıt hatası metni: başka pencere uyarısı ya da bağlantı denetimi', () => {
    assert.equal(flushFailureText(true), TASK_DRAFT_SAVED_ELSEWHERE_MESSAGE)
    assert.equal(flushFailureText(false), DRAFT_NOT_SAVED_TEXT)
    assert.match(DRAFT_NOT_SAVED_TEXT, /teslim edilmedi/)
  })
})

describe('IST-124: teslim akışı, taslak ve yeniden deneme (IST-047)', () => {
  type Step = 'ok' | ApiError

  /** Kayıt ve teslim istekleri kaydedilir; karar akışı `submitWriting`'indir. */
  function sheet(options: { saveFails?: boolean; submitScript?: Step[] }) {
    const saves: Array<{ revision: number | null; body: string }> = []
    const keys: Array<string | undefined> = []
    const toasts: string[] = []
    const ifMatch: Array<string | undefined> = []
    const script = [...(options.submitScript ?? [])]
    let saveFails = options.saveFails ?? false
    const saver = createDraftSaver({
      draft: { revision: 1, body: 'Old.', savedAt: '2026-11-03T08:00:00.000Z' },
      initialBody: 'Old.',
      submit: async (input) => {
        saves.push(input)
        return saveFails
          ? { ok: false }
          : { ok: true, revision: (input.revision ?? 0) + 1, savedAt: '2026-11-03T09:00:00.000Z' }
      },
    })
    const client = {
      POST: async (
        _path: string,
        init: { params: { header: Record<string, string> } },
      ): Promise<unknown> => {
        keys.push(init.params.header['idempotency-key'])
        ifMatch.push(init.params.header['if-match']?.replaceAll('"', ''))
        const step = script.shift() ?? 'ok'
        if (step instanceof ApiError) throw step
        return { data: { data: {} }, response: new Response(null, { status: 201 }) }
      },
    } as unknown as KampusClient
    const session = createCommandSession()
    // Pencerenin kullandığı aynı karar fonksiyonu (`submitWriting`); yalnız teslim komutu gerçek
    // `runCommand` ile sahte istemciye bağlanır.
    function submit(body: string) {
      return submitWriting({
        text: body,
        hadConflict: saver.hasConflict(),
        flush: (text) => saver.flush(text),
        send: (revision, collector) =>
          runCommand(
            session,
            {
              execute: (input, headers) =>
                runRequest(() => submitTaskDraftCommand.request(client, input, headers)),
              version: submitTaskDraftCommand.version,
              messages: submitTaskDraftCommand.messages,
              exclusive: true,
              refresh: async () => {},
            },
            { assignmentId: 'a1', revision },
            routeCommandErrors(
              { setError: collector.setError, notifyError: (message) => toasts.push(message) },
              { fieldFor: writingFieldFor, silent: () => true },
            ),
          ),
      })
    }
    return {
      saver,
      saves,
      keys,
      ifMatch,
      toasts,
      submit,
      setSaveFails: (value: boolean) => (saveFails = value),
    }
  }

  test('başarılı yol: bekleyen metin kaydedilir, kaydedilen revizyon If-Match ile teslim edilir', async () => {
    const t = sheet({})
    const result = await t.submit('New text.')
    assert.deepEqual(t.saves, [{ revision: 1, body: 'New text.' }])
    assert.equal(result.kind, 'done')
    assert.deepEqual(t.ifMatch, ['2'])
    assert.equal(t.keys.length, 1)
  })

  test('kaydedilmiş metin için fazladan kayıt atılmaz; teslim mevcut revizyonu gönderir', async () => {
    const t = sheet({})
    await t.submit('Old.')
    assert.equal(t.saves.length, 0)
    assert.deepEqual(t.ifMatch, ['1'])
  })

  test('kayıt başarısızsa teslim gitmez ve metin kirli kalır: taslak kaybolmaz', async () => {
    const t = sheet({ saveFails: true })
    const result = await t.submit('New text.')
    assert.equal(result.kind, 'not-saved')
    assert.equal(result.kind === 'not-saved' && result.failure.message, DRAFT_NOT_SAVED_TEXT)
    assert.equal(t.keys.length, 0, 'teslim isteği gitmedi')
    assert.equal(t.saver.isDirty('New text.'), true)
    // Bağlantı düzelince aynı metin yeniden kaydedilir ve teslim edilir.
    t.setSaveFails(false)
    const retry = await t.submit('New text.')
    assert.equal(retry.kind, 'done')
    assert.deepEqual(t.ifMatch, ['2'])
  })

  test('ağ hatasında teslim belirsizdir: yeniden denemede aynı Idempotency-Key gider', async () => {
    const t = sheet({ submitScript: [networkError(), 'ok'] })
    const first = await t.submit('New text.')
    assert.equal(first.kind === 'failed' && first.failure.retryable, true)
    const second = await t.submit('New text.')
    assert.equal(second.kind, 'done')
    assert.equal(t.keys.length, 2)
    assert.equal(t.keys[0], t.keys[1])
    // Metin değişmedi: ikinci basış yeni kayıt atmaz, aynı revizyonu gönderir.
    assert.equal(t.saves.length, 1)
    assert.deepEqual(t.ifMatch, ['2', '2'])
  })

  test('aynı revizyonun ikinci teslimi alan hatasıdır; taslak ve sürüm korunur (DOM-BEC-046)', async () => {
    const t = sheet({
      submitScript: ['ok', apiError(409, 'draft_already_submitted', 'Zaten gönderildi')],
    })
    assert.equal((await t.submit('Final text.')).kind, 'done')
    const again = await t.submit('Final text.')
    assert.equal(again.kind, 'failed')
    if (again.kind !== 'failed') return
    assert.equal(again.fieldError, TASK_DRAFT_ALREADY_SUBMITTED_MESSAGE)
    assert.equal(again.failure.message, null)
    assert.equal(again.failure.retryable, false)
    assert.deepEqual(t.toasts, [], 'aynı hata ikinci kez toast olmaz')
    assert.equal(t.saver.isDirty('Final text.'), false)
  })

  test('teslim kapanmışsa mesaj gösterilir ve metin taslakta kalır', async () => {
    const t = sheet({ submitScript: [apiError(409, 'submission_closed')] })
    const result = await t.submit('Late text.')
    assert.equal(
      result.kind === 'failed' && result.failure.message,
      'Bu görevin teslim süresi doldu.',
    )
    assert.equal(t.saver.isDirty('Late text.'), false, 'metin sunucudaki taslakta kayıtlı')
  })

  test('çift dokunma tek teslim isteği atar', async () => {
    const t = sheet({})
    const [first, second] = await Promise.all([t.submit('New text.'), t.submit('New text.')])
    assert.equal(t.keys.length, 1)
    assert.deepEqual([first.kind, second.kind].sort(), ['busy', 'done'])
  })
})

describe('IST-124: taslak yüklenemediğinde ve kapatırken karar', () => {
  const ready = {
    hasAssignment: true,
    hasList: true,
    draftPending: false,
    draftFailed: false,
    waitingDetail: false,
  }

  test('taslak sorgusu düşerse pencere hazır olmaz ve otomatik kayıt kapalı kalır', () => {
    assert.equal(writingSheetReady(ready), true)
    const failed = writingSheetReady({ ...ready, draftFailed: true })
    assert.equal(failed, false)
    assert.equal(autosaveEnabled({ ready: failed, canAct: true, busy: false }), false)
  })

  test('taslak bekleyen, ayrıntı bekleyen ya da eksik görev hazır sayılmaz', () => {
    assert.equal(writingSheetReady({ ...ready, draftPending: true }), false)
    assert.equal(writingSheetReady({ ...ready, waitingDetail: true }), false)
    assert.equal(writingSheetReady({ ...ready, hasAssignment: false }), false)
    assert.equal(writingSheetReady({ ...ready, hasList: false }), false)
  })

  test('otomatik kayıt yalnız hazır, teslim açık ve meşgul değilken çalışır', () => {
    assert.equal(autosaveEnabled({ ready: true, canAct: true, busy: false }), true)
    assert.equal(autosaveEnabled({ ready: true, canAct: false, busy: false }), false)
    assert.equal(autosaveEnabled({ ready: true, canAct: true, busy: true }), false)
  })

  test('kayıt hatasında ya da çakışmada editörden çıkarken onay sorulur', () => {
    assert.equal(closeNeedsConfirm({ editing: true, state: 'error', conflict: false }), true)
    assert.equal(closeNeedsConfirm({ editing: true, state: 'saved', conflict: true }), true)
    assert.equal(closeNeedsConfirm({ editing: true, state: 'saved', conflict: false }), false)
    assert.equal(closeNeedsConfirm({ editing: true, state: 'saving', conflict: false }), false)
    assert.equal(closeNeedsConfirm({ editing: false, state: 'error', conflict: true }), false)
    assert.equal(UNSAVED_CLOSE_TEXT, 'Kaydedilmemiş metin kaybolur. Yine de kapatılsın mı?')
  })
})

describe('IST-124: taslak cihaza yazılmaz, arka planda kaydedilir', () => {
  const sheetSource = readFileSync(
    new URL('../apps/mobile/src/api/screens/writing-sheet.tsx', import.meta.url),
    'utf8',
  )
  const modelSource = readFileSync(
    new URL('../apps/mobile/src/api/student-writing.ts', import.meta.url),
    'utf8',
  )

  test('yazma penceresi ve modeli AsyncStorage kullanmaz (metin yalnız sunucuya kaydedilir)', () => {
    for (const source of [sheetSource, modelSource]) {
      assert.doesNotMatch(source, /AsyncStorage/)
      assert.doesNotMatch(source, /async-storage/)
    }
  })

  test('uygulama arka plana geçerken bekleyen taslak saveNow ile kaydedilir', () => {
    assert.match(sheetSource, /AppState\.addEventListener\('change'/)
    assert.match(sheetSource, /next !== 'active'/)
    assert.match(sheetSource, /control\.current\?\.saveNow\(\)/)
    assert.match(sheetSource, /subscription\.remove\(\)/)
  })

  test('pencere taslak hatasını gösterir, yeniden dener ve kapatmadan önce sorar', () => {
    assert.match(sheetSource, /draftQuery\.refetch\(\)/)
    assert.match(sheetSource, /Alert\.alert\(UNSAVED_CLOSE_TITLE, UNSAVED_CLOSE_TEXT/)
    assert.match(sheetSource, /onClose=\{\(\) => confirmLoss\(onClose\)\}/)
    assert.match(sheetSource, /submitWriting\(/)
  })
})
