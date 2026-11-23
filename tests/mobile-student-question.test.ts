import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { ApiError, ROOT_FIELD } from '../packages/api-client/src/errors.ts'
import type { KampusClient } from '../packages/api-client/src/client.ts'
import { runRequest } from '../packages/react-shared/src/api-result.ts'
import { createCommandSession, runCommand } from '../packages/react-shared/src/commands.ts'
import { QUESTION_CHANGED_MESSAGE } from '../packages/react-shared/src/use-question-commands.ts'
import { askQuestionRequest } from '../packages/react-shared/src/use-question-commands.ts'
import type { AskOption } from '../packages/react-shared/src/question-model.ts'
import {
  ASK_DONE_TEXT,
  EMPTY_ASK,
  PHOTO_NOTE,
  QUESTION_GROUP_OPTIONS,
  askServerFailure,
  checkAsk,
  isQuestionGroup,
  questionBadgeTone,
  questionEmptyText,
  questionErrorView,
  questionGroupCounts,
  questionLookups,
  studentQuestionRows,
  visibleQuestionRows,
  withdrawFailure,
} from '../apps/mobile/src/api/student-question.ts'
import {
  commandFailure,
  createFieldCollector,
  isRetryableFailure,
} from '../apps/mobile/src/api/command-failure.ts'

const apiError = (status: number, code: string, message = 'Sunucu mesajı') =>
  new ApiError({ status, code, message })
const networkError = () => apiError(0, 'network_error')

const lookups = questionLookups(
  [
    { id: 'math', record: { name: 'Matematik' } },
    { id: 'fen', record: { name: 'Fen Bilimleri' } },
  ],
  [
    { id: 't1', record: { name: 'Selin Kaya' } },
    { id: 't2', record: { name: 'Ali Demir' } },
  ],
)

type Item = Parameters<typeof studentQuestionRows>[0][number]

const item = (id: string, createdAt: string, extra: Record<string, unknown> = {}): Item =>
  ({
    id,
    version: 2,
    createdAt,
    updatedAt: createdAt,
    archivedAt: null,
    record: {
      id,
      studentId: 's1',
      teacherId: 't1',
      subjectId: 'math',
      title: `Soru ${id}`,
      text: 'Üçgenin alanı nasıl bulunur?',
      createdAt,
      answeredAt: null,
      answer: '',
      fileName: null,
      ...extra,
    },
  }) as unknown as Item

const ITEMS: Item[] = [
  item('eski', '2026-10-10T09:00:00.000Z'),
  item('yanitli', '2026-10-12T09:00:00.000Z', {
    teacherId: 't2',
    subjectId: 'fen',
    title: 'Hücre',
    answeredAt: '2026-10-13T09:00:00.000Z',
    answer: 'Mitokondri enerji üretir.',
  }),
  item('yeni', '2026-10-14T09:00:00.000Z', { withdrawnAt: '2026-10-14T10:00:00.000Z' }),
]

const options: AskOption[] = [
  {
    subjectId: 'math',
    subject: 'Matematik',
    teachers: [{ id: 't1', name: 'Selin Kaya' }],
    topics: ['Üçgenler'],
  },
  {
    subjectId: 'fen',
    subject: 'Fen Bilimleri',
    teachers: [
      { id: 't1', name: 'Selin Kaya' },
      { id: 't2', name: 'Ali Demir' },
    ],
    topics: [],
  },
]

const valid = {
  ...EMPTY_ASK,
  subjectId: 'math',
  title: 'Üçgenler',
  text: 'Üçgenin alanı nasıl bulunur, anlamadım.',
}

