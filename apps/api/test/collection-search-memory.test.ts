import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import type { CollectionName } from '../src/db/collections.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import {
  buildTestApp,
  createInstitution,
  createTestDatabase,
  FIXED_NOW,
  signInAs,
} from './support/app.ts'
import { sampleRows } from './support/collections-sample.ts'

/**
 * Bağlı adla arama iki yoldan çalışır: eşleşen bağlı kimlik sayısı `MAX_SQL_SEARCH_KEYS` (1000)
 * veya altındaysa SQL aday süzgeci, aşıldığında bellek yolu. Aynı kayıtlar ve aynı sorgu iki yolda
 * da aynı sonucu ve aynı sırayı vermelidir. İki kurum aynı taksitleri taşır; fark yalnız
 * taksitsiz fazla öğrencilerin adıdır: birinde aranan metni içerir (1100 eşleşen kimlik, bellek),
 * ötekinde içermez (SQL).
 */

const EXTRA_STUDENTS = 1100
const OWNERS = [
  ['test-bellek-1', 'Bellek Kerem Aksoy'],
  ['test-bellek-2', 'Bellek Ada Yurt'],
  ['test-bellek-3', 'Bellek Ayşe Zorlu'],
  ['test-bellek-4', 'Bellek Berk Cömert'],
] as const

const student = (id: string, name: string, number: string) => ({
  collection: 'students' as const,
  id,
  data: { id, name, number, classId: 'c1', isActive: true },
})
const invoice = (id: string, studentId: string, installment: number) => ({
  collection: 'invoices' as const,
  id,
  data: {
    id,
    studentId,
    installment,
    amount: 100_00 * installment,
    dueDate: `2026-11-${String(10 + installment).padStart(2, '0')}`,
    paidAt: null,
    method: null,
    reminderAt: null,
  },
})

/** Ortak çekirdek: sahip öğrenciler ve taksitleri; sıra (ekleme sırası) iki kurumda aynıdır. */
function core() {
  const rows: { collection: CollectionName; id: string; data: Record<string, unknown> }[] = []
  OWNERS.forEach(([id, name], index) => {
    rows.push(student(id, name, `B${index + 1}`))
    // Taksit sırası ad sırasından farklıdır: ad sıralaması ile depo sırası ayrışır.
    rows.push(invoice(`test-inv-${index + 1}-b`, id, 2))
    rows.push(invoice(`test-inv-${index + 1}-a`, id, 1))
  })
  return rows
}

function extras(prefix: string) {
  return Array.from({ length: EXTRA_STUDENTS }, (_, index) =>
    student(`test-fazla-${index}`, `${prefix} Fazla ${index}`, `F${index}`),
  )
}

describe('bağlı ad aramasında SQL ve bellek yolu', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db)
  })
  after(async () => {
    await app.close()
    await close()
  })

  async function institution(prefix: string) {
    const created = await createInstitution(app)
    // Örnek kesitin öğrenci ve taksitleri yok sayılır: yalnız sınıflar ve bu dosyanın kayıtları.
    const classes = sampleRows().filter((row) => row.collection === 'classes')
    await insertMissingRecords(
      db,
      created.id,
      [...classes, ...core(), ...extras(prefix)],
      FIXED_NOW,
    )
    return { ...created, cookie: await signInAs(app, created.admin) }
  }

  async function ids(cookie: string, query: string) {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/collections/invoices?pageSize=100&${query}`,
      headers: { cookie },
    })
    assert.equal(response.statusCode, 200, response.body)
    const body = response.json()
    assert.equal(body.meta.total, body.data.length, query)
    return body.data.map((item: { id: string }) => item.id) as string[]
  }

  const ALL = OWNERS.flatMap((_, index) => [`test-inv-${index + 1}-b`, `test-inv-${index + 1}-a`])

  test('1001+ eşleşen bağlı adla q bellek yoluna döner; SQL yoluyla aynı sonuç ve sıra', async () => {
    const memory = await institution('Bellek')
    const sql = await institution('Diger')
    for (const query of [
      'q=bellek',
      'q=BELLEK&sort=studentName',
      'q=bellek&sort=-studentName,-amount',
      'q=bellek&sort=studentNumber',
      'q=bellek+ada',
    ]) {
      const fromMemory = await ids(memory.cookie, query)
      const fromSql = await ids(sql.cookie, query)
      assert.ok(fromMemory.length > 0, query)
      assert.deepEqual(fromMemory, fromSql, query)
    }
    // Sonuç kümesi ve varsayılan sıra (deponun sırası) beklenen kayıtlardır.
    assert.deepEqual(await ids(memory.cookie, 'q=bellek'), ALL)
    assert.deepEqual(await ids(sql.cookie, 'q=bellek'), ALL)
    assert.deepEqual(await ids(memory.cookie, 'q=bellek+ada'), ['test-inv-2-b', 'test-inv-2-a'])
    // Öğrenci adıyla sıralama: Ada, Ayşe, Berk, Kerem (Türkçe harf sırası değil, ad karşılaştırması
    // iki yolda aynıdır); eşit adda depo sırası.
    const bySortedName = await ids(memory.cookie, 'q=bellek&sort=studentName')
    assert.deepEqual(bySortedName, await ids(sql.cookie, 'q=bellek&sort=studentName'))
    assert.equal(bySortedName.length, ALL.length)
  })

  test('eşleşme eşiğin altındaysa da aynı sonuç: yalnız taksitli öğrenciler döner', async () => {
    const sql = await institution('Diger')
    assert.deepEqual(await ids(sql.cookie, 'q=bellek'), ALL)
    // Taksiti olmayan fazla öğrencinin adıyla arama taksit döndürmez.
    assert.deepEqual(await ids(sql.cookie, 'q=diger+fazla'), [])
  })

  test('bellek yolunda taksitsiz fazla öğrencinin adı taksit döndürmez', async () => {
    const memory = await institution('Bellek')
    assert.deepEqual(await ids(memory.cookie, 'q=bellek+fazla'), [])
    assert.deepEqual(await ids(memory.cookie, 'q=bellek+fazla+12'), [])
  })
})
