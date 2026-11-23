import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, count, eq, isNull } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import { SESSION_FRESH_AGE_SECONDS } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords, loadRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { membershipLinks } from '../src/db/schema/membership-links.ts'
import { studentGuardians } from '../src/db/schema/student-guardians.ts'
import { studentIdentities } from '../src/db/schema/student-identities.ts'
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
 * Pilot verisi aktarımı: öğrenci ve veli (ON-060, IST-007; DOM-KAY-010, DOM-KAY-012, DOM-KAY-013).
 * `POST /prospects/student-imports`: yalnız yönetici, taze oturum, `Idempotency-Key` zorunlu; dosya
 * saklanmaz, önizleme yazmaz, onay tek transaction'da hepsi ya da hiçbiri.
 */

const HEADER = 'öğrenci adı;sınıf;kimlik no;doğum tarihi;veli adı;veli telefonu;yakınlık'
const csv = (...lines: string[]) => base64([HEADER, ...lines].join('\n'))

interface Row {
  line: number
  status: string
  identityMasked: string
  guardianPhoneMasked: string
  guardianMatch: string | null
  issues: { field: string | null; code: string; message: string }[]
  notices: { code: string }[]
}

interface Result {
  dryRun: boolean
  rowCount: number
  readyCount: number
  skippedCount: number
  invalidCount: number
  newGuardianCount: number
  existingGuardianCount: number
  rows: Row[]
}

