import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { ApiError } from '@kampus/api-client/errors.ts'
import type { FileUploadInput, UploadedFile } from '@kampus/react-shared/use-file-upload.ts'
import { checkFileBeforeUpload, fileIdentity } from '@kampus/react-shared/use-file-upload.ts'
import { createCommandSession, runCommand } from '@kampus/react-shared/commands.ts'

import {
  acceptFor,
  attemptFrom,
  defaultMaxFiles,
  fitFiles,
  fieldError,
  isUploadBusy,
  pickProblems,
  runUploadQueue,
  scanAnnouncement,
  scanRowView,
  scanWatchIds,
  type FileUploadItem,
  type UploadAttempt,
} from '../src/components/file-upload-model.ts'

// OG-224 (DOM-KYN-004, ADR 0003 karar 3): dosya yükleme alanının saf mantığı.

const pdf = (name: string, lastModified = 1) =>
  new File([`%PDF-1.7 ${name}`], name, { type: 'application/pdf', lastModified })

const stored = (id: string, originalName: string | null = null) =>
  ({ id, originalName }) as unknown as UploadedFile

const networkError = new ApiError({ status: 0, code: 'network_error', message: 'Bağlantı yok.' })
const tooLarge = new ApiError({ status: 413, code: 'file_too_large', message: 'Dosya büyük.' })

/** Sahte yükleme: dosya adına göre sıradaki sonuç verilir, her çağrı kaydedilir. */
function fakeUpload(plan: Record<string, UploadAttempt[]>) {
  const calls: string[] = []
  return {
    calls,
    upload: async (file: File): Promise<UploadAttempt> => {
      calls.push(file.name)
      return plan[file.name]?.shift() ?? { kind: 'uploaded', file: stored(`id-${file.name}`) }
    },
  }
}

function queueInput(
  queue: File[],
  upload: (file: File) => Promise<UploadAttempt>,
  signal = new AbortController().signal,
) {
  const list: FileUploadItem[] = []
  return {
    list,
    input: {
      queue,
      signal,
      upload,
      current: () => list,
      onUploaded: (item: FileUploadItem) => void list.push(item),
    },
  }
}

describe('amaçtan accept ve sınır', () => {
  test('accept çekirdek tür tablosundan türer; tek dosyada sınır 1', () => {
    assert.equal(
      acceptFor('submission'),
      'application/pdf,image/jpeg,image/png,image/webp,application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )
    assert.equal(acceptFor('question_image'), 'image/jpeg,image/png,image/webp')
    assert.equal(defaultMaxFiles('submission', false), 1)
    assert.equal(defaultMaxFiles('submission', true), 10)
    assert.equal(defaultMaxFiles('material', true), 10)
  })
})

describe('seçimin sığdırılması (DOM-AKD-072)', () => {
  const file = (id: string) => ({ id, name: `${id}.pdf` })

  test('kalan yere sığanlar alınır, fazlası sayılır', () => {
    const result = fitFiles([file('a'), file('b'), file('c')], ['d', 'e', 'f', 'g'], 5)
    assert.deepEqual(result.accepted, ['d', 'e'])
    assert.equal(result.dropped, 2)
  })

  test('aynı dosya iki kez seçilirse bir kez alınır ve sığmayan sayılmaz', () => {
    const result = fitFiles([], ['x', 'y', 'x', 'y', 'x'], 5)
    assert.deepEqual(result.accepted, ['x', 'y'])
    assert.equal(result.dropped, 0)
    assert.equal(result.duplicates, 3)
  })

  test('zaten eklenmiş dosya yeniden seçilirse yüklenmeden atlanır (anahtarına göre)', () => {
    const current = [
      { id: 'a', name: 'a.pdf', key: 'a.pdf|1' },
      { id: 'b', name: 'b.pdf' },
    ]
    const result = fitFiles(current, ['a.pdf|1', 'c.pdf|1'], 5)
    assert.deepEqual(result.accepted, ['c.pdf|1'])
    assert.equal(result.duplicates, 1)
    assert.equal(result.dropped, 0)
  })

  test('kimlik işlevi: aynı ad, boyut ve tarihli dosya yinelenir sayılır', () => {
    const items = [
      { name: 'a.pdf', size: 1 },
      { name: 'a.pdf', size: 1 },
      { name: 'a.pdf', size: 2 },
    ]
    const result = fitFiles([], items, 5, (item) => `${item.name}|${item.size}`)
    assert.equal(result.accepted.length, 2)
  })

  test('tek dosya alanında ikinci dosya sığmaz', () => {
    const result = fitFiles([file('a')], ['b'], 1)
    assert.deepEqual(result, { accepted: [], dropped: 1, duplicates: 0 })
  })

  test('uyarılar tek iletide birleşir; uyarı yoksa null', () => {
    assert.equal(pickProblems([], { dropped: 0, duplicates: 0 }, 5), null)
    assert.equal(
      pickProblems(['a.pdf: Dosya en fazla 20 MB olabilir.'], { dropped: 1, duplicates: 2 }, 5),
      'a.pdf: Dosya en fazla 20 MB olabilir. 2 dosya zaten ekli olduğu için atlandı. En fazla 5 dosya ekleyebilirsiniz; 1 dosya eklenmedi.',
    )
  })
})

describe('yükleme öncesi ret: istek atılmaz (DOM-KYN-004)', () => {
  const exe = new File(['x'], 'kurulum.exe', { type: 'application/x-msdownload' })
  const big = new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'buyuk.png', { type: 'image/png' })
  const ok = new File(['png'], 'iyi.png', { type: 'image/png' })

  test('uymayan tür ve boyut Türkçe ileti verir; tanınmayan tür sunucuya kalır', () => {
    assert.match(
      checkFileBeforeUpload('question_image', pdf('belge.pdf')) ?? '',
      /Soru görseli için bu dosya türü kabul edilmez/,
    )
    assert.match(checkFileBeforeUpload('question_image', big) ?? '', /en fazla 2 MB/)
    assert.equal(checkFileBeforeUpload('question_image', exe), null)
    assert.equal(checkFileBeforeUpload('question_image', ok), null)
  })

  test('reddedilen dosya isteğe çıkmaz; ileti dosya adıyla alan uyarısı olur, uyan dosya yüklenir', async () => {
    const requests: string[] = []
    const { input, list } = queueInput([pdf('belge.pdf'), big, ok], async (file) => {
      const problem = checkFileBeforeUpload('question_image', file)
      if (problem !== null) return { kind: 'rejected', message: problem }
      requests.push(file.name)
      return { kind: 'uploaded', file: stored('x') }
    })
    const result = await runUploadQueue(input)
    assert.deepEqual(result.problems, [
      'belge.pdf: Soru görseli için bu dosya türü kabul edilmez.',
      'buyuk.png: Dosya en fazla 2 MB olabilir.',
    ])
    assert.deepEqual(requests, ['iyi.png'])
    assert.equal(list.length, 1)
    assert.equal(result.retry.length, 0)
  })
})

