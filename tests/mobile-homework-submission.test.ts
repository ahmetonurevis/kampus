import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { ApiError } from '../packages/api-client/src/errors.ts'
import type { FileProcessing } from '../packages/react-shared/src/files.ts'
import {
  canSubmitHomework,
  checkSubmission,
  fitPicked,
  pickedFileKey,
  pickedFileProblem,
  previousItem,
  resolveMimeType,
  submissionAvailability,
  submissionFailureText,
  uploadFailureText,
  uploadIsRetryable,
  type PickedFile,
  type SubmissionItem,
} from '../apps/mobile/src/api/homework-submission.ts'

const now = new Date('2026-11-03T09:00:00.000Z')
const future = '2026-11-10T09:00:00.000Z'
const past = '2026-11-01T09:00:00.000Z'

const file = (name: string, overrides: Partial<PickedFile> = {}): PickedFile => ({
  uri: `file:///cache/${name}`,
  name,
  size: 1024,
  mimeType: 'application/pdf',
  ...overrides,
})
const uploaded = (id: string, scanning = false): SubmissionItem => ({
  key: `k-${id}`,
  name: `${id}.pdf`,
  file: file(`${id}.pdf`),
  state: 'uploaded',
  fileId: id,
  scanning,
  message: null,
})
const apiError = (status: number, code: string, message = '') =>
  new ApiError({ status, code, message })