describe('pilot aktarımı: öğrenci ve veli (ON-060, IST-007)', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let staleApp: App
  let seed = 100

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
      url: '/api/v1/prospects/student-imports',
      headers: {
        origin: TEST_ORIGIN,
        'content-type': 'application/json',
        ...(cookie ? { cookie } : {}),
        ...(key === null ? {} : { 'idempotency-key': key }),
      },
      payload: { fileBase64, dryRun: options.dryRun ?? false, ...options.extra },
    })
  }

  async function kurum(
    overrides: Parameters<typeof createInstitution>[1] = {},
  ): Promise<{ institution: TestInstitution; cookie: string }> {
    const institution = await createInstitution(app, overrides)
    await insertMissingRecords(
      db,
      institution.id,
      [
        {
          collection: 'branches',
          id: 'b-1',
          data: { id: 'b-1', name: 'Kadıköy Kampüsü', isActive: true },
        },
        {
          collection: 'branches',
          id: 'b-2',
          data: { id: 'b-2', name: 'Moda Kampüsü', isActive: true },
        },
        {
          collection: 'classes',
          id: 'c-7a',
          data: { id: 'c-7a', name: '7-A', branchId: 'b-1', capacity: 3, grade: 7, isActive: true },
        },
        {
          collection: 'classes',
          id: 'c-5b-1',
          data: {
            id: 'c-5b-1',
            name: '5-B',
            branchId: 'b-1',
            capacity: 30,
            grade: 5,
            isActive: true,
          },
        },
        {
          collection: 'classes',
          id: 'c-5b-2',
          data: {
            id: 'c-5b-2',
            name: '5-B',
            branchId: 'b-2',
            capacity: 30,
            grade: 5,
            isActive: true,
          },
        },
      ],
      FIXED_NOW,
    )
    return { institution, cookie: await signInAs(app, institution.admin) }
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
      students: records.filter((record) => record.collection === 'students'),
      parents: records.filter((record) => record.collection === 'parents'),
      identities: identities?.total ?? 0,
      bonds: bonds?.total ?? 0,
    }
  }

  const empty = { identities: 0, bonds: 0 }
  async function assertNothingWritten(institutionId: string) {
    const after = await snapshot(institutionId)
    assert.equal(after.students.length, 0)
    assert.equal(after.parents.length, 0)
    assert.deepEqual({ identities: after.identities, bonds: after.bonds }, empty)
  }

  test('DOM-KAY-012: 401 oturumsuz, 403 yönetici dışındaki rol ve kayıt değişmez', async () => {
    const { institution } = await kurum()
    const file = csv(`Ece Demir;7-A;${nextId()};2013-03-14;Ayla Demir;05321110001;Anne`)
    assert.equal((await upload(undefined, file)).statusCode, 401)
    for (const role of ['onburo', 'ogretmen', 'veli', 'ogrenci'] as const) {
      const member = await createMember(app, institution.id, role)
      const denied = await upload(await signInAs(app, member), file)
      assert.equal(denied.statusCode, 403, role)
    }
    await assertNothingWritten(institution.id)
  })

  test('IST-007: taze oturum yoksa 403 reauthentication_required', async () => {
    const { institution, cookie } = await kurum()
    const response = await upload(
      cookie,
      csv(`Ece Demir;7-A;${nextId()};2013-03-14;Ayla Demir;05321110002;Anne`),
      { target: staleApp },
    )
    assert.equal(response.statusCode, 403)
    assert.equal(response.json().code, 'reauthentication_required')
    await assertNothingWritten(institution.id)
  })

  test('IST-009: crm modülü kapalıysa 403 module_disabled', async () => {
    const closed = await createInstitution(app, { enabledModules: { crm: false } })
    const response = await upload(
      await signInAs(app, closed.admin),
      csv(`Ece Demir;7-A;${nextId()};2013-03-14;Ayla Demir;05321110003;Anne`),
    )
    assert.equal(response.statusCode, 403)
    assert.equal(response.json().code, 'module_disabled')
  })

  test('IST-007: Idempotency-Key eksikse 400, geçersiz gövde 400 ve kayıt değişmez', async () => {
    const { institution, cookie } = await kurum()
    const file = csv(`Ece Demir;7-A;${nextId()};2013-03-14;Ayla Demir;05321110004;Anne`)
    const noKey = await upload(cookie, file, { key: null })
    assert.equal(noKey.statusCode, 400)
    assert.equal(noKey.json().code, 'idempotency_key_required')
    assert.equal((await upload(cookie, '%%% base64 değil')).statusCode, 400)
    assert.equal((await upload(cookie, file, { extra: { institutionId: 'x' } })).statusCode, 400)
    await assertNothingWritten(institution.id)
  })

  test('DOM-KAY-012: önizleme satır bazında Türkçe hata ve maskeli veri döner, hiçbir şey yazmaz', async () => {
    const { institution, cookie } = await kurum()
    const good = nextId()
    const response = await upload(
      cookie,
      csv(
        `Ece Demir;7-A;${good};14.03.2013;Ayla Demir;5321110005;Anne`,
        `Can Demir;7-A;12345678901;2015-09-02;Ayla Demir;05321110005;Anne`,
        `Mert Kaya;Yok;${nextId()};2015-09-02;;053;Dayı`,
        `Lale Kaya;5-B;${nextId()};2015-09-02;Sena Kaya;05321110006;Anne`,
        `Lale;7-A;${good};2099-01-01;Sena Kaya;05321110007;Anne`,
      ),
      { dryRun: true },
    )
    assert.equal(response.statusCode, 200)
    const data = response.json().data as Result
    assert.equal(data.dryRun, true)
    assert.equal(data.rowCount, 5)
    assert.equal(data.readyCount, 1)
    assert.equal(data.invalidCount, 4)
    const rows = data.rows
    assert.equal(rows[0]?.status, 'ready')
    assert.equal(rows[0]?.identityMasked, `*******${good.slice(-4)}`)
    assert.equal(rows[0]?.guardianPhoneMasked.includes('1110005'), false)
    assert.ok(!JSON.stringify(rows).includes(good), 'tam kimlik yanıtta olmamalı')
    assert.deepEqual(
      rows[1]?.issues.map((issue) => [issue.field, issue.code]),
      [['identityNumber', 'identity_invalid']],
    )
    assert.deepEqual(
      rows[2]?.issues.map((issue) => issue.code).sort(),
      [
        'class_not_found',
        'guardian_name_required',
        'guardian_phone_invalid',
        'guardian_relationship_invalid',
      ].sort(),
    )
    assert.deepEqual(
      rows[3]?.issues.map((issue) => issue.code),
      ['class_ambiguous'],
    )
    assert.deepEqual(
      rows[4]?.issues.map((issue) => issue.code).sort(),
      ['birth_date_invalid', 'duplicate_identity'].sort(),
    )
    assert.match(rows[4]?.issues[0]?.message ?? '', /[ığüşöçİ]/)
    await assertNothingWritten(institution.id)
  })

  test('IST-007: tek hatalı satırda onay 422, satır numaralı sorun ve hiçbir kayıt yazılmaz', async () => {
    const { institution, cookie } = await kurum()
    const response = await upload(
      cookie,
      csv(
        `Ece Demir;7-A;${nextId()};2013-03-14;Ayla Demir;05321110010;Anne`,
        `Can Demir;Yok;${nextId()};2015-09-02;Ayla Demir;05321110010;Anne`,
      ),
    )
    assert.equal(response.statusCode, 422)
    const body = response.json()
    assert.equal(body.code, 'student_import_invalid')
    assert.deepEqual(body.issues[0].path, ['rows', 3, 'className'])
    assert.match(body.issues[0].message, /^3\. satır: /)
    await assertNothingWritten(institution.id)
  })

  test('DOM-KAY-013: aynı telefon kardeşleri tek veli kaydına bağlar, bağ student_guardians, kimlik student_identities', async () => {
    const { institution, cookie } = await kurum()
    const first = nextId()
    const second = nextId()
    const file = base64(
      [
        `${HEADER};kampüs`,
        `Ece Demir;7-A;${first};2013-03-14;Ayla Demir;05321110020;Anne;`,
        `Can Demir;5-B;${second};2015-09-02;AYLA DEMİR;0532 111 00 20;anne;Moda Kampüsü`,
      ].join('\n'),
    )
    const preview = (await upload(cookie, file, { dryRun: true })).json().data as Result
    assert.equal(preview.readyCount, 2)
    assert.equal(preview.newGuardianCount, 1)
    assert.equal(preview.rows[1]?.guardianMatch, 'file')
    assert.equal(preview.rows[1]?.notices[0]?.code, 'sibling_in_file')

    const response = await upload(cookie, file)
    assert.equal(response.statusCode, 201)
    const data = response.json().data as Result
    assert.equal(data.dryRun, false)
    assert.equal(data.readyCount, 2)
    assert.deepEqual(data.rows, [], 'onay yanıtı satır (kişisel veri) taşımaz')

    const state = await snapshot(institution.id)
    assert.equal(state.students.length, 2)
    assert.equal(state.parents.length, 1)
    assert.equal(state.identities, 2)
    assert.equal(state.bonds, 2)
    const parent = state.parents[0]?.data
    assert.equal(parent?.phone, '05321110020')
    assert.equal(parent?.relationship, 'mother')
    assert.deepEqual(
      new Set(parent?.studentIds as string[]),
      new Set(state.students.map((student) => student.id)),
    )
    const can = state.students.find((student) => student.data.name === 'Can Demir')
    assert.equal(can?.data.classId, 'c-5b-2')
    assert.equal(can?.data.phone, '', 'veli telefonu öğrenciye yazılmaz (DOM-KAY-003)')

    const bonds = await db
      .select()
      .from(studentGuardians)
      .where(
        and(
          eq(studentGuardians.institutionId, institution.id),
          isNull(studentGuardians.archivedAt),
        ),
      )
    assert.ok(bonds.every((bond) => bond.parentId === state.parents[0]?.id && bond.isPayer))
    assert.ok(bonds.every((bond) => bond.custody === 'full' && bond.relationship === 'mother'))

    const [identity] = await db
      .select()
      .from(studentIdentities)
      .where(
        and(
          eq(studentIdentities.institutionId, institution.id),
          eq(studentIdentities.identityNumber, first),
        ),
      )
    assert.equal(identity?.identityKind, 'tc')
    assert.equal(identity?.birthDate, '2013-03-14')
  })

  test('IST-007: mükerrer: aynı anahtar ilk yanıtı tekrarlar, yeni anahtarla ikinci yükleme kayıt açmaz', async () => {
    const { institution, cookie } = await kurum()
    const key = randomUUID()
    const number = nextId()
    const file = csv(`Ece Demir;7-A;${number};2013-03-14;Ayla Demir;05321110030;Anne`)
    const first = await upload(cookie, file, { key })
    assert.equal(first.statusCode, 201)
    const replay = await upload(cookie, file, { key })
    assert.equal(replay.statusCode, 201)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.deepEqual(replay.json(), first.json())

    const again = await upload(cookie, file)
    assert.equal(again.statusCode, 201)
    const data = again.json().data as Result
    assert.equal(data.readyCount, 0)
    assert.equal(data.skippedCount, 1)
    const state = await snapshot(institution.id)
    assert.equal(state.students.length, 1)
    assert.equal(state.parents.length, 1)
    assert.equal(state.identities, 1)
    assert.equal(state.bonds, 1)

    const reused = await upload(
      cookie,
      csv(`Can;7-A;${nextId()};2013-03-14;Ayla;05321110031;Anne`),
      {
        key,
      },
    )
    assert.equal(reused.statusCode, 422)
    assert.equal(reused.json().code, 'idempotency_key_reused')
  })

  test('DOM-KAY-013: sonraki yükleme kurumdaki veliye bağlar, ad farklıysa satır hatalı', async () => {
    const { institution, cookie } = await kurum()
    const phone = '05321110040'
    await upload(cookie, csv(`Ece Demir;7-A;${nextId()};2013-03-14;Ayla Demir;${phone};Anne`))
    const sibling = nextId()
    const preview = await upload(
      cookie,
      csv(`Can Demir;7-A;${sibling};2015-09-02;Ayla Demir;${phone};Anne`),
      { dryRun: true },
    )
    const row = (preview.json().data as Result).rows[0]
    assert.equal(row?.guardianMatch, 'existing')
    assert.equal(row?.notices[0]?.code, 'existing_guardian')

    const other = await upload(
      cookie,
      csv(`Mert Kaya;7-A;${nextId()};2015-09-02;Sena Kaya;${phone};Anne`),
      { dryRun: true },
    )
    assert.equal((other.json().data as Result).rows[0]?.issues[0]?.code, 'guardian_phone_conflict')

    const wrongRelation = await upload(
      cookie,
      csv(`Mert Demir;7-A;${nextId()};2015-09-02;Ayla Demir;${phone};Baba`),
      { dryRun: true },
    )
    assert.equal(
      (wrongRelation.json().data as Result).rows[0]?.issues[0]?.code,
      'guardian_relationship_conflict',
    )

    assert.equal(
      (await upload(cookie, csv(`Can Demir;7-A;${sibling};2015-09-02;Ayla Demir;${phone};Anne`)))
        .statusCode,
      201,
    )
    const state = await snapshot(institution.id)
    assert.equal(state.parents.length, 1)
    assert.equal(state.students.length, 2)
    assert.equal((state.parents[0]?.data.studentIds as string[]).length, 2)
  })

  test('DOM-ILT-070: velayetsiz ya da iletişim kısıtlı veliye bağlanmaz', async () => {
    const { institution, cookie } = await kurum()
    const phone = '05321110050'
    await upload(cookie, csv(`Ece Demir;7-A;${nextId()};2013-03-14;Ayla Demir;${phone};Anne`))
    await db
      .update(studentGuardians)
      .set({ isContactRestricted: true, custody: 'none', isPayer: false })
      .where(eq(studentGuardians.institutionId, institution.id))
    const response = await upload(
      cookie,
      csv(`Can Demir;7-A;${nextId()};2015-09-02;Ayla Demir;${phone};Anne`),
      { dryRun: true },
    )
    assert.equal((response.json().data as Result).rows[0]?.issues[0]?.code, 'parent_not_guardian')
  })

  test('DOM-KAY-010: kontenjanı aşan satır hatalı, sınıf açılmaz', async () => {
    const { institution, cookie } = await kurum()
    const lines = [1, 2, 3, 4].map(
      (index) =>
        `Öğrenci ${index};7-A;${nextId()};2013-03-14;Veli ${index};0532111006${index};Baba`,
    )
    const response = await upload(cookie, csv(...lines))
    assert.equal(response.statusCode, 422)
    assert.deepEqual(response.json().issues[0].path, ['rows', 5, 'className'])
    assert.equal(response.json().issues[0].code, 'class_capacity_full')
    await assertNothingWritten(institution.id)
  })

  test('DOM-KAY-012: kurumda başka adla ya da pasif öğrencide kayıtlı kimlik reddedilir', async () => {
    const { institution, cookie } = await kurum()
    const number = nextId()
    await upload(cookie, csv(`Ece Demir;7-A;${number};2013-03-14;Ayla Demir;05321110070;Anne`))
    const conflict = await upload(
      cookie,
      csv(`Başka Biri;7-A;${number};2013-03-14;Ayla Demir;05321110070;Anne`),
      { dryRun: true },
    )
    assert.equal(
      (conflict.json().data as Result).rows[0]?.issues[0]?.code,
      'student_identity_conflict',
    )
    const [student] = (await snapshot(institution.id)).students
    await insertMissingRecords(
      db,
      institution.id,
      [
        {
          collection: 'students',
          id: 's-pasif',
          data: {
            id: 's-pasif',
            name: 'Pasif Kaya',
            classId: 'c-7a',
            parentId: student?.data.parentId,
            email: '',
            phone: '',
            joinedAt: FIXED_NOW.toISOString(),
            isActive: false,
            progress: 0,
          },
        },
      ],
      FIXED_NOW,
    )
    const passive = nextId()
    await db.insert(studentIdentities).values({
      institutionId: institution.id,
      studentId: 's-pasif',
      academicYear: 2026,
      identityKind: 'tc',
      identityNumber: passive,
      birthDate: '2013-03-14',
    })
    const inactive = await upload(
      cookie,
      csv(`Pasif Kaya;7-A;${passive};2013-03-14;Ayla Demir;05321110070;Anne`),
      { dryRun: true },
    )
    assert.equal(
      (inactive.json().data as Result).rows[0]?.issues[0]?.code,
      'student_identity_inactive',
    )
  })

  test('DOM-KAY-012: kursta 18 yaş üstü kendi ödeyicisidir; okulda veli her yaşta zorunlu', async () => {
    const course = await kurum({ type: 'language_school' })
    const adult = await upload(
      course.cookie,
      base64(
        [
          'öğrenci adı;sınıf;kimlik no;doğum tarihi;veli adı;veli telefonu;yakınlık;öğrenci telefonu',
          `Kerem Uçar;7-A;${nextId()};1999-03-14;;;;05321110080`,
          `Lale Uçar;7-A;${nextId()};1999-03-14;Sena Uçar;05321110081;Anne;`,
        ].join('\n'),
      ),
      { dryRun: true },
    )
    const rows = (adult.json().data as Result).rows
    assert.equal(rows[0]?.status, 'ready')
    assert.equal(rows[0]?.guardianMatch, 'self')
    assert.equal(rows[1]?.issues[0]?.code, 'guardian_not_applicable')

    const written = await upload(
      course.cookie,
      base64(
        [
          'öğrenci adı;sınıf;kimlik no;doğum tarihi;öğrenci telefonu',
          `Kerem Uçar;7-A;${nextId()};1999-03-14;05321110080`,
        ].join('\n'),
      ),
    )
    assert.equal(written.statusCode, 201)
    const state = await snapshot(course.institution.id)
    assert.equal(state.parents[0]?.data.relationship, 'self')
    assert.equal(state.students[0]?.data.phone, '05321110080')
    assert.equal(state.bonds, 0, 'yetişkin kursiyerin kendisi veli değildir')

    const school = await kurum()
    const required = await upload(
      school.cookie,
      base64(
        [
          'öğrenci adı;sınıf;kimlik no;doğum tarihi',
          `Yaşlı Öğrenci;7-A;${nextId()};1999-03-14`,
        ].join('\n'),
      ),
      { dryRun: true },
    )
    assert.equal(
      (required.json().data as Result).rows[0]?.issues.some(
        (issue) => issue.code === 'guardian_name_required',
      ),
      true,
    )
  })

  test('IST-007: Excel dosyası sayı ve tarih hücreleriyle okunur, baştaki sıfırı düşen telefon düzelir', async () => {
    const { institution, cookie } = await kurum()
    const number = nextId()
    const response = await upload(
      cookie,
      base64(
        xlsxFile([
          [
            'öğrenci adı',
            'sınıf',
            'kimlik no',
            'doğum tarihi',
            'veli adı',
            'veli telefonu',
            'yakınlık',
          ],
          [
            'Ece Demir',
            '7-A',
            Number(number),
            { date: '2013-03-14' },
            'Ayla Demir',
            5321110090,
            'Anne',
          ],
        ]),
      ),
    )
    assert.equal(response.statusCode, 201, response.body)
    const state = await snapshot(institution.id)
    assert.equal(state.students[0]?.data.name, 'Ece Demir')
    assert.equal(state.parents[0]?.data.phone, '05321110090')
    const [identity] = await db
      .select()
      .from(studentIdentities)
      .where(eq(studentIdentities.institutionId, institution.id))
    assert.equal(identity?.identityNumber, number)
    assert.equal(identity?.birthDate, '2013-03-14')
  })

  test('IST-007: Windows-1254 CSV Türkçe okunur; eski .xls ve bozuk Excel reddedilir', async () => {
    const { institution, cookie } = await kurum()
    const text = `${HEADER}\nÇağrı Şen;7-A;${nextId()};2013-03-14;Gül Şen;05321110095;Anne`
    // Windows-1254: Ç=C7 ğ=F0 ı=FD Ş=DE ş=FE ö=F6 ü=FC Ü=DC İ=DD
    const map: Record<string, number> = {
      ç: 0xe7,
      Ç: 0xc7,
      ğ: 0xf0,
      ı: 0xfd,
      Ş: 0xde,
      ş: 0xfe,
      ö: 0xf6,
      ü: 0xfc,
    }
    const bytes = Uint8Array.from([...text].map((char) => map[char] ?? char.charCodeAt(0)))
    const preview = await upload(cookie, base64(bytes), { dryRun: true })
    assert.equal(preview.statusCode, 200, preview.body)
    assert.equal((preview.json().data as Result).rows[0]?.status, 'ready')

    const legacy = Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
    const old = await upload(cookie, base64(legacy), { dryRun: true })
    assert.equal(old.statusCode, 422)
    assert.equal(old.json().code, 'import_file_legacy_excel')

    const broken = await upload(cookie, base64(Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 1, 2])), {
      dryRun: true,
    })
    assert.equal(broken.statusCode, 422)
    assert.equal(broken.json().code, 'import_file_unreadable')

    const noHeader = await upload(cookie, base64('ad;soyad\nEce;Demir'), { dryRun: true })
    assert.equal(noHeader.statusCode, 422)
    assert.equal(noHeader.json().code, 'csv_unknown_column')
    await assertNothingWritten(institution.id)
  })

  test('IST-007: en çok 1.000 satır; fazlası 422, 1.000 satırlık dosya önizlenir', async () => {
    const { institution, cookie } = await kurum()
    const line = (index: number) =>
      `Öğrenci ${index};7-A;${turkishId(5000 + index)};2013-03-14;Veli ${index};05${String(320000000 + index)};Anne`
    const over = await upload(
      cookie,
      csv(...Array.from({ length: 1001 }, (_, index) => line(index))),
      { dryRun: true },
    )
    assert.equal(over.statusCode, 422)
    assert.equal(over.json().code, 'csv_too_many_rows')
    const full = await upload(
      cookie,
      csv(...Array.from({ length: 1000 }, (_, index) => line(index))),
      { dryRun: true },
    )
    assert.equal(full.statusCode, 200)
    assert.equal((full.json().data as Result).rowCount, 1000)
    await assertNothingWritten(institution.id)
  })

  test('IST-002: başka kurumun sınıfı, velisi ve kimliği bu kurumu etkilemez, institutionId gövdede 400', async () => {
    const b = await kurum()
    const a = await kurum()
    const number = nextId()
    const phone = '05321110100'
    assert.equal(
      (await upload(b.cookie, csv(`Ece Demir;7-A;${number};2013-03-14;Ayla Demir;${phone};Anne`)))
        .statusCode,
      201,
    )
    const before = await snapshot(b.institution.id)
    // A'da aynı kimlik ve telefon: B'nin kaydı görünmez, atlanmaz ve B'nin velisine bağlanmaz.
    const preview = await upload(
      a.cookie,
      csv(`Başka Ad;7-A;${number};2013-03-14;Başka Veli;${phone};Baba`),
      { dryRun: true },
    )
    const row = (preview.json().data as Result).rows[0]
    assert.equal(row?.status, 'ready')
    assert.equal(row?.guardianMatch, 'new')
    assert.equal(
      (await upload(a.cookie, csv(`Başka Ad;7-A;${number};2013-03-14;Başka Veli;${phone};Baba`)))
        .statusCode,
      201,
    )
    const after = await snapshot(b.institution.id)
    assert.deepEqual(after.parents, before.parents)
    assert.deepEqual(after.students, before.students)
    assert.equal(after.bonds, before.bonds)

    const injected = await upload(
      a.cookie,
      csv(`X Y;7-A;${nextId()};2013-03-14;V Y;05321110101;Anne`),
      {
        extra: { institutionId: b.institution.id },
      },
    )
    assert.equal(injected.statusCode, 400)
  })

  test('KVKK: denetime yalnız sayı ve alan adı, logda içerik ve kişisel veri yok', async () => {
    const logs: string[] = []
    const logged = await buildTestApp(db, { logs })
    try {
      const institution = await createInstitution(logged)
      await insertMissingRecords(
        db,
        institution.id,
        [
          {
            collection: 'branches',
            id: 'b-1',
            data: { id: 'b-1', name: 'Kadıköy', isActive: true },
          },
          {
            collection: 'classes',
            id: 'c-7a',
            data: {
              id: 'c-7a',
              name: '7-A',
              branchId: 'b-1',
              capacity: 3,
              grade: 7,
              isActive: true,
            },
          },
        ],
        FIXED_NOW,
      )
      const cookie = await signInAs(logged, institution.admin)
      const number = nextId()
      const phone = '05321110110'
      const file = csv(`Gizli Öğrenci;7-A;${number};2013-03-14;Gizli Veli;${phone};Anne`)
      const key = randomUUID()
      const response = await upload(cookie, file, { key, target: logged })
      assert.equal(response.statusCode, 201, response.body)
      await upload(cookie, csv(`Gizli Öğrenci;Yok;${number};2013-03-14;Gizli Veli;${phone};Anne`), {
        target: logged,
      })
      const text = logs.join('')
      for (const secret of [number, phone, 'Gizli', file])
        assert.ok(!text.includes(secret), `logda ${secret.slice(0, 6)} olmamalı`)

      const audits = await db
        .select({ action: auditLog.action, changes: auditLog.changes })
        .from(auditLog)
        .where(eq(auditLog.institutionId, institution.id))
      const main = audits.find((audit) => audit.action === 'student.import')
      assert.deepEqual((main?.changes as { counts: object }).counts, {
        rows: 1,
        students: 1,
        guardianLinks: 1,
      })
      const dump = JSON.stringify(audits)
      for (const secret of [number, phone, 'Gizli'])
        assert.ok(!dump.includes(secret), 'denetimde kişisel veri olmamalı')
    } finally {
      await logged.close()
    }
  })

  test('ON-128: hesaplı mevcut velinin yeni çocuğu hesaba bağlanır', async () => {
    const { institution, cookie } = await kurum()
    const phone = '05321110120'
    await upload(cookie, csv(`Ece Demir;7-A;${nextId()};2013-03-14;Ayla Demir;${phone};Anne`))
    const veli = await createMember(app, institution.id, 'veli')
    await db
      .update(studentGuardians)
      .set({ membershipId: veli.membershipId })
      .where(eq(studentGuardians.institutionId, institution.id))
    const response = await upload(
      cookie,
      csv(`Can Demir;7-A;${nextId()};2015-09-02;Ayla Demir;${phone};Anne`),
    )
    assert.equal(response.statusCode, 201, response.body)
    const links = await db
      .select({ recordId: membershipLinks.recordId })
      .from(membershipLinks)
      .where(
        and(
          eq(membershipLinks.institutionId, institution.id),
          eq(membershipLinks.membershipId, veli.membershipId),
          eq(membershipLinks.kind, 'child'),
        ),
      )
    assert.equal(links.length, 1)
  })
})