describe('başarı ve geri çağrı', () => {
  test('yüklenen dosya sunucudaki adıyla (yoksa yerel adıyla) ve yerel anahtarıyla bildirilir', async () => {
    const a = pdf('a.pdf')
    const b = pdf('b.pdf')
    const { upload } = fakeUpload({
      'a.pdf': [{ kind: 'uploaded', file: stored('f1', 'Sunucu adı.pdf') }],
    })
    const { input, list } = queueInput([a, b], upload)
    const result = await runUploadQueue(input)
    assert.deepEqual(list, [
      { id: 'f1', name: 'Sunucu adı.pdf', key: fileIdentity(a) },
      { id: 'id-b.pdf', name: 'b.pdf', key: fileIdentity(b) },
    ])
    assert.deepEqual(result, { problems: [], retry: [], aborted: false })
  })

  test('sunucu listedeki kaydı döndürürse dosya yeniden eklenmez', async () => {
    const { upload } = fakeUpload({
      'a.pdf': [{ kind: 'uploaded', file: stored('same') }],
      'b.pdf': [{ kind: 'uploaded', file: stored('same') }],
    })
    const { input, list } = queueInput([pdf('a.pdf'), pdf('b.pdf')], upload)
    const result = await runUploadQueue(input)
    assert.equal(list.length, 1)
    assert.deepEqual(result.problems, ['b.pdf: bu dosya zaten ekli.'])
  })

  test('kesin sunucu reddi (4xx) dosyayı atlar ve kalanı yükler', async () => {
    const { upload, calls } = fakeUpload({ 'a.pdf': [{ kind: 'failed', retryable: false }] })
    const { input, list } = queueInput([pdf('a.pdf'), pdf('b.pdf')], upload)
    const result = await runUploadQueue(input)
    assert.deepEqual(calls, ['a.pdf', 'b.pdf'])
    assert.deepEqual(
      list.map((item) => item.id),
      ['id-b.pdf'],
    )
    assert.equal(result.retry.length, 0)
  })
})

