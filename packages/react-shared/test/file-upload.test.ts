import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { createKampusClient } from '@kampus/api-client/client.ts'

import { runRequest } from '../src/api-result.ts'
import { commandHeaders, stableFingerprint } from '../src/commands.ts'
import {
  checkFileBeforeUpload,
  fileIdentity,
  fileUploadForm,
  uploadFileRequest,
} from '../src/use-file-upload.ts'

// Dosya yükleme isteği (DOM-KYN-004, ADR 0003 karar 2, 3): çok parçalı gövde, başlıklar, ön denetim.

const MB = 1024 * 1024

interface Sent {
  method: string
  path: string
  headers: Headers
  form: FormData
  signal: AbortSignal
}

/** Gerçek istemci + sahte fetch: giden çok parçalı istek ayrıştırılarak kaydedilir. */
function fakeClient() {
  const sent: Sent[] = []
  const client = createKampusClient({
    baseUrl: 'https://api.kampus.test',
    credentials: 'include',
    requestId: () => undefined,
    fetch: async (input) => {
      const request = input instanceof Request ? input : new Request(input)
      sent.push({
        method: request.method,
        path: new URL(request.url).pathname,
        headers: request.headers,
        form: await request.formData(),
        signal: request.signal,
      })
      return new Response(JSON.stringify({ data: { id: 'file-1' } }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      })
    },
  })
  return { client, sent }
}

const pdf = new File(['%PDF-1.7 test'], 'odev.pdf', { type: 'application/pdf', lastModified: 1 })

describe('dosya yükleme isteği', () => {
  test('DOM-KYN-004 POST /files: önce purpose sonra file; Idempotency-Key var, If-Match yok; JSON türü yazılmaz', async () => {
    const { client, sent } = fakeClient()
    const result = await runRequest(() =>
      uploadFileRequest(
        client,
        { purpose: 'submission', file: pdf, fileKey: fileIdentity(pdf) },
        commandHeaders('anahtar-1', 3),
      ),
    )
    assert.equal(result.data.id, 'file-1')
    const request = sent[0]!
    assert.equal(request.method, 'POST')
    assert.equal(request.path, '/api/v1/files')
    assert.equal(request.headers.get('idempotency-key'), 'anahtar-1')
    assert.equal(request.headers.get('if-match'), null)
    assert.match(request.headers.get('content-type') ?? '', /^multipart\/form-data; boundary=/)
    assert.deepEqual(
      [...request.form.keys()],
      ['purpose', 'file'],
      'sunucu purpose alanını dosyadan önce okur',
    )
    assert.equal(request.form.get('purpose'), 'submission')
    const file = request.form.get('file')
    assert.ok(file instanceof File)
    assert.equal(file.name, 'odev.pdf')
    assert.equal(await file.text(), '%PDF-1.7 test')
  })

  test('OG-047 signal verilirse istek o sinyali taşır (panel kapanınca yükleme durur)', async () => {
    const { client, sent } = fakeClient()
    const controller = new AbortController()
    const input = {
      purpose: 'submission' as const,
      file: pdf,
      fileKey: 'k',
      signal: controller.signal,
    }
    await runRequest(() => uploadFileRequest(client, input, commandHeaders('a-1', null)))
    assert.equal(sent[0]!.signal.aborted, false)
    controller.abort()
    assert.equal(sent[0]!.signal.aborted, true, 'istek sinyale bağlı: abort isteği düşürür')
  })

  test('fileUploadForm alan sırasını korur', () => {
    const form = fileUploadForm({ purpose: 'document', file: pdf, fileKey: 'k' })
    assert.deepEqual([...form.keys()], ['purpose', 'file'])
  })

  test('parmak izi dosyaya göre ayrışır: aynı dosya aynı, farklı dosya farklı anahtar alır', () => {
    const other = new File(['%PDF-1.7 başka'], 'odev.pdf', {
      type: 'application/pdf',
      lastModified: 1,
    })
    const input = (file: File) => ({ purpose: 'submission', file, fileKey: fileIdentity(file) })
    assert.equal(stableFingerprint(input(pdf)), stableFingerprint(input(pdf)))
    assert.notEqual(stableFingerprint(input(pdf)), stableFingerprint(input(other)))
    assert.equal(fileIdentity(new Blob(['ab'], { type: 'text/plain' })), '|2|0|text/plain')
  })
})

describe('yüklemeden önce amaç kuralı (ADR 0003 karar 3)', () => {
  test('uyan dosya geçer; tür ve boyut reddi Türkçe iletiyle döner', () => {
    assert.equal(checkFileBeforeUpload('submission', pdf), null)
    assert.match(
      checkFileBeforeUpload('question_image', pdf) ?? '',
      /Soru görseli için bu dosya türü kabul edilmez/,
    )
    const big = new File([new Uint8Array(2 * MB + 1)], 'buyuk.png', { type: 'image/png' })
    assert.match(checkFileBeforeUpload('question_image', big) ?? '', /en fazla 2 MB/)
  })

  test('tarayıcı türü bildirmezse ya da tür tanınmazsa karar sunucuya kalır', () => {
    const unknown = new File(['x'], 'kayit', { type: '' })
    assert.equal(checkFileBeforeUpload('speaking_recording', unknown), null)
    const octet = new File(['x'], 'kayit.bin', { type: 'application/octet-stream' })
    assert.equal(checkFileBeforeUpload('listening_audio', octet), null)
  })

  test('DOM-KYN-004 takma ad ve parametreli tür kanonik türe çevrilip kabul edilir', () => {
    const cases: [Parameters<typeof checkFileBeforeUpload>[0], string][] = [
      ['listening_audio', 'audio/x-m4a'],
      ['listening_audio', 'audio/x-wav'],
      ['listening_audio', 'audio/mp3'],
      ['listening_audio', 'video/webm'],
      ['listening_audio', 'audio/webm;codecs=opus'],
      ['listening_audio', 'Audio/MPEG'],
      ['question_image', 'image/jpg'],
      ['material', 'audio/x-m4a'],
    ]
    for (const [purpose, type] of cases) {
      const file = new File(['x'], 'dosya', { type })
      assert.equal(checkFileBeforeUpload(purpose, file), null, `${purpose} ${type}`)
    }
    // Takma ad çözülse de amaçta olmayan tür yine reddedilir.
    const jpg = new File(['x'], 'foto.jpg', { type: 'image/jpg' })
    assert.match(checkFileBeforeUpload('document', jpg) ?? '', /bu dosya türü kabul edilmez/)
  })
})