describe('OG-061 mobil ödev teslimi (IST-124, DOM-AKD-072)', () => {
  test('DOM-AKD-072 teslim son tarihten önce açık, sonra yalnız geç teslime açıksa geç', () => {
    const due = (dueDate: string, allowLate: boolean) =>
      submissionAvailability({ dueDate, allowLate }, undefined, now)
    assert.equal(due(future, false), 'open')
    assert.equal(due(past, true), 'late')
    assert.equal(due(past, false), 'closed')
  })

  test('DOM-AKD-072 puanlanmış teslim kilitlidir; puansız teslim yenilenebilir; 0 puandır', () => {
    const open = { dueDate: future, allowLate: true }
    assert.equal(submissionAvailability(open, { score: 80 }, now), 'graded')
    assert.equal(submissionAvailability(open, { score: 0 }, now), 'graded')
    assert.equal(submissionAvailability(open, { score: null }, now), 'open')
    assert.equal(canSubmitHomework('open'), true)
    assert.equal(canSubmitHomework('late'), true)
    assert.equal(canSubmitHomework('closed'), false)
    assert.equal(canSubmitHomework('graded'), false)
  })

  test('DOM-KYN-004 dosya türü bildirilmezse uzantıdan çıkarılır, tanınmayan tür reddedilir', () => {
    assert.equal(resolveMimeType({ name: 'odev.JPG', mimeType: null }), 'image/jpeg')
    assert.equal(
      resolveMimeType({ name: 'a.pdf', mimeType: 'application/pdf; charset=x' }),
      'application/pdf',
    )
    assert.equal(resolveMimeType({ name: 'a.exe', mimeType: null }), null)
    assert.match(
      pickedFileProblem(file('a.exe', { mimeType: 'application/x-msdownload' })) ?? '',
      /a\.exe/,
    )
    assert.equal(pickedFileProblem(file('a.pdf')), null)
  })

  test('DOM-KYN-004 boyut sınırı (20 MB) ve boş dosya yüklemeden önce elenir', () => {
    assert.match(pickedFileProblem(file('b.pdf', { size: 21 * 1024 * 1024 })) ?? '', /20 MB/)
    assert.equal(pickedFileProblem(file('b.pdf', { size: 20 * 1024 * 1024 })), null)
    assert.match(pickedFileProblem(file('b.pdf', { size: 0 })) ?? '', /boş/)
    // Boyut bildirilmediyse karar sunucudadır.
    assert.equal(pickedFileProblem(file('b.pdf', { size: null })), null)
  })

  test('DOM-AKD-072 seçim en çok 5 dosyaya sığdırılır, yinelenen ve geçersiz dosya atlanır', () => {
    const current = [uploaded('1'), uploaded('2'), uploaded('3')]
    const picked = [
      file('yeni.pdf'),
      file('yeni.pdf'),
      file('kotu.exe', { mimeType: null }),
      file('c.png', { mimeType: 'image/png' }),
      file('d.pdf'),
    ]
    const result = fitPicked(current, picked)
    assert.deepEqual(
      result.accepted.map((item) => item.name),
      ['yeni.pdf', 'c.png'],
    )
    assert.equal(result.problems.length, 3)
    assert.match(result.problems.join(' '), /kotu\.exe/)
    assert.match(result.problems.join(' '), /zaten ekli/)
    assert.match(result.problems.join(' '), /En fazla 5 dosya/)
    // Listede olan dosya yeniden eklenmez.
    const again = fitPicked([{ key: pickedFileKey(file('yeni.pdf')) }], [file('yeni.pdf')])
    assert.deepEqual(again.accepted, [])
  })

  test('DOM-AKD-072 teslim en az bir dosya ister; gövdede boş açıklama gönderilmez', () => {
    const scan = new Map<string, FileProcessing>()
    assert.equal(checkSubmission({ note: 'metin', items: [], scan }).ok, false)
    const ok = checkSubmission({ note: '  ', items: [uploaded('1'), uploaded('2')], scan })
    assert.deepEqual(ok, { ok: true, body: { fileIds: ['1', '2'] } })
    const withNote = checkSubmission({ note: ' tamam ', items: [uploaded('1')], scan })
    assert.deepEqual(withNote, { ok: true, body: { note: 'tamam', fileIds: ['1'] } })
  })

  test('DOM-AKD-072 yükleme sürerken ya da yarım kalmışken teslim oluşmaz', () => {
    const scan = new Map<string, FileProcessing>()
    for (const state of ['queued', 'uploading', 'failed'] as const) {
      const pending: SubmissionItem = { ...uploaded('9'), state, fileId: null }
      const result = checkSubmission({ note: '', items: [uploaded('1'), pending], scan })
      assert.equal(result.ok, false, state)
    }
  })

  test('DOM-KYN-004 güvenlik taraması bitmemiş ya da reddedilmiş dosya teslimi engeller', () => {
    const items = [uploaded('1', true)]
    const check = (state: FileProcessing) =>
      checkSubmission({ note: '', items, scan: new Map([['1', state]]) }).ok
    for (const state of ['processing', 'timed_out', 'rejected', 'missing'] as const)
      assert.equal(check(state), false, state)
    for (const state of ['ready', 'pending', 'failed'] as const)
      assert.equal(check(state), true, state)
  })

  test('DOM-AKD-072 yeniden teslimde önceki dosyalar listede gelir ve gönderilir', () => {
    const items = [previousItem('eski-1'), uploaded('yeni')]
    const result = checkSubmission({ note: '', items, scan: new Map() })
    assert.deepEqual(result, { ok: true, body: { fileIds: ['eski-1', 'yeni'] } })
  })

  test('DOM-AKD-072 açıklama sınırı aşılırsa Türkçe ileti verilir', () => {
    const result = checkSubmission({
      note: 'a'.repeat(4001),
      items: [uploaded('1')],
      scan: new Map(),
    })
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.message, /4000/)
  })

  test('hata eşleme: kod Türkçe metne, teknik ayrıntı genel mesaja döner', () => {
    assert.match(
      submissionFailureText(apiError(422, 'homework_closed', 'x')),
      /teslim süresi doldu/,
    )
    assert.match(submissionFailureText(apiError(409, 'submission_graded', 'x')), /değerlendirildi/)
    assert.match(
      submissionFailureText(apiError(422, 'file_rejected', 'x')),
      /güvenlik taramasından geçmedi/,
    )
    assert.match(submissionFailureText(apiError(401, 'unauthenticated', 'x')), /Oturumun/)
    assert.match(submissionFailureText(apiError(500, 'boom')), /Teslim gönderilemedi/)
    assert.match(uploadFailureText(apiError(413, 'file_too_large', 'x')), /20 MB/)
    assert.match(uploadFailureText(apiError(0, 'network_error')), /Dosya yüklenemedi/)
  })

  test('belirsiz yükleme hatası (ağ, 5xx) yeniden denenebilir; kesin ret denenmez', () => {
    assert.equal(uploadIsRetryable(apiError(0, 'network_error')), true)
    assert.equal(uploadIsRetryable(apiError(503, 'x')), true)
    assert.equal(uploadIsRetryable(apiError(422, 'file_type_not_allowed')), false)
  })
})