describe('belirsiz hata ve yeniden deneme: aynı anahtar (DOM-KYN-004)', () => {
  test('ağ hatasında kuyruk durur; başarısız dosya ve kalan yeniden denemeye kalır', async () => {
    const { upload, calls } = fakeUpload({ 'b.pdf': [{ kind: 'failed', retryable: true }] })
    const files = [pdf('a.pdf'), pdf('b.pdf'), pdf('c.pdf')]
    const { input, list } = queueInput(files, upload)
    const first = await runUploadQueue(input)
    assert.deepEqual(calls, ['a.pdf', 'b.pdf'])
    assert.deepEqual(
      first.retry.map((file) => file.name),
      ['b.pdf', 'c.pdf'],
    )
    assert.equal(list.length, 1)

    const again = await runUploadQueue({ ...input, queue: first.retry })
    assert.deepEqual(calls, ['a.pdf', 'b.pdf', 'b.pdf', 'c.pdf'])
    assert.deepEqual(
      list.map((item) => item.id),
      ['id-a.pdf', 'id-b.pdf', 'id-c.pdf'],
    )
    assert.equal(again.retry.length, 0)
  })

  test('yeniden deneme aynı Idempotency-Key ile gider; kesin hatadan sonra yeni anahtar alır', async () => {
    const session = createCommandSession(
      (
        (n) => () =>
          `anahtar-${(n += 1)}`
      )(0),
    )
    const keys: string[] = []
    const send = (file: File, fail: ApiError | null) => {
      // Gerçek kanca her çağrıda yeni `AbortSignal` ile aynı dosyayı gönderir; anahtar yalnız
      // `fileKey`e bağlı kalmalıdır (signal ve gövde anahtarı değiştirmez).
      const input: FileUploadInput = {
        purpose: 'submission',
        file,
        fileKey: fileIdentity(file),
        signal: new AbortController().signal,
      }
      return runCommand(
        session,
        {
          execute: async (_input: FileUploadInput, headers) => {
            keys.push(headers['idempotency-key'])
            if (fail) throw fail
            return { data: stored('ok') }
          },
          refresh: async () => {},
        },
        input,
      )
    }
    const a = pdf('a.pdf')
    assert.equal((await send(a, networkError)).status, 'failed')
    assert.equal((await send(a, null)).status, 'success')
    assert.equal(keys[0], keys[1], 'aynı dosya, belirsiz hatadan sonra aynı anahtar')

    assert.equal((await send(a, tooLarge)).status, 'failed')
    await send(a, null)
    assert.notEqual(keys[2], keys[3], 'kesin hatadan sonra yeni anahtar')
    assert.notEqual(keys[1], keys[2], 'başarıdan sonra yeni eylem yeni anahtar')
  })

  test('sonuç türleri kullanıcıya dönük denemeye çevrilir', () => {
    assert.deepEqual(attemptFrom({ ok: false, message: 'Uygun değil.' }), {
      kind: 'rejected',
      message: 'Uygun değil.',
    })
    assert.deepEqual(attemptFrom({ status: 'success', data: { data: stored('f') } }), {
      kind: 'uploaded',
      file: stored('f'),
    })
    assert.deepEqual(attemptFrom({ status: 'busy' }), { kind: 'busy' })
    assert.deepEqual(attemptFrom({ status: 'failed', error: networkError }), {
      kind: 'failed',
      retryable: true,
    })
    assert.deepEqual(attemptFrom({ status: 'failed', error: tooLarge }), {
      kind: 'failed',
      retryable: false,
    })
    assert.deepEqual(
      attemptFrom({
        status: 'failed',
        error: new ApiError({ status: 503, code: 'unavailable', message: 'Meşgul.' }),
      }),
      { kind: 'failed', retryable: true },
    )
  })
})

describe('alan hatası önceliği (DOM-AKD-072)', () => {
  test('sunucudan gelen alan hatası, alanın eski uyarısını geçersiz kılar', () => {
    const stale = '1 dosya zaten ekli olduğu için atlandı.'
    assert.deepEqual(fieldError(stale, { message: 'Dosya henüz hazır değil.' }), {
      message: 'Dosya henüz hazır değil.',
    })
  })

  test('dış hata yoksa alanın kendi uyarısı, ikisi de yoksa hiçbir şey gösterilir', () => {
    assert.deepEqual(fieldError('Uyarı.', undefined), { message: 'Uyarı.' })
    assert.deepEqual(fieldError('Uyarı.', {}), { message: 'Uyarı.' })
    assert.equal(fieldError(null, undefined), undefined)
    assert.deepEqual(fieldError(null, { message: 'Hata.' }), { message: 'Hata.' })
  })
})

