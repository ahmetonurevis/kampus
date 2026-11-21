import assert from 'node:assert/strict'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { createServer, type AddressInfo, type Server, type Socket } from 'node:net'
import { Readable } from 'node:stream'
import { setTimeout as delay } from 'node:timers/promises'
import { after, before, describe, test } from 'node:test'

import {
  createClamavScanner,
  createFileScanner,
  INSTREAM_CHUNK_BYTES,
  parseClamdReply,
  ScanLimitExceededError,
  ScannerUnavailableError,
} from '../src/services/file-scanner.ts'
import { MAX_UPLOAD_BYTES } from '../src/services/files.ts'
import { testConfig } from './support/app.ts'

/**
 * Kendi `clamd` INSTREAM istemcimiz (OG-092; ADR 0003 karar 8, Sabah kararı 41). Gerçek `clamd`
 * yerine protokolü konuşan küçük bir `net.createServer`: istemci `zINSTREAM\0`, ardından 4 bayt
 * big-endian uzunluk önekli parçalar ve 4 bayt sıfır bitiş gönderir; sunucu davranışı teste göre
 * değişir (yanıt, yarım yanıt, susma, okumayı bekletme, akış ortasında sınır yanıtı).
 */

const INSTREAM = Buffer.from('zINSTREAM\0')

type Frames = { complete: boolean; data: Buffer; sizes: number[]; commandOk: boolean }

/**
 * Gelen akışı parça parça ayrıştırır (büyük akışta her veri olayında baştan ayrıştırmaz): bitiş
 * parçası geldiyse `complete`, parça boyları `sizes`.
 */
class InstreamParser {
  #pending: Buffer = Buffer.alloc(0)
  #command = false
  readonly #chunks: Buffer[] = []
  readonly sizes: number[] = []
  received = 0
  commandOk = false
  complete = false

