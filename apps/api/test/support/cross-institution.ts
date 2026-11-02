import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { getTableName, sql } from 'drizzle-orm'
import type { PgTable } from 'drizzle-orm/pg-core'

import type { App } from '../../src/app.ts'
import type { Database } from '../../src/db/client.ts'
import { TEST_ORIGIN } from './app.ts'

/**
 * Çapraz kurum tablo testlerinin ortak koşucusu (IST-002; DOM-YTK-001, DOM-YTK-011). Test adları
 * envanterin metinsel denetimi için çağıran dosyada yazılır (`cross-institution-inventory.test.ts`);
 * burada yalnız istek ve karşılaştırma vardır.
 *
 * - `kayıt`: B kurumunun kaydına A'dan istek, olmayan kimlikle aynı 404'tür.
 * - `gövde`: gövdedeki B kaydı kimliği ve `institutionId: B` etkisizdir; yanıt olmayan kimlikle
 *   aynıdır (404, 422 ya da kapsam reddi 403; varlık sızmaz).
 * - İki kurumun izlenen satırları değişmez.
 * - Denetim: aynı istek A'nın kendi kaydıyla işin kuralına ulaşır (2xx, 409 ya da 422); 404 gövde
 *   ya da rol yüzünden değildir.
 */

export type Ids = Readonly<Record<string, string>>
export type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE'
export interface CrossRequest {
  method: Method
  url: string
  body?: Record<string, unknown>
  ifMatch?: number
}

export interface CrossCase<T> {
  key: string
  kind: 'kayıt' | 'gövde'
  /** İsteği yapan A kurumu oturumu. */
  actor: (a: T) => string
  /** Kurumda hedef kaydı (ya da gövdenin işaret ettiği kaydı) kurar, kimliklerini döner. */
  make: (tenant: T) => Promise<Ids>
  /** Olmayan kayıt kimlikleri; verilmezse `make` anahtarları rastgele UUID olur. */
  missing?: (foreign: Ids) => Ids
  /** Denetim isteğinin A kaydı; verilmezse `make(a)`. */
  own?: (a: T) => Promise<Ids>
  /** Bilinen açık: test koşar ama kırmızısı takımı durdurmaz (düzeltme ayrı işte). */
  todo?: string
  request: (ids: Ids) => CrossRequest
}

export interface CrossContext<T> {
  app: App
  tenant: () => Promise<T & { id: string }>
  /** İzlenen satırların kuruma göre özeti (değişmezlik karşılaştırması). */
  snapshot: (institutionId: string) => Promise<unknown>
}

let ipCounter = 0
/** Her test ayrı istemci IP'si: genel hız sınırı (dakikada 300) dosyanın bütününe düşmez. */
export const nextIp = () => `10.9.${Math.floor(++ipCounter / 250) % 250}.${(ipCounter % 250) + 1}`

export function crossInject(app: App, ip: string, cookie: string, request: CrossRequest) {
  const { method, url, body, ifMatch } = request
  return app.inject({
    method,
    url,
    remoteAddress: ip,
    headers: {
      cookie,
      origin: TEST_ORIGIN,
      ...(method === 'GET' ? {} : { 'idempotency-key': randomUUID() }),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(ifMatch === undefined ? {} : { 'if-match': `"${String(ifMatch)}"` }),
    },
    ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
  })
}

type Response = Awaited<ReturnType<typeof crossInject>>

/** Yanıtın sızıntı açısından anlamlı kısmı (istek kimliği hariç). */
export const shape = (response: Response) => {
  const body = response.json<{ code?: string; message?: string }>()
  return { status: response.statusCode, code: body.code, message: body.message }
}

const withInstitution = (request: CrossRequest, institutionId: string): CrossRequest =>
  request.body === undefined ? request : { ...request, body: { ...request.body, institutionId } }

const randomIds = (ids: Ids): Ids =>
  Object.fromEntries(Object.keys(ids).map((name) => [name, randomUUID()]))

/** Tek satırı koşar: başka kurum yanıtı olmayan kimlikle aynı, iki kurum değişmez, denetim. */
export async function runCrossCase<T>(context: CrossContext<T>, spec: CrossCase<T>) {
  const { app, snapshot } = context
  const ip = nextIp()
  const a = await context.tenant()
  const b = await context.tenant()
  const foreignIds = await spec.make(b)
  const cookie = spec.actor(a)
  const before = { a: await snapshot(a.id), b: await snapshot(b.id) }

  const missing = await crossInject(
    app,
    ip,
    cookie,
    spec.request(spec.missing?.(foreignIds) ?? randomIds(foreignIds)),
  )
  // Gövdedeki kurum kimliği ya katı şemada 400'dür ya da yok sayılır; ikisinde de B değişmez.
  let foreign = await crossInject(app, ip, cookie, withInstitution(spec.request(foreignIds), b.id))
  if (foreign.statusCode === 400) {
    assert.match(foreign.body, /institutionId/, `${spec.key}: ${foreign.body}`)
    foreign = await crossInject(app, ip, cookie, spec.request(foreignIds))
  }
  assert.deepEqual(shape(foreign), shape(missing), `${spec.key}: ${foreign.body}`)
  const allowed = spec.kind === 'kayıt' ? [404] : [403, 404, 422]
  assert.ok(allowed.includes(foreign.statusCode), `${spec.key}: ${foreign.body}`)
  assert.deepEqual(await snapshot(b.id), before.b, `${spec.key}: B değişti`)
  assert.deepEqual(await snapshot(a.id), before.a, `${spec.key}: A değişti`)

  // Denetim: aynı istek A'nın kendi kaydıyla işin kuralına ulaşır.
  const own = await (spec.own ?? spec.make)(a)
  const control = await crossInject(app, ip, cookie, spec.request(own))
  assert.ok(
    control.statusCode < 300 || [409, 422].includes(control.statusCode),
    `${spec.key}: kendi kaydı ${control.body}`,
  )
  assert.deepEqual(await snapshot(b.id), before.b, `${spec.key}: denetimde B değişti`)
}

/** Kurumun verilen tablolardaki bütün satırları (değişmezlik özeti); sıra JSON metnine göre. */
export async function tableRows(
  db: Database,
  institutionId: string,
  tables: readonly PgTable[],
): Promise<Record<string, string[]>> {
  const result: Record<string, string[]> = {}
  for (const table of tables) {
    const executed = await db.execute(
      sql`select * from ${table} where institution_id = ${institutionId}`,
    )
    // PGlite ve node-postgres sonuç nesnesi `rows` taşır.
    const rows = (executed as unknown as { rows: Record<string, unknown>[] }).rows
    result[getTableName(table)] = rows.map((row) => JSON.stringify(row)).sort()
  }
  return result
}
