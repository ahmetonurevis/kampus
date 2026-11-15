import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { count, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import { SESSION_FRESH_AGE_SECONDS } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords, loadRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { studentGuardians } from '../src/db/schema/student-guardians.ts'
import { studentIdentities } from '../src/db/schema/student-identities.ts'
import { insertStudentIdentity } from '../src/db/student-identities.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
  type TestInstitution,
} from './support/app.ts'
import { base64, turkishId, xlsxFile } from './support/enrollment-import-files.ts'

/**
 * e-Okul öğrenci listesinden içe aktarım (ON-062, IST-134; DOM-KAY-042).
 * `POST /prospects/eokul-student-imports`: yönetici ve ön büro, taze oturum, yalnız okul türü,
 * `Idempotency-Key` zorunlu; önizleme yazmaz, onay yalnız seçilen satırları tek transaction'da yazar.
 */

const URL = '/api/v1/prospects/eokul-student-imports'
const HEADER =
  'S.No;Okul No;T.C. Kimlik No;Adı;Soyadı;Cinsiyeti;Sınıfı/Şubesi;Doğum Tarihi;Veli Adı Soyadı;Veli Cep Telefonu'
const csv = (...lines: string[]) =>
  base64(['ÖRNEK ANADOLU LİSESİ;;;;;;;;;', HEADER, ...lines].join('\n'))
const row = (
  no: string,
  id: string,
  name: [string, string],
  klass: string,
  guardian: [string, string] = ['Ayla Demir', '05321110001'],
  birth = '14.03.2010',
) => `1;${no};${id};${name[0]};${name[1]};Kız;${klass};${birth};${guardian[0]};${guardian[1]}`

interface Row {
  line: number
  status: string
  identityMasked: string
  classLabel: string
  changes: { field: string; before: string | null; after: string | null }[]
  issues: { field: string | null; code: string }[]
  notices: { code: string }[]
}
interface Result {
  dryRun: boolean
  headerLine: number
  headers: { index: number; label: string }[]
  mapping: Record<string, number | null>
  suggestedMapping: Record<string, number | null>
  mappingIssues: { field: string; code: string }[]
  rowCount: number
  newCount: number
  updateCount: number
  unchangedCount: number
  invalidCount: number
  rows: Row[]
}