describe('IST-124 mobil öğrenci soru modeli (DOM-ILT-090, DOM-ILT-091, DOM-ILT-093)', () => {
  test('DOM-ILT-093 satırlar yeniden eskiye gelir ve durum kayıttan hesaplanır', () => {
    const rows = studentQuestionRows(ITEMS, lookups)
    assert.equal(rows.length, 3)
    assert.deepEqual(rows.map((row) => row.id).sort(), ['eski', 'yanitli', 'yeni'])
    const byId = new Map(rows.map((row) => [row.id, row]))
    assert.equal(byId.get('eski')?.state, 'pending')
    assert.equal(byId.get('yanitli')?.state, 'answered')
    assert.equal(byId.get('yeni')?.state, 'withdrawn')
    assert.equal(byId.get('yanitli')?.teacher, 'Ali Demir')
    assert.equal(byId.get('yanitli')?.subject, 'Fen Bilimleri')
  })

  test('DOM-ILT-093 durum sekmeleri sayımları ve süzgeci verir', () => {
    const rows = studentQuestionRows(ITEMS, lookups)
    assert.deepEqual(questionGroupCounts(rows), { pending: 1, answered: 1, withdrawn: 1 })
    assert.deepEqual(
      QUESTION_GROUP_OPTIONS.map((option) => option.value),
      ['', 'pending', 'answered', 'withdrawn'],
    )
    assert.equal(isQuestionGroup('answered'), true)
    assert.equal(isQuestionGroup(''), false)
    assert.equal(isQuestionGroup('bilinmeyen'), false)
    assert.deepEqual(
      visibleQuestionRows(rows, 'answered', '').map((row) => row.id),
      ['yanitli'],
    )
    assert.equal(visibleQuestionRows(rows, '', '').length, 3)
    // Bilinmeyen süzgeç değeri tümünü gösterir; sekme ile arama birlikte uygulanır.
    assert.equal(visibleQuestionRows(rows, 'bilinmeyen', '').length, 3)
    assert.equal(visibleQuestionRows(rows, 'pending', 'mitokondri').length, 0)
  })

  test('DOM-ILT-091 arama başlık, ders, öğretmen ve yanıtta büyük/küçük harf ve Türkçe karakter gözetmez', () => {
    const rows = studentQuestionRows(ITEMS, lookups)
    assert.deepEqual(
      visibleQuestionRows(rows, '', 'MİTOKONDRİ').map((row) => row.id),
      ['yanitli'],
    )
    assert.deepEqual(
      visibleQuestionRows(rows, '', 'hücre').map((row) => row.id),
      ['yanitli'],
    )
    assert.equal(visibleQuestionRows(rows, '', 'ali demir').length, 1)
    assert.equal(visibleQuestionRows(rows, '', 'selin kaya').length, 2)
    assert.equal(visibleQuestionRows(rows, '', 'yok böyle bir şey').length, 0)
  })

  test('DOM-ILT-093 boş durum metni sekmeye göre değişir; rozet tonu ve hata görünümü', () => {
    assert.equal(questionEmptyText('').title, 'Henüz soru sormadın')
    assert.equal(questionEmptyText('pending').title, 'Yanıt bekleyen soru yok')
    assert.equal(questionEmptyText('answered').title, 'Yanıtlanan soru yok')
    assert.equal(questionEmptyText('withdrawn').title, 'Geri çekilen soru yok')
    assert.equal(questionBadgeTone('answered'), 'green')
    assert.equal(questionBadgeTone('pending'), 'amber')
    assert.equal(questionBadgeTone('withdrawn'), 'primary')
    assert.equal(questionErrorView(null, false), 'none')
    assert.equal(questionErrorView(networkError(), true), 'inline')
    assert.equal(questionErrorView(networkError(), false), 'full')
    assert.match(PHOTO_NOTE, /web sürümünden/)
    assert.match(ASK_DONE_TEXT, /öğretmenine iletildi/)
  })

  test('DOM-ILT-090 geçerli form gövdeye dönüşür; tek öğretmen kendiliğinden seçilir, metin kırpılır', () => {
    const check = checkAsk({ ...valid, title: '  Üçgenler  ' }, options)
    assert.equal(check.ok, true)
    if (!check.ok) return
    assert.equal(check.body.subjectId, 'math')
    assert.equal(check.body.teacherId, 't1')
    assert.equal(check.body.title, 'Üçgenler')
    assert.equal('topic' in check.body, false)
    const withTopic = checkAsk({ ...valid, topic: 'Üçgenler' }, options)
    assert.equal(withTopic.ok && withTopic.body.topic, 'Üçgenler')
  })

  test('DOM-ILT-090 boş form alan alan Türkçe hata verir; istek atılmaz', () => {
    const check = checkAsk(EMPTY_ASK, options)
    assert.equal(check.ok, false)
    if (check.ok) return
    assert.equal(check.errors.subjectId, 'Bir ders seçin.')
    assert.equal(check.errors.title, 'Konu başlığını yazın.')
    assert.equal(check.errors.text, 'Sorunuzu en az 10 karakterle açıklayın.')
  })

  test('DOM-ILT-090 başlık ve metin sınırları, kapsam dışı ders ve kazanım reddedilir', () => {
    const long = checkAsk({ ...valid, title: 'x'.repeat(121), text: 'y'.repeat(2001) }, options)
    assert.equal(long.ok, false)
    if (!long.ok) {
      assert.equal(long.errors.title, 'Konu başlığı en fazla 120 karakter olabilir.')
      assert.equal(long.errors.text, 'En fazla 2000 karakter yazabilirsiniz.')
    }
    const outside = checkAsk({ ...valid, subjectId: 'olmayan' }, options)
    assert.equal(outside.ok === false && outside.errors.subjectId, 'Bir ders seçin.')
    const topic = checkAsk({ ...valid, topic: 'Başka dersin kazanımı' }, options)
    assert.equal(topic.ok === false && topic.errors.topic, 'Kazanım bu derse ait değil.')
    // Ortak ders: öğretmen seçilmeden gönderilmez, seçilen öğretmen gövdeye girer.
    const shared = { ...valid, subjectId: 'fen' }
    const none = checkAsk(shared, options)
    assert.equal(none.ok, false)
    const chosen = checkAsk({ ...shared, teacherId: 't2' }, options)
    assert.equal(chosen.ok && chosen.body.teacherId, 't2')
  })

  test('DOM-ILT-090 sunucu alan hataları formdaki alana, bilinmeyenler genel mesaja düşer', () => {
    const collector = createFieldCollector()
    collector.setError('title', { type: 'too_big', message: 'Başlık çok uzun.' })
    collector.setError('title', { type: 'x', message: 'İkinci madde yok sayılır.' })
    collector.setError('fileIds', { type: 'x', message: 'Fotoğraf sorunu.' })
    const failure = askServerFailure(
      apiError(400, 'validation_error', 'Geçersiz istek'),
      collector.fields,
    )
    assert.deepEqual(failure.errors, { title: 'Başlık çok uzun.' })
    assert.equal(failure.message, 'Fotoğraf sorunu.')
    assert.equal(failure.retryable, false)
  })

  test('DOM-ILT-090 alan maddesi yoksa sunucunun Türkçe mesajı genel mesajdır; ağ ve 5xx yeniden denenir', () => {
    const rejected = askServerFailure(apiError(422, 'invalid', 'Bu ders için öğretmen yok.'), {})
    assert.equal(rejected.message, 'Bu ders için öğretmen yok.')
    assert.deepEqual(rejected.errors, {})
    assert.equal(rejected.retryable, false)
    assert.equal(askServerFailure(networkError(), {}).retryable, true)
    assert.equal(askServerFailure(apiError(503, 'unavailable'), {}).retryable, true)
  })

  test('DOM-ILT-091 geri çekmede sürüm çakışması Türkçe mesaj verir, ağ hatası yeniden denenir', () => {
    const conflict = withdrawFailure(apiError(409, 'version_conflict', 'Version mismatch'))
    assert.equal(conflict.message, QUESTION_CHANGED_MESSAGE)
    assert.equal(conflict.retryable, false)
    assert.equal(withdrawFailure(networkError()).retryable, true)
    assert.equal(withdrawFailure(apiError(500, 'internal')).retryable, true)
  })
})