describe('iptal', () => {
  test('yükleme sürerken sinyal durursa kuyruk kesilir; dosya listeye eklenmez, yeniden deneme yok', async () => {
    const controller = new AbortController()
    const { calls } = fakeUpload({})
    const { input, list } = queueInput(
      [pdf('a.pdf'), pdf('b.pdf')],
      async (file) => {
        calls.push(file.name)
        controller.abort()
        return { kind: 'uploaded', file: stored('geç') }
      },
      controller.signal,
    )
    const result = await runUploadQueue(input)
    assert.deepEqual(calls, ['a.pdf'])
    assert.equal(list.length, 0)
    assert.deepEqual(result, { problems: [], retry: [], aborted: true })
  })

  test('başlamadan durmuş sinyalle hiç istek atılmaz', async () => {
    const controller = new AbortController()
    controller.abort()
    const { upload, calls } = fakeUpload({})
    const { input } = queueInput([pdf('a.pdf')], upload, controller.signal)
    const result = await runUploadQueue(input)
    assert.equal(calls.length, 0)
    assert.equal(result.aborted, true)
  })
})

describe('Alan meşgul sayılır (OG-250, DOM-KYN-006)', () => {
  test('yükleme sürerken meşguldür', () => {
    assert.equal(isUploadBusy(true, 0), true)
  })

  test('ağ hatasıyla yarım kalan yükleme (yeniden denenecek dosya) bitmiş sayılmaz: kaydet açılmaz', async () => {
    const { upload } = fakeUpload({ 'a.pdf': [{ kind: 'failed', retryable: true }] })
    const { input } = queueInput([pdf('a.pdf')], upload)
    const result = await runUploadQueue(input)
    assert.equal(result.retry.length, 1)
    // Alan `uploading=false`, `retry=result.retry` ile kalır.
    assert.equal(isUploadBusy(false, result.retry.length), true)
  })

  test('yeniden deneme bitince ya da vazgeçilince meşgul değildir', () => {
    assert.equal(isUploadBusy(false, 0), false)
  })
})

describe('Yüklenen dosyanın güvenlik taraması (OG-987, IST-027; ADR 0003 karar 8)', () => {
  test('IST-027: taranan, beklemesi dolan ya da reddedilen dosya gönderimi kilitler', () => {
    assert.equal(isUploadBusy(false, 0, ['processing']), true)
    assert.equal(isUploadBusy(false, 0, ['ready', 'timed_out']), true)
    assert.equal(isUploadBusy(false, 0, ['ready', 'rejected']), true)
  })

  test('IST-027: hazır, tarayıcısız (pending) ve okunamayan dosya kilitlemez', () => {
    assert.equal(isUploadBusy(false, 0, ['ready', 'pending', 'failed']), false)
    assert.equal(isUploadBusy(false, 0, []), false)
  })

  test('IST-027: yalnız bu alanda yüklenip taranan ve hâlâ listede olan dosya izlenir', () => {
    const items: FileUploadItem[] = [
      { id: 'eski', name: 'onceki.pdf' },
      { id: 'b', name: 'b.pdf' },
      { id: 'a', name: 'a.pdf' },
    ]
    assert.deepEqual(scanWatchIds(items, new Set(['a', 'b', 'kaldirildi'])), ['b', 'a'])
    assert.deepEqual(scanWatchIds(items, new Set()), [])
  })

  test('IST-027: satır taranırken "Taranıyor…", süre dolunca yeniden dene, retde Türkçe ileti', () => {
    assert.deepEqual(scanRowView('processing'), {
      text: 'Taranıyor…',
      tone: 'muted',
      retry: false,
    })
    const timedOut = scanRowView('timed_out')
    assert.equal(timedOut?.retry, true)
    assert.match(timedOut?.text ?? '', /güvenlik taramasında, birazdan yeniden deneyin/)
    assert.deepEqual(scanRowView('rejected'), {
      text: 'Dosya güvenlik taramasından geçmedi. Başka bir dosya yükleyin.',
      tone: 'danger',
      retry: false,
    })
    for (const state of ['ready', 'pending', 'failed', undefined] as const)
      assert.equal(scanRowView(state), null)
  })

  test('IST-027: canlı bölge en önemli durumu duyurur', () => {
    assert.equal(scanAnnouncement([]), null)
    assert.match(scanAnnouncement(['ready', 'processing']) ?? '', /taramasında/)
    assert.match(scanAnnouncement(['processing', 'timed_out']) ?? '', /birazdan yeniden deneyin/)
    assert.match(scanAnnouncement(['timed_out', 'rejected']) ?? '', /taramasından geçmedi/)
    assert.equal(scanAnnouncement(['ready', 'ready']), 'Dosya güvenlik taramasından geçti.')
    assert.equal(scanAnnouncement(['ready', 'pending']), null)
  })
})
