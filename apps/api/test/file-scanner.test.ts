import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer, type AddressInfo, type Server, type Socket } from 'node:net'
import { Readable } from 'node:stream'
import { after, before, describe, test } from 'node:test'

import {
  createClamavScanner,
  createFileScanner,
  ScannerUnavailableError,
} from '../src/services/file-scanner.ts'
import { testConfig } from './support/app.ts'

/**
 * `clamd` sürücüsü (OG-092; ADR 0003 karar 8). Gerçek `clamd` yerine `INSTREAM` protokolünü
 * konuşan küçük bir TCP sunucusu: istemci `zINSTREAM\0`, ardından uzunluk önekli parçalar ve
 * sıfır uzunlukta bitiş gönderir; sunucu sonucu yazıp bağlantıyı kapatır. Böylece paket
 * bağlantısı, imza adı ayrıştırması, erişilemez sunucu ve süre aşımı clamd'siz sınanır.
 */

type Reply = string | 'hang'

const INSTREAM = Buffer.from('zINSTREAM\0')

/** Gelen akışı ayrıştırır: bitiş parçası geldiyse taranan baytlar, gelmediyse `null`. */
function parseInstream(data: Buffer): Buffer | null {
  if (!data.subarray(0, INSTREAM.length).equals(INSTREAM)) return null
  const chunks: Buffer[] = []
  let offset = INSTREAM.length
  while (offset + 4 <= data.length) {
    const size = data.readUInt32BE(offset)
    offset += 4
    if (size === 0) return Buffer.concat(chunks)
    if (offset + size > data.length) return null
    chunks.push(data.subarray(offset, offset + size))
    offset += size
  }
  return null
}

describe('clamd sürücüsü (clamscan, INSTREAM)', () => {
  let server: Server
  let port: number
  let reply: Reply = 'stream: OK\0'
  const received: Buffer[] = []
  const sockets = new Set<Socket>()

  before(async () => {
    server = createServer((socket) => {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
      let data = Buffer.alloc(0)
      socket.on('data', (chunk: Buffer) => {
        data = Buffer.concat([data, chunk])
        const scanned = parseInstream(data)
        if (scanned === null || reply === 'hang') return
        received.push(scanned)
        socket.end(reply)
      })
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    port = (server.address() as AddressInfo).port
  })
  after(async () => {
    for (const socket of sockets) socket.destroy()
    server.close()
    await once(server, 'close')
  })

  const scanner = (timeoutMs = 5000) => createClamavScanner({ host: '127.0.0.1', port, timeoutMs })
  const input = () => Readable.from([Buffer.from('%PDF-1.4 '), Buffer.from('deneme içerik')])

  test('ADR 0003 karar 8: temiz yanıt temiz sonuç verir; içerik akışla gönderilir', async () => {
    reply = 'stream: OK\0'
    assert.deepEqual(await scanner().scan(input()), { infected: false })
    assert.equal(received.at(-1)?.toString(), '%PDF-1.4 deneme içerik')
  })

  test('ADR 0003 karar 8: FOUND yanıtı zararlıdır ve imza adını taşır (sezgi bulgusu dahil)', async () => {
    for (const signature of ['Eicar-Test-Signature', 'Heuristics.Encrypted.PDF']) {
      reply = `stream: ${signature} FOUND\0`
      assert.deepEqual(await scanner().scan(input()), { infected: true, signature })
    }
  })

  test('ADR 0003 karar 8: clamd hatası (ERROR) temiz sayılmaz, geçici hatadır', async () => {
    reply = 'INSTREAM size limit exceeded. ERROR\0'
    await assert.rejects(scanner().scan(input()), ScannerUnavailableError)
  })

  test('ADR 0003 karar 8: yanıt vermeyen clamd süre sınırında geçici hatayla biter', async () => {
    reply = 'hang'
    try {
      await assert.rejects(scanner(1000).scan(input()), {
        name: 'ScannerUnavailableError',
        message: 'clamd scan timed out',
      })
    } finally {
      reply = 'stream: OK\0'
    }
  })

  test('ADR 0003 karar 8: iptal edilen tarama geçici hatayla biter', async () => {
    reply = 'hang'
    const controller = new AbortController()
    try {
      const pending = scanner().scan(input(), { signal: controller.signal })
      controller.abort()
      await assert.rejects(pending, { message: 'clamd scan aborted' })
    } finally {
      reply = 'stream: OK\0'
    }
  })

  test('ADR 0003 karar 8: erişilemez clamd geçici hatadır', async () => {
    const closed = createServer()
    closed.listen(0, '127.0.0.1')
    await once(closed, 'listening')
    const closedPort = (closed.address() as AddressInfo).port
    closed.close()
    await once(closed, 'close')
    await assert.rejects(
      createClamavScanner({ host: '127.0.0.1', port: closedPort, timeoutMs: 5000 }).scan(input()),
      { code: 'scanner_unavailable' },
    )
  })

  test('FILE_SCANNER: off tarayıcı kurmaz, clamav sürücü kurar', () => {
    assert.equal(createFileScanner(testConfig()), null)
    assert.notEqual(createFileScanner(testConfig({ FILE_SCANNER: 'clamav' })), null)
  })
})