describe('IST-124 komut hata görünümü', () => {
  test('alan toplayıcı ilk maddeyi tutar', () => {
    const collector = createFieldCollector()
    collector.setError('a', { type: 't', message: 'Birinci' })
    collector.setError('a', { type: 't', message: 'İkinci' })
    collector.setError('b', { type: 't', message: 'Üçüncü' })
    assert.deepEqual(collector.fields, { a: 'Birinci', b: 'Üçüncü' })
  })

  test('genel mesaj alan maddesi yokken gelir; kök mesaj varsa kök kullanılır', () => {
    assert.equal(commandFailure(apiError(409, 'x', 'Çakıştı.')).message, 'Çakıştı.')
    assert.equal(
      commandFailure(apiError(400, 'x', 'Geçersiz'), {}, { a: 'Alan hatası' }).message,
      null,
    )
    assert.equal(
      commandFailure(apiError(400, 'x', 'Geçersiz'), {}, { a: 'Alan', [ROOT_FIELD]: 'Kök mesaj' })
        .message,
      'Kök mesaj',
    )
    assert.equal(
      commandFailure(apiError(409, 'sozluk', 'Sunucu'), { sozluk: 'Sözlük mesajı' }).message,
      'Sözlük mesajı',
    )
  })

  test('yeniden denenebilirlik: yalnız ağ ve 5xx', () => {
    assert.equal(isRetryableFailure(networkError()), true)
    assert.equal(isRetryableFailure(apiError(502, 'x')), true)
    assert.equal(isRetryableFailure(apiError(409, 'x')), false)
    assert.equal(isRetryableFailure(apiError(422, 'x')), false)
    assert.equal(isRetryableFailure(apiError(429, 'x')), false)
  })
})

describe('IST-124 soru gönderim komutu (çift gönderim ve Idempotency-Key)', () => {
  function fakeAskServer(script: Array<'ok' | ApiError>) {
    const keys: string[] = []
    const client = {
      POST: async (
        _path: string,
        options: { params: { header: { 'idempotency-key': string } } },
      ) => {
        keys.push(options.params.header['idempotency-key'])
        const step = script.shift() ?? 'ok'
        if (step instanceof ApiError) throw step
        return { data: { data: {} }, response: new Response(null, { status: 201 }) }
      },
    } as unknown as KampusClient
    const send = (session: ReturnType<typeof createCommandSession>) => {
      const body = checkAsk(valid, options)
      assert.ok(body.ok)
      return runCommand(
        session,
        {
          execute: (input, headers) => runRequest(() => askQuestionRequest(client, input, headers)),
          refresh: async () => {},
        },
        body.body,
      )
    }
    return { keys, send }
  }

  test('çift dokunma tek istek atar', async () => {
    const server = fakeAskServer(['ok'])
    const session = createCommandSession()
    const [a, b] = await Promise.all([server.send(session), server.send(session)])
    assert.deepEqual([a.status, b.status].sort(), ['busy', 'success'])
    assert.equal(server.keys.length, 1)
  })

  test('ağ hatasından sonra "Yeniden dene" aynı anahtarla gider', async () => {
    const server = fakeAskServer([networkError(), apiError(503, 'unavailable'), 'ok'])
    const session = createCommandSession()
    assert.equal((await server.send(session)).status, 'failed')
    assert.equal((await server.send(session)).status, 'failed')
    assert.equal((await server.send(session)).status, 'success')
    assert.equal(new Set(server.keys).size, 1)
  })
})