  push(chunk: Buffer): void {
    this.#pending = this.#pending.length === 0 ? chunk : Buffer.concat([this.#pending, chunk])
    if (!this.#command) {
      if (this.#pending.length < INSTREAM.length) return
      this.commandOk = this.#pending.subarray(0, INSTREAM.length).equals(INSTREAM)
      this.#command = true
      this.#pending = this.#pending.subarray(INSTREAM.length)
    }
    while (this.commandOk && !this.complete && this.#pending.length >= 4) {
      const size = this.#pending.readUInt32BE(0)
      if (size === 0) {
        this.complete = true
        return
      }
      if (this.#pending.length < 4 + size) return
      this.sizes.push(size)
      this.#chunks.push(this.#pending.subarray(4, 4 + size))
      this.received += size
      this.#pending = this.#pending.subarray(4 + size)
    }
  }

  frames(): Frames {
    return {
      complete: this.complete,
      data: Buffer.concat(this.#chunks),
      sizes: this.sizes,
      commandOk: this.commandOk,
    }
  }
}

type Behaviour =
  | { kind: 'reply'; text: string }
  | { kind: 'partial'; text: string }
  | { kind: 'hang' }
  | { kind: 'limit-after'; bytes: number }
  | { kind: 'paused'; ms: number }

describe('clamd INSTREAM istemcisi (node:net + pipeline)', () => {
  let server: Server
  let port: number
  let behaviour: Behaviour = { kind: 'reply', text: 'stream: OK\0' }
  let lastParser: InstreamParser | null = null
  const lastFrames = () => lastParser?.frames()
  const serverClosed: Promise<void>[] = []
  const sockets = new Set<Socket>()

  before(async () => {
    server = createServer((socket) => {
      sockets.add(socket)
      serverClosed.push(once(socket, 'close').then(() => undefined))
      socket.on('close', () => sockets.delete(socket))
      socket.on('error', () => undefined)
      const parser = new InstreamParser()
      lastParser = parser
      const current = behaviour
      if (current.kind === 'paused') {
        socket.pause()
        setTimeout(() => socket.resume(), current.ms)
      }
      let answered = false
      socket.on('data', (chunk: Buffer) => {
        if (answered) return
        parser.push(chunk)
        if (current.kind === 'limit-after' && parser.received >= current.bytes) {
          answered = true
          socket.end('INSTREAM size limit exceeded. ERROR\0')
          return
        }
        if (!parser.complete) return
        if (current.kind !== 'hang') answered = true
        switch (current.kind) {
          case 'reply':
            socket.end(current.text)
            return
          case 'partial':
            socket.end(current.text)
            return
          case 'paused':
            socket.end('stream: OK\0')
            return
          case 'hang':
          case 'limit-after':
            return
          default:
            current satisfies never
        }
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
  const latestServerClose = () => serverClosed.at(-1) ?? Promise.resolve()

  test('ADR 0003 karar 8: stream: OK temiz sonuçtur; komut, parçalar ve bitiş protokole uyar', async () => {
    behaviour = { kind: 'reply', text: 'stream: OK\0' }
    assert.deepEqual(await scanner().scan(input()), { infected: false })
    assert.equal(lastFrames()?.commandOk, true)
    assert.equal(lastFrames()?.complete, true)
    assert.equal(lastFrames()?.data.toString(), '%PDF-1.4 deneme içerik')
  })

  test('ADR 0003 karar 8: FOUND zararlıdır ve imza adını taşır (sezgi ve sınır bulgusu dahil)', async () => {
    for (const signature of [
      'Eicar-Test-Signature',
      'Heuristics.Encrypted.PDF',
      'Heuristics.Limits.Exceeded.MaxFileSize',
    ]) {
      behaviour = { kind: 'reply', text: `stream: ${signature} FOUND\0` }
      assert.deepEqual(await scanner().scan(input()), { infected: true, signature })
    }
  })

  test('ADR 0003 karar 8: ERROR yanıtı asla temiz sayılmaz, geçici hatadır', async () => {
    behaviour = { kind: 'reply', text: "stream: Can't allocate memory ERROR\0" }
    await assert.rejects(scanner().scan(input()), {
      name: 'ScannerUnavailableError',
      message: 'clamd returned ERROR',
    })
  })

  test('Sabah kararı 43: INSTREAM size limit exceeded kalıcı rettir; akış ortasında gelse de okunur', async () => {
    behaviour = { kind: 'limit-after', bytes: 256 * 1024 }
    const big = Readable.from(
      (function* () {
        for (let index = 0; index < 64; index += 1) yield Buffer.alloc(64 * 1024, 7)
      })(),
    )
    await assert.rejects(scanner().scan(big), ScanLimitExceededError)
  })

  test('ADR 0003 karar 8: yarım (sonlandırıcısız) ya da tanınmayan yanıt geçici hatadır', async () => {
    behaviour = { kind: 'partial', text: 'stream: O' }
    await assert.rejects(scanner().scan(input()), {
      name: 'ScannerUnavailableError',
      message: 'clamd reply malformed',
    })
    behaviour = { kind: 'reply', text: 'PONG\0' }
    await assert.rejects(scanner().scan(input()), { code: 'scanner_unavailable' })
    behaviour = { kind: 'partial', text: '' }
    await assert.rejects(scanner().scan(input()), { code: 'scanner_unavailable' })
  })

  test('ADR 0003 karar 8: yanıt vermeyen clamd süre sınırında biter; soket ve giriş akışı kapanır', async () => {
    behaviour = { kind: 'hang' }
    const source = input()
    const started = Date.now()
    await assert.rejects(scanner(1000).scan(source), {
      name: 'ScannerUnavailableError',
      message: 'clamd scan timed out',
    })
    assert.ok(Date.now() - started < 4000)
    assert.equal(source.destroyed, true)
    // Sunucu tarafındaki bağlantı da kapanır: istemci soketi `destroy()` etti.
    await Promise.race([
      latestServerClose(),
      delay(2000).then(() => assert.fail('soket kapanmadı')),
    ])
  })

  test('ADR 0003 karar 8: JobDeps.signal iptali taramayı keser; soket ve giriş akışı kapanır', async () => {
    behaviour = { kind: 'hang' }
    const controller = new AbortController()
    // Bitmeyen akış: iptal olmadan tarama hiç bitmezdi.
    const endless = new Readable({
      read() {
        this.push(Buffer.alloc(1024, 1))
      },
    })
    const pending = scanner().scan(endless, { signal: controller.signal })
    await delay(50)
    controller.abort()
    await assert.rejects(pending, { message: 'clamd scan aborted' })
    assert.equal(endless.destroyed, true)
    await Promise.race([
      latestServerClose(),
      delay(2000).then(() => assert.fail('soket kapanmadı')),
    ])
    // Baştan iptal edilmiş sinyal bağlantı açmaz.
    const source = input()
    await assert.rejects(scanner().scan(source, { signal: AbortSignal.abort() }), {
      message: 'clamd scan aborted',
    })
    assert.equal(source.destroyed, true)
  })

  test('büyük akış: parçalar en çok 64 KiB, toplam bayt korunur; clamd okumazken kaynak bellekte birikmez', async () => {
    behaviour = { kind: 'paused', ms: 400 }
    const total = 32 * 1024 * 1024
    let produced = 0
    let producedWhilePaused = 0
    // Kaynak 1 MiB'lık parçalar üretir; backpressure varsa soket dolunca okunmaz.
    const source = new Readable({
      highWaterMark: 1024 * 1024,
      read() {
        if (produced >= total) return void this.push(null)
        produced += 1024 * 1024
        this.push(Buffer.alloc(1024 * 1024, produced % 251))
      },
    })
    setTimeout(() => (producedWhilePaused = produced), 300)
    assert.deepEqual(await scanner(20_000).scan(source), { infected: false })
    assert.equal(lastFrames()?.complete, true)
    assert.equal(lastFrames()?.data.length, total)
    assert.ok(lastFrames()?.sizes.every((size) => size > 0 && size <= INSTREAM_CHUNK_BYTES))
    assert.ok(
      producedWhilePaused < 16 * 1024 * 1024,
      `sunucu okumazken ${producedWhilePaused} bayt üretildi`,
    )
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
      ScannerUnavailableError,
    )
  })

  test('yanıt ayrıştırma: sonlandırıcı zorunlu; bilinmeyen imza karakteri ad olarak taşınmaz', () => {
    assert.deepEqual(parseClamdReply(Buffer.from('stream: OK\0')), { kind: 'clean' })
    assert.deepEqual(parseClamdReply(Buffer.from('stream: OK')), { kind: 'malformed' })
    assert.deepEqual(parseClamdReply(Buffer.from('stream: a b\nc FOUND\0')), {
      kind: 'infected',
      signature: 'unknown',
    })
    assert.deepEqual(parseClamdReply(Buffer.from('INSTREAM size limit exceeded. ERROR\0')), {
      kind: 'limit_exceeded',
    })
    assert.deepEqual(parseClamdReply(Buffer.from('stream: lstat() failed ERROR\0')), {
      kind: 'error',
    })
  })

  test('FILE_SCANNER: off tarayıcı kurmaz, clamav sürücü kurar', () => {
    assert.equal(createFileScanner(testConfig()), null)
    assert.notEqual(createFileScanner(testConfig({ FILE_SCANNER: 'clamav' })), null)
  })

  test('Sabah kararı 43: clamd.conf sınırı aşanı bildirir; akış ve dosya sınırı en büyük amaç sınırının üstünde', async () => {
    const conf = await readFile(
      new URL('../../../deploy/clamav/clamd.conf', import.meta.url),
      'utf8',
    )
    const option = (name: string) => {
      const match = new RegExp(`^${name}\\s+(\\S+)$`, 'm').exec(conf)
      assert.ok(match, `${name} yok`)
      return match[1] ?? ''
    }
    const bytes = (value: string) => {
      const match = /^(\d+)([KM]?)$/.exec(value)
      assert.ok(match, value)
      const unit = match[2] === 'M' ? 1024 * 1024 : match[2] === 'K' ? 1024 : 1
      return Number(match[1]) * unit
    }
    assert.equal(option('AlertExceedsMax'), 'yes')
    for (const name of ['StreamMaxLength', 'MaxFileSize'])
      assert.ok(bytes(option(name)) > MAX_UPLOAD_BYTES, name)
    assert.ok(bytes(option('MaxScanSize')) >= bytes(option('StreamMaxLength')))
  })
})