describe('e-Okul öğrenci listesi aktarımı (ON-062, IST-134)', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let staleApp: App
  let seed = 400

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db)
    staleApp = await buildTestApp(db, {
      clock: () => new Date(Date.now() + (SESSION_FRESH_AGE_SECONDS + 60) * 1000),
    })
  })
  after(async () => {
    await staleApp.close()
    await app.close()
    await close()
  })

  const nextId = () => turkishId(++seed)

  async function upload(
    cookie: string | undefined,
    fileBase64: string,
    options: { dryRun?: boolean; key?: string | null; target?: App; extra?: object } = {},
  ) {
    const key = options.key === undefined ? randomUUID() : options.key
    return (options.target ?? app).inject({
      method: 'POST',
      url: URL,
      headers: {
        origin: TEST_ORIGIN,
        'content-type': 'application/json',
        ...(cookie ? { cookie } : {}),
        ...(key === null ? {} : { 'idempotency-key': key }),
      },
      payload: { fileBase64, dryRun: options.dryRun ?? false, ...options.extra },
    })
  }

  /** Kurum: 9-A ve 9-B sınıfları, Deniz Yılmaz (okul no 101, kimlikli) ve Ece Kaya (102, kimliksiz). */
  async function kurum(
    overrides: Parameters<typeof createInstitution>[1] = {},
  ): Promise<{ institution: TestInstitution; cookie: string; denizId: string }> {
    const institution = await createInstitution(app, overrides)
    const klass = (id: string, name: string, section: string, capacity = 30) => ({
      collection: 'classes' as const,
      id,
      data: { id, name, branchId: 'b-1', capacity, grade: 9, section, isActive: true },
    })
    const student = (id: string, name: string, number: string) => ({
      collection: 'students' as const,
      id,
      data: {
        id,
        name,
        classId: 'c-9a',
        parentId: 'p-1',
        email: '',
        phone: '',
        joinedAt: FIXED_NOW.toISOString(),
        isActive: true,
        progress: 0,
        number,
      },
    })
    await insertMissingRecords(
      db,
      institution.id,
      [
        {
          collection: 'branches',
          id: 'b-1',
          data: { id: 'b-1', name: 'Kadıköy Kampüsü', isActive: true },
        },
        klass('c-9a', '9-A', 'A'),
        klass('c-9b', '9-B', 'B'),
        student('s-1', 'Deniz Yılmaz', '101'),
        student('s-2', 'Ece Kaya', '102'),
        {
          collection: 'parents',
          id: 'p-1',
          data: {
            id: 'p-1',
            name: 'Ayşe Yılmaz',
            phone: '05329990000',
            studentIds: ['s-1', 's-2'],
          },
        },
      ],
      FIXED_NOW,
    )
    const denizId = nextId()
    await insertStudentIdentity(db, institution.id, {
      studentId: 's-1',
      academicYear: 2026,
      kind: 'tc',
      number: denizId,
      birthDate: '2010-03-14',
      now: FIXED_NOW,
    })
    return { institution, cookie: await signInAs(app, institution.admin), denizId }
  }

  async function snapshot(institutionId: string) {
    const records = await loadRecords(db, institutionId, ['students', 'parents'])
    const [identities] = await db
      .select({ total: count() })
      .from(studentIdentities)
      .where(eq(studentIdentities.institutionId, institutionId))
    const [bonds] = await db
      .select({ total: count() })
      .from(studentGuardians)
      .where(eq(studentGuardians.institutionId, institutionId))
    return {
      students: records
        .filter((record) => record.collection === 'students')
        .map((record) => ({ id: record.id, version: record.version, data: record.data })),
      parents: records
        .filter((record) => record.collection === 'parents')
        .map((record) => ({ id: record.id, version: record.version, data: record.data })),
      identities: identities?.total ?? 0,
      bonds: bonds?.total ?? 0,
    }
  }

  test('DOM-KAY-042: 401 oturumsuz, 403 öğretmen/veli/öğrenci, kayıt değişmez', async () => {
    const { institution } = await kurum()
    const before = await snapshot(institution.id)
    const file = csv(row('201', nextId(), ['Can', 'Demir'], '9/A'))
    assert.equal((await upload(undefined, file)).statusCode, 401)
    for (const role of ['ogretmen', 'veli', 'ogrenci'] as const) {
      const member = await createMember(app, institution.id, role)
      assert.equal((await upload(await signInAs(app, member), file)).statusCode, 403, role)
    }
    assert.deepEqual(await snapshot(institution.id), before)
  })

  test('IST-134: taze oturum yoksa 403, crm kapalıysa 403, okul dışındaki kurumda 404', async () => {
    const { institution, cookie } = await kurum()
    const file = csv(row('201', nextId(), ['Can', 'Demir'], '9/A'))
    const stale = await upload(cookie, file, { target: staleApp })
    assert.equal(stale.statusCode, 403)
    assert.equal(stale.json().code, 'reauthentication_required')
    const closed = await createInstitution(app, { enabledModules: { crm: false } })
    const disabled = await upload(await signInAs(app, closed.admin), file)
    assert.equal(disabled.statusCode, 403)
    assert.equal(disabled.json().code, 'module_disabled')
    const course = await createInstitution(app, { type: 'language_school' })
    assert.equal(
      (await upload(await signInAs(app, course.admin), file, { dryRun: true })).statusCode,
      404,
    )
    assert.equal((await snapshot(institution.id)).students.length, 2)
  })

  test('IST-134: Idempotency-Key eksikse 400, seçimsiz onay ve gövdede institutionId 400', async () => {
    const { institution, cookie } = await kurum()
    const before = await snapshot(institution.id)
    const file = csv(row('201', nextId(), ['Can', 'Demir'], '9/A'))
    const noKey = await upload(cookie, file, { key: null, extra: { lines: [3] } })
    assert.equal(noKey.statusCode, 400)
    assert.equal(noKey.json().code, 'idempotency_key_required')
    assert.equal((await upload(cookie, file)).statusCode, 400, 'lines yoksa onay 400')
    assert.equal(
      (await upload(cookie, file, { extra: { lines: [3], institutionId: 'x' } })).statusCode,
      400,
    )
    assert.equal((await upload(cookie, '%%% base64 değil', { dryRun: true })).statusCode, 400)
    assert.deepEqual(await snapshot(institution.id), before)
  })

  test('DOM-KAY-042: önizleme eşleme önerir, satırları sınıflar, maskeli döner ve yazmaz', async () => {
    const { institution, cookie, denizId } = await kurum()
    const before = await snapshot(institution.id)
    const newId = nextId()
    const eceId = nextId()
    const response = await upload(
      cookie,
      csv(
        row('101', denizId, ['DENİZ', 'YILMAZ'], '9. Sınıf / A Şubesi'),
        row('102', eceId, ['Ece', 'Kaya'], '9/B', ['x', 'y'], '01.02.2010'),
        row('201', newId, ['Can', 'Demir'], '9/A'),
        row('202', nextId(), ['Su', 'Ay'], '11/C'),
      ),
      { dryRun: true },
    )
    assert.equal(response.statusCode, 200, response.body)
    const data = response.json().data as Result
    assert.equal(data.headerLine, 2)
    assert.equal(data.headers[2]?.label, 'T.C. Kimlik No')
    assert.deepEqual(data.mapping, data.suggestedMapping)
    assert.equal(data.mapping.identityNumber, 2)
    assert.equal(data.mapping.relationship, null)
    assert.deepEqual(
      [data.unchangedCount, data.updateCount, data.newCount, data.invalidCount],
      [1, 1, 1, 1],
    )
    assert.deepEqual(
      data.rows.map((item) => item.status),
      ['unchanged', 'update', 'new', 'invalid'],
    )
    assert.deepEqual(
      data.rows[1]?.changes.map((change) => change.field),
      ['class', 'identity'],
    )
    assert.deepEqual(
      data.rows[3]?.issues.map((issue) => issue.code),
      ['class_not_found'],
    )
    assert.equal(data.rows[2]?.identityMasked, `*******${newId.slice(-4)}`)
    for (const secret of [denizId, eceId, newId, '05321110001'])
      assert.ok(!response.body.includes(secret), 'tam kimlik ve telefon yanıtta olmamalı')
    assert.deepEqual(await snapshot(institution.id), before)
  })

  test('DOM-KAY-042: eşleme düzeltilir; eksik eşleme önizlemede sorun, onayda 422', async () => {
    const { institution, cookie } = await kurum()
    const before = await snapshot(institution.id)
    const file = csv(row('201', nextId(), ['Can', 'Demir'], '9/A'))
    const broken = await upload(cookie, file, {
      dryRun: true,
      extra: { mapping: { firstName: 3, lastName: 4 } },
    })
    assert.equal(broken.statusCode, 200)
    const data = broken.json().data as Result
    assert.deepEqual(
      data.mappingIssues.map((issue) => issue.code),
      ['match_column_required'],
    )
    assert.equal(data.rows.length, 0)
    const rejected = await upload(cookie, file, {
      extra: { mapping: { firstName: 3, lastName: 4 }, lines: [3] },
    })
    assert.equal(rejected.statusCode, 422)
    assert.equal(rejected.json().code, 'eokul_mapping_invalid')
    assert.deepEqual(rejected.json().issues[0].path, ['mapping', 'identityNumber'])
    assert.deepEqual(await snapshot(institution.id), before)
  })

  test('IST-134: seçilen satır hatalıysa 422 eokul_import_invalid, hiçbir kayıt yazılmaz', async () => {
    const { institution, cookie } = await kurum()
    const before = await snapshot(institution.id)
    const response = await upload(
      cookie,
      csv(
        row('201', nextId(), ['Can', 'Demir'], '9/A'),
        row('202', nextId(), ['Su', 'Ay'], '11/C'),
      ),
      { extra: { lines: [3, 4] } },
    )
    assert.equal(response.statusCode, 422)
    const body = response.json()
    assert.equal(body.code, 'eokul_import_invalid')
    assert.deepEqual(body.issues[0].path, ['rows', 4, 'className'])
    assert.match(body.issues[0].message, /^4\. satır: /)
    assert.deepEqual(await snapshot(institution.id), before)
  })

  test('DOM-KAY-042: yalnız seçilen satırlar yazılır; güncelleme, kimlik, yeni öğrenci ve veli bağı tek işlemde', async () => {
    const { institution, cookie, denizId } = await kurum()
    const eceId = nextId()
    const newId = nextId()
    const file = csv(
      row('101', denizId, ['DENİZ', 'YILMAZ ÖZ'], '9/A'),
      row('102', eceId, ['Ece', 'Kaya'], '9/B', ['x', 'y'], '01.02.2010'),
      row('201', newId, ['Can', 'Demir'], '9/A'),
      row('202', nextId(), ['Su', 'Ay'], '11/C'),
    )
    const key = randomUUID()
    const response = await upload(cookie, file, { key, extra: { lines: [4, 5] } })
    assert.equal(response.statusCode, 201, response.body)
    const data = response.json().data as Result
    assert.equal(data.dryRun, false)
    assert.deepEqual([data.rowCount, data.updateCount, data.newCount], [2, 1, 1])
    assert.deepEqual(data.rows, [], 'onay yanıtı satır taşımaz')

    const state = await snapshot(institution.id)
    const byId = new Map(state.students.map((item) => [item.id, item.data]))
    assert.equal(byId.get('s-1')?.name, 'Deniz Yılmaz', 'seçilmeyen satır yazılmaz')
    assert.equal(byId.get('s-2')?.classId, 'c-9b')
    const can = state.students.find((item) => item.data.name === 'Can Demir')
    assert.equal(can?.data.number, '201')
    assert.equal(can?.data.classId, 'c-9a')
    assert.equal(state.identities, 3)
    assert.equal(state.bonds, 1)
    const [eceIdentity] = await db
      .select({ number: studentIdentities.identityNumber, birthDate: studentIdentities.birthDate })
      .from(studentIdentities)
      .where(eq(studentIdentities.studentId, 's-2'))
    assert.deepEqual(eceIdentity, { number: eceId, birthDate: '2010-02-01' })

    const replay = await upload(cookie, file, { key, extra: { lines: [4, 5] } })
    assert.equal(replay.statusCode, 201)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.equal((await snapshot(institution.id)).students.length, 3)

    const audits = await db
      .select({ action: auditLog.action, changes: auditLog.changes })
      .from(auditLog)
      .where(eq(auditLog.institutionId, institution.id))
    const main = audits.find((audit) => audit.action === 'student.eokul_import')
    assert.deepEqual((main?.changes as { counts: object }).counts, {
      rows: 2,
      created: 1,
      updated: 1,
      unchanged: 0,
      identities: 2,
      guardianLinks: 1,
    })
    const dump = JSON.stringify(audits)
    for (const secret of [eceId, newId, '05321110001'])
      assert.ok(!dump.includes(secret), 'denetimde kişisel veri olmamalı')
  })

  test('IST-134: ön büro aktarır; .xlsx dosyası okunur, eski .xls reddedilir', async () => {
    const { institution } = await kurum()
    const front = await createMember(app, institution.id, 'onburo')
    const cookie = await signInAs(app, front)
    const id = nextId()
    const xlsx = base64(
      xlsxFile([
        ['ÖRNEK ANADOLU LİSESİ'],
        [
          'Okul No',
          'TC Kimlik No',
          'Adı Soyadı',
          'Sınıf',
          'Şube',
          'Doğum Tarihi',
          'Veli Adı',
          'Veli Telefonu',
        ],
        [
          301,
          Number(id),
          'MERT KURT',
          '9. Sınıf',
          'A Şubesi',
          { date: '2010-05-06' },
          'Sena Kurt',
          5321110300,
        ],
      ]),
    )
    const preview = await upload(cookie, xlsx, { dryRun: true })
    assert.equal(preview.statusCode, 200, preview.body)
    const data = preview.json().data as Result
    assert.equal(data.rows[0]?.status, 'new', JSON.stringify(data.rows[0]?.issues))
    assert.equal(data.rows[0]?.classLabel, '9-A')
    const done = await upload(cookie, xlsx, { extra: { lines: [3] } })
    assert.equal(done.statusCode, 201, done.body)
    const state = await snapshot(institution.id)
    assert.ok(state.students.some((item) => item.data.name === 'Mert Kurt'))
    const legacy = await upload(
      cookie,
      base64(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])),
      { dryRun: true },
    )
    assert.equal(legacy.statusCode, 422)
    assert.equal(legacy.json().code, 'import_file_legacy_excel')
  })

  test('IST-002: başka kurumun öğrencisi, sınıfı ve kimliği bu kurumu etkilemez', async () => {
    const b = await kurum()
    const a = await kurum()
    const before = await snapshot(b.institution.id)
    // B'nin Deniz'inin kimliği ve okul numarası A'da: A'nın kendi kaydıyla eşleşmez, B değişmez.
    const response = await upload(
      a.cookie,
      csv(row('901', b.denizId, ['Başka', 'Öğrenci'], '9/A', ['Başka Veli', '05321110900'])),
      { dryRun: true },
    )
    const data = response.json().data as Result
    assert.equal(data.rows[0]?.status, 'new')
    const write = await upload(
      a.cookie,
      csv(row('901', b.denizId, ['Başka', 'Öğrenci'], '9/A', ['Başka Veli', '05321110900'])),
      { extra: { lines: [3], institutionId: b.institution.id } },
    )
    assert.equal(write.statusCode, 400)
    const fixed = await upload(
      a.cookie,
      csv(row('901', b.denizId, ['Başka', 'Öğrenci'], '9/A', ['Başka Veli', '05321110900'])),
      { extra: { lines: [3], branchId: 'b-yok' } },
    )
    assert.equal(fixed.statusCode, 422)
    assert.deepEqual(await snapshot(b.institution.id), before)
  })

  test('KVKK: logda kimlik, telefon ve dosya içeriği yok', async () => {
    const logs: string[] = []
    const logged = await buildTestApp(db, { logs })
    try {
      const institution = await createInstitution(logged)
      await insertMissingRecords(
        db,
        institution.id,
        [
          { collection: 'branches', id: 'b-1', data: { id: 'b-1', name: 'K', isActive: true } },
          {
            collection: 'classes',
            id: 'c-9a',
            data: {
              id: 'c-9a',
              name: '9-A',
              branchId: 'b-1',
              capacity: 9,
              grade: 9,
              isActive: true,
            },
          },
        ],
        FIXED_NOW,
      )
      const cookie = await signInAs(logged, institution.admin)
      const id = nextId()
      const file = csv(row('111', id, ['Gizli', 'Öğrenci'], '9/A', ['Gizli Veli', '05321110777']))
      const done = await upload(cookie, file, { target: logged, extra: { lines: [3] } })
      assert.equal(done.statusCode, 201, done.body)
      await upload(cookie, csv(row('112', id, ['Gizli', 'Öğrenci'], '12/Z')), {
        target: logged,
        extra: { lines: [3] },
      })
      const text = logs.join('')
      for (const secret of [id, '05321110777', 'Gizli', file])
        assert.ok(!text.includes(secret), `logda ${secret.slice(0, 6)} olmamalı`)
    } finally {
      await logged.close()
    }
  })
})
