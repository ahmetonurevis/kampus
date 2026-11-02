import { randomUUID } from 'node:crypto'

import { isCalendarDay } from '@kampus/school-core/lib/age.ts'
import { requireAuthorized } from '@kampus/school-core/lib/authorize.ts'
import {
  CONSENT_PURPOSE_KEYS,
  CONSENT_PURPOSES,
  type ConsentPurpose,
  type ConsentSubjectKind,
} from '@kampus/school-core/lib/consent-purposes.ts'
import {
  academicYearEndsAt,
  consentGrantor,
  hasValidConsent,
  mayWithdrawConsent,
  planConsent,
  planConsentWithdrawal,
  type ConsentActor,
  type ConsentClosure,
  type ConsentDraft,
  type ConsentStudent,
  type GiveConsentInput,
  type GuardianBond,
} from '@kampus/school-core/lib/consents.ts'
import type { ActorLink } from '@kampus/school-core/lib/scope.ts'
import { OPERATION_COMMANDS } from '@kampus/school-core/modules/commands.ts'

import type { Role } from '../auth.ts'
import type { Database } from '../db/client.ts'
import { scheduleSubjectFilesPurge } from '../db/files.ts'
import {
  closeConsent,
  findConsent,
  insertConsent,
  listConsentsOfSubject,
  listPrivacyNotices,
  type StoredConsent,
} from '../db/privacy.ts'
import { findRecord } from '../db/records.ts'
import { ConflictError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { environment } from './commands.ts'
import { getInstitution, listMembershipLinks, listStudentAccountUserIds } from './memberships.ts'
import {
  runCommand,
  runReadOnly,
  type CommandResponse,
  type IdempotencyRequest,
} from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Açık rıza (IST-017; docs/domain/yetki-ve-kapsam.md DOM-YTK-057…062; guvenlik-kvkk §9). Kural
 * core `lib/consents.ts`'tedir (`planConsent`, `planConsentWithdrawal`, `hasValidConsent`); tablo
 * `consents` (migration 0024), depo `db/privacy.ts`. Rıza platform yeteneğidir, modül kapatılamaz.
 *
 * Yazmalar tek transaction'da ve kurum kilidi altındadır (`runCommand`): yenilenen eski satırın
 * kapanışı, yeni satır, geri çekmede rızaya dayalı dosyaların imha işareti ve denetim kaydı
 * birlikte yazılır ya da hiçbiri yazılmaz. Denetime yalnız alan adları düşer; öğrenci kimliği,
 * doğum tarihi ve amaç loglanmaz.
 */

const ENTITY = 'consent'

/**
 * Velinin çocuklarıyla bağı (DOM-YTK-025, DOM-YTK-057). Üyelik bağlantısı (`child`) kurum
 * tarafından kurulur ve doğrulanmış sayılır. Velayet kararının tek noktası budur.
 *
 * TODO(OG-031-velayet): üyelik bağlantısı bugün velayet bilgisi taşımıyor; doğrulanmış her veli
 * bağı velayetli sayılıyor. OG-031 (`linkGuardian`) velayeti bağa yazınca velayetsiz ebeveyn
 * burada `custody: false` alır ve rıza vermesi 403 `consent_custody_required` olur.
 */
export function guardianBondsOf(links: readonly ActorLink[]): GuardianBond[] {
  return links
    .filter((link) => link.kind === 'child')
    .map((link) => ({ studentId: link.recordId, verified: true, custody: true }))
}

/** Öğrencinin kendi kaydı (`student` bağlantısı); yoksa `undefined`. */
const ownStudentId = (links: readonly ActorLink[]) =>
  links.find((link) => link.kind === 'student')?.recordId

/**
 * Rızanın veri sahibi öğrenci: güncel doğum tarihiyle (DOM-YTK-057). Geçersiz ya da boş doğum
 * tarihi bilinmiyor sayılır (öğrenci 18 yaş altıdır). Olmayan ya da arşivli kayıt `null`.
 */
export async function consentStudentOf(
  tx: Database,
  institutionId: string,
  studentId: string | undefined,
): Promise<ConsentStudent | null> {
  if (studentId === undefined) return null
  const record = await findRecord(tx, institutionId, 'students', studentId)
  if (record === null) return null
  const birthDate = record.data.birthDate
  return {
    id: record.id,
    birthDate: typeof birthDate === 'string' && isCalendarDay(birthDate) ? birthDate : null,
  }
}

async function consentActorOf(tx: Database, ctx: ServiceContext): Promise<ConsentActor> {
  const links = await listMembershipLinks(tx, ctx.institutionId, ctx.actor.membershipId)
  return { role: ctx.actor.role, links, userId: ctx.actor.userId }
}

/**
 * Rızayı veren kullanıcının kimliğini görebilen roller (kişisel veri, K): kurum adına kaydı
 * yürüten yönetici ve ön büro. Veli ve öğrenci yalnız ilişkiyi (`grantorRelation`) görür; aynı
 * öğrencinin öbür velisinin ya da velinin hesap kimliği onlara açılmaz.
 */
const GRANTOR_VISIBLE_ROLES: readonly Role[] = ['yonetici', 'onburo']

/**
 * Satırın yanıt görünümü. `canWithdraw` çağıranın hesapladığı geri çekme yetkisidir
 * (`withdrawable`); ekran düğmeyi buna göre gösterir.
 */
export function consentView(row: StoredConsent, viewer: Role, canWithdraw: boolean) {
  return {
    id: row.id,
    subjectKind: row.subjectKind,
    subjectId: row.subjectId,
    purpose: row.purpose,
    decision: row.decision,
    ...(GRANTOR_VISIBLE_ROLES.includes(viewer) ? { grantedByUserId: row.grantedByUserId } : {}),
    grantorRelation: row.grantorRelation,
    textId: row.textId,
    textVersion: row.textVersion,
    channel: row.channel,
    givenAt: row.givenAt,
    expiresAt: row.expiresAt,
    withdrawnAt: row.withdrawnAt,
    withdrawalReason: row.withdrawalReason,
    canWithdraw,
    rowVersion: row.rowVersion,
  }
}

/** Satır açık ve aktör geri çekme yetkisinde (core `mayWithdrawConsent`, DOM-YTK-059). */
function withdrawable(
  row: StoredConsent,
  actor: ConsentActor,
  student: ConsentStudent | null,
  now: string,
) {
  return (
    row.withdrawnAt === null &&
    mayWithdrawConsent({
      actor,
      consent: row,
      student,
      guardianBonds: guardianBondsOf(actor.links),
      now,
    })
  )
}

const subjectKindOf = (studentId: string | undefined): ConsentSubjectKind =>
  studentId === undefined ? 'user' : 'student'

const purposesOf = (kind: ConsentSubjectKind) =>
  CONSENT_PURPOSE_KEYS.filter((purpose) => CONSENT_PURPOSES[purpose].subject === kind)

/**
 * Rıza ya da itiraz verir (IST-017; DOM-YTK-057, -058, -062). Öğrenci amaçlarında `studentId`
 * veri sahibidir; hesap amaçlarında veri sahibi oturumdaki kullanıcıdır (18 yaşını doldurmuş
 * öğrencinin yaşı kendi kaydından okunur). Eğitim yılı amaçlarının bitişi kurum ayarındaki eğitim
 * yılından gelir (`academicYearEndsAt`). Süresi dolmuş ya da yeniden rıza gerektiren eski satır
 * aynı işlemde `renewed` ile kapanır. Başarı 201.
 */
export function giveConsent(
  ctx: ServiceContext,
  input: GiveConsentInput,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  type Planned = { consent: ConsentDraft; close: ConsentClosure[] }
  const id = randomUUID()
  const out: { body?: unknown } = {}
  let open: StoredConsent[] = []
  let giver: { actor: ConsentActor; student: ConsentStudent | null } | null = null
  return runCommand<Planned>(
    ctx,
    {
      action: 'consent.give',
      collections: [],
      entity: { type: ENTITY, id },
      load: async (tx) => {
        const actor = await consentActorOf(tx, ctx)
        const user = CONSENT_PURPOSES[input.purpose].subject === 'user'
        const studentId = user ? ownStudentId(actor.links) : input.studentId
        const [student, texts, institution] = await Promise.all([
          consentStudentOf(tx, ctx.institutionId, studentId),
          listPrivacyNotices(tx, ctx.institutionId),
          getInstitution(tx, ctx.institutionId),
        ])
        const subject = user
          ? { kind: 'user' as const, id: ctx.actor.userId }
          : { kind: 'student' as const, id: input.studentId ?? '' }
        open =
          subject.id === ''
            ? []
            : (
                await listConsentsOfSubject(tx, ctx.institutionId, { ...subject, openOnly: true })
              ).filter((row) => row.purpose === input.purpose)
        const yearEnd =
          institution?.academicYear == null ? null : academicYearEndsAt(institution.academicYear)
        giver = { actor, student: user ? null : student }
        return {
          run: (_state, { now }) =>
            planConsent({
              actor,
              student,
              guardianBonds: guardianBondsOf(actor.links),
              texts,
              consents: open,
              input,
              now,
              academicYearEndsAt: yearEnd,
            }),
        }
      },
      after: async (tx, plan) => {
        for (const closure of plan.close) {
          const row = open.find((item) => item.id === closure.id)
          if (row === undefined) throw new Error('renewed consent was not loaded')
          if (
            !(await closeConsent(
              tx,
              ctx.institutionId,
              { ...closure, rowVersion: row.rowVersion },
              ctx.now,
            ))
          )
            throw new ConflictError()
          await auditWork(tx, ctx, 'consent.renew', { type: ENTITY, id: closure.id }, [
            'withdrawnAt',
            'withdrawnByUserId',
            'withdrawalReason',
          ])
        }
        await insertConsent(tx, ctx.institutionId, { id, ...plan.consent }, ctx.now)
        await auditWork(tx, ctx, 'consent.give', { type: ENTITY, id }, [
          'subjectKind',
          'subjectId',
          'purpose',
          'decision',
          'grantorRelation',
          'textId',
          'textVersion',
          'channel',
          'givenAt',
          'expiresAt',
        ])
        const saved = await findConsent(tx, ctx.institutionId, id)
        if (saved === null) throw new Error('consent disappeared after insert')
        if (giver === null) throw new Error('consent actor was not loaded')
        out.body = {
          data: consentView(
            saved,
            ctx.actor.role,
            withdrawable(saved, giver.actor, giver.student, ctx.now.toISOString()),
          ),
        }
      },
    },
    () => {
      if (out.body === undefined) throw new Error('consent was not written')
      return { statusCode: 201, body: out.body }
    },
    idempotency,
  )
}

/**
 * Rızayı ya da itirazı geri çeker (DOM-YTK-059): tek işlem, anında etkili; ikinci geri çekme 409
 * `consent_already_withdrawn`. Kapsam dışı ya da başka kurumun satırı 404. Geri çekilen rıza
 * dosya yüklemesine dayanıyorsa (`speaking_recording`) veri sahibinin o amaçtaki dosyaları aynı
 * işlemde imhaya işaretlenir (ADR 0003 karar 9, 13: `retention_until = now`): kayda bağlanmış
 * dosyalar (`data_subject_id`) ve öğrencinin hesabının yüklediği henüz bağlanmamış dosyalar.
 *
 * TODO(F3c2-imha): saklama sonu gelen dosyayı silen `pg-boss` imha işi henüz yok (`src/jobs` ve
 * zamanlayıcı kurulmadı; `purgeUnattachedFiles` yalnız bağlanmamış dosyayı siler). İş kurulunca
 * `retention_until <= now` dosyalar oradan silinir; bu işaret kuyruğun girdisidir. Bağlanmamış
 * kayıt ayrıca 24 saatlik bağlanmamış dosya temizliğiyle (karar 5) silinir; geri çekmeden sonra
 * bağlanamaz (`attachFile` rızayı yeniden denetler).
 */
export function withdrawConsent(
  ctx: ServiceContext,
  consentId: string,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const out: { body?: unknown } = {}
  let current: StoredConsent | null = null
  return runCommand<ConsentClosure>(
    ctx,
    {
      action: 'consent.withdraw',
      collections: [],
      entity: { type: ENTITY, id: consentId },
      load: async (tx) => {
        const actor = await consentActorOf(tx, ctx)
        current = await findConsent(tx, ctx.institutionId, consentId)
        const consent = current
        const student =
          consent?.subjectKind === 'student'
            ? await consentStudentOf(tx, ctx.institutionId, consent.subjectId)
            : null
        return {
          run: (_state, { now }) =>
            planConsentWithdrawal({
              actor,
              consent,
              student,
              guardianBonds: guardianBondsOf(actor.links),
              input: { consentId },
              now,
            }),
        }
      },
      after: async (tx, closure) => {
        const consent = current
        if (consent === null) throw new Error('withdrawn consent was not loaded')
        if (
          !(await closeConsent(
            tx,
            ctx.institutionId,
            { ...closure, rowVersion: consent.rowVersion },
            ctx.now,
          ))
        )
          throw new ConflictError()
        await auditWork(tx, ctx, 'consent.withdraw', { type: ENTITY, id: consent.id }, [
          'withdrawnAt',
          'withdrawnByUserId',
          'withdrawalReason',
        ])
        if (
          consent.purpose === 'speaking_recording' &&
          consent.decision === 'granted' &&
          consent.subjectKind === 'student'
        ) {
          const marked = await scheduleSubjectFilesPurge(
            tx,
            ctx.institutionId,
            {
              purpose: 'speaking_recording',
              dataSubjectId: consent.subjectId,
              uploaderUserIds: await listStudentAccountUserIds(
                tx,
                ctx.institutionId,
                consent.subjectId,
              ),
            },
            ctx.now,
          )
          for (const fileId of marked)
            await auditWork(tx, ctx, 'file.purge_scheduled', { type: 'file', id: fileId }, [
              'retentionUntil',
            ])
          ctx.log.info({ event: 'consent.files_purge_scheduled', count: marked.length })
        }
        const saved = await findConsent(tx, ctx.institutionId, consent.id)
        if (saved === null) throw new Error('consent disappeared after withdrawal')
        // Geri çekilmiş satır yeniden geri çekilemez.
        out.body = { data: consentView(saved, ctx.actor.role, false) }
      },
    },
    () => {
      if (out.body === undefined) throw new Error('consent was not withdrawn')
      return { statusCode: 200, body: out.body }
    },
    idempotency,
  )
}

/** Okumada veri sahibi: öğrenci kimliği varsa öğrenci, yoksa aktörün kendi hesabı. */
function readSubject(ctx: ServiceContext, studentId: string | undefined) {
  return studentId === undefined
    ? { kind: 'user' as const, id: ctx.actor.userId }
    : { kind: 'student' as const, id: studentId }
}

/**
 * Okuma kapsamı (core `consent.read` / `consent.status`): yönetici ve ön büro kurumun, öğretmen
 * yalnız ders verdiği sınıfların, veli bağlı çocuklarının, öğrenci kendi öğrencisinin sonucunu
 * okur; kapsam dışı öğrenci 404 (DOM-YTK-057, yetki matrisi "Fotoğraf/video rızası").
 */
function readWithScope<R>(
  ctx: ServiceContext,
  action: 'consent.read' | 'consent.status',
  studentId: string | undefined,
  read: (tx: Database) => Promise<(now: string) => R>,
): Promise<R> {
  const spec = OPERATION_COMMANDS[action]
  return runReadOnly(ctx, {
    action,
    collections: spec.collections,
    load: async (tx) => {
      const { actor, institutionType, scalars } = await environment(tx, ctx, spec)
      const finish = await read(tx)
      return {
        scalars,
        run: (state, { now }) => {
          requireAuthorized(actor, action, { studentId }, state, { institutionType })
          return finish(now)
        },
      }
    },
  })
}

export interface ConsentListInput {
  studentId?: string | undefined
  purpose?: ConsentPurpose | undefined
  status: 'open' | 'all'
  page: number
  pageSize: number
}

/**
 * Veri sahibinin rıza satırları, amaç ve veriliş sırasıyla (DOM-ILT-034). `studentId` yoksa
 * aktörün kendi hesap rızaları. `status=open` geri çekilmemiş satırlar (varsayılan), `all`
 * geçmiş dahil. Satırın bugün geçerli sayılıp sayılmadığı `GET /consents/status`'tadır.
 */
export async function listConsents(ctx: ServiceContext, input: ConsentListInput) {
  const subject = readSubject(ctx, input.studentId)
  const rows = await readWithScope(ctx, 'consent.read', input.studentId, async (tx) => {
    const [all, actor, student] = await Promise.all([
      listConsentsOfSubject(tx, ctx.institutionId, {
        ...subject,
        openOnly: input.status === 'open',
      }),
      consentActorOf(tx, ctx),
      consentStudentOf(tx, ctx.institutionId, input.studentId),
    ])
    return (now: string) =>
      all
        .filter((row) => input.purpose === undefined || row.purpose === input.purpose)
        .map((row) => consentView(row, ctx.actor.role, withdrawable(row, actor, student, now)))
  })
  const start = (input.page - 1) * input.pageSize
  return { items: rows.slice(start, start + input.pageSize), total: rows.length }
}

/**
 * Amaç başına geçerli rıza sonucu (DOM-YTK-061): yalnız var/yok. Öğretmen satırları değil yalnız
 * bunu görür. `studentId` yoksa aktörün hesap amaçları.
 */
export function consentStatus(
  ctx: ServiceContext,
  input: { studentId?: string | undefined; purpose?: ConsentPurpose | undefined },
) {
  const subject = readSubject(ctx, input.studentId)
  const purposes = purposesOf(subjectKindOf(input.studentId)).filter(
    (purpose) => input.purpose === undefined || purpose === input.purpose,
  )
  return readWithScope(ctx, 'consent.status', input.studentId, async (tx) => {
    // Hesap amacında rızayı kimin verdiği hesap sahibinin kendi öğrenci kaydının yaşına bağlıdır.
    const ownStudent =
      subject.kind === 'user' && ctx.actor.role === 'ogrenci'
        ? ownStudentId(await listMembershipLinks(tx, ctx.institutionId, ctx.actor.membershipId))
        : undefined
    const [rows, texts, student, account] = await Promise.all([
      listConsentsOfSubject(tx, ctx.institutionId, subject),
      listPrivacyNotices(tx, ctx.institutionId),
      consentStudentOf(tx, ctx.institutionId, input.studentId),
      ctx.actor.role === 'ogrenci'
        ? consentStudentOf(tx, ctx.institutionId, ownStudent)
        : Promise.resolve(null),
    ])
    // Öğretmen yalnız var/yok görür (DOM-YTK-061); kimin verdiği formu gösteren rollere döner.
    const showGrantor = ctx.actor.role !== 'ogretmen'
    const grantorOf = (purpose: ConsentPurpose, now: string) =>
      subject.kind === 'student'
        ? consentGrantor({ purpose, student, now })
        : // Öğrenci hesabının kaydı bulunamazsa 18 yaş altı sayılır (rıza alınmaz).
          ctx.actor.role === 'ogrenci' && account === null
          ? null
          : consentGrantor({ purpose, student: account, now })
    return (now: string) =>
      purposes.map((purpose) => ({
        purpose,
        valid:
          subject.kind === 'user'
            ? hasValidConsent(
                rows,
                { purpose, subject: { kind: 'user', userId: subject.id }, texts },
                now,
              )
            : student !== null &&
              hasValidConsent(rows, { purpose, subject: { kind: 'student', student }, texts }, now),
        ...(showGrantor ? { grantor: grantorOf(purpose, now) } : {}),
      }))
  })
}

/**
 * Aktörün kendi öğrenci kaydı (`student` bağlantısı) ve bu amaçta geçerli rıza var mı (dosya
 * yükleme ve bağlama; ADR 0003 karar 9, DOM-YTK-061). 18 yaş altında velinin, 18 ve üstünde
 * öğrencinin kendi rızası sayılır (core `hasValidConsent`, yaş güncel doğum tarihinden). Öğrenci
 * bağlantısı olmayan aktör için `{ studentId: null, valid: false }`. Çağıranın işlemiyle okur.
 */
export async function actorStudentConsent(
  tx: Database,
  ctx: ServiceContext,
  purpose: ConsentPurpose,
): Promise<{ studentId: string | null; valid: boolean }> {
  const links = await listMembershipLinks(tx, ctx.institutionId, ctx.actor.membershipId)
  const student = await consentStudentOf(tx, ctx.institutionId, ownStudentId(links))
  if (student === null) return { studentId: null, valid: false }
  const [rows, texts] = await Promise.all([
    listConsentsOfSubject(tx, ctx.institutionId, { kind: 'student', id: student.id }),
    listPrivacyNotices(tx, ctx.institutionId),
  ])
  return {
    studentId: student.id,
    valid: hasValidConsent(
      rows,
      { purpose, subject: { kind: 'student', student }, texts },
      ctx.now.toISOString(),
    ),
  }
}

/** `actorStudentConsent` kendi işlemiyle; yalnız sonuç (yükleme öncesi denetim). */
export async function actorStudentHasConsent(
  ctx: ServiceContext,
  purpose: ConsentPurpose,
): Promise<boolean> {
  return ctx.db.transaction(async (tx) => (await actorStudentConsent(tx, ctx, purpose)).valid)
}
