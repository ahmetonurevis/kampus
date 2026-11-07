import { randomBytes, randomUUID } from 'node:crypto'

import { eq, sql } from 'drizzle-orm'
import type { FastifyBaseLogger } from 'fastify'

import { dayKey } from '@kampus/school-core/lib/format.ts'
import {
  APPLICATION_DAILY_PROSPECT_LIMIT,
  APPLICATION_DAILY_REJECTED_LIMIT,
  applicationFrameAncestors,
  applicationNoticeVersion,
  isApplicationFormKey,
  isHoneypotFilled,
  submitProspectApplication,
  type ProspectApplicationOutcome,
  type ProspectApplicationState,
} from '@kampus/school-core/lib/prospect-application-form.ts'
import { DomainError } from '@kampus/school-core/lib/errors.ts'
import { latestNotice, type PrivacyNotice } from '@kampus/school-core/lib/privacy-notices.ts'
import { prospectAgeGroupRequired } from '@kampus/school-core/lib/prospects.ts'

import type { Database } from '../db/client.ts'
import type { RecordData } from '../db/collections.ts'
import { planPositions } from '../db/positions.ts'
import { listPrivacyNotices } from '../db/privacy.ts'
import {
  APPLICATION_NOTE_ACTION,
  APPLICATION_PROSPECT_ACTION,
  APPLICATION_REJECTED_ACTION,
  countApplicationEvents,
  findApplicationForm,
  findApplicationFormByKey,
  insertApplicationForm,
  updateApplicationFormRow,
  type ApplicationFormRow,
} from '../db/prospect-application-forms.ts'
import { lockInstitution, loadRecords, type RecordWrite, type StoredRecord } from '../db/records.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import { institutions } from '../db/schema/auth.ts'
import {
  AppError,
  ConflictError,
  databaseErrorInfo,
  MESSAGES,
  NotFoundError,
  TransientConflictError,
  withDatabaseErrors,
} from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { dayRange } from './list-filters.ts'
import { getInstitutionModules } from './modules.ts'
import {
  loadOperationRecords,
  mapOperationError,
  writeOperationRecords,
} from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Kurum sitesine gömülen ön başvuru formu (ON-133; docs/domain/kayit-ve-crm.md DOM-KAY-002, -003,
 * -004, -007, -009; IST-145). Kurallar core `lib/prospect-application-form.ts`'tedir.
 *
 * Açık uçlarda kimlik yoktur: kurum yalnız form anahtarından çözülür, istemcinin kurum bilgisi
 * okunmaz. Biçimi bozuk anahtar, yenilenmiş ya da bilinmeyen anahtar, kapalı form, kapalı `crm`
 * modülü, yayımlanmış aday aydınlatması ya da aktif kampüs olmaması dışarıdan aynı 404'tür.
 *
 * Yazma, ön büronun aday açmasıyla aynı kuralları izler (kurum kilidi, bütün adayları yükleme, tek
 * transaction, sürümlü yazma, denetim satırı), ama `runOperation`'dan geçmez: çalıştırıcı denetim
 * aktörünü üyeliği olan bir kullanıcı olarak alır, burada ise kullanıcı yoktur. Denetimde
 * `actor_user_id` boştur (işlem geçmişinde "Sistem") ve rol `APPLICATION_FORM_ACTOR_ROLE`'dür;
 * telefon, e-posta ve ad log ve denetime girmez (alan adları).
 *
 * Kurum günlük tavanı doluyken başvuru alınmaz, başvurana 422 `application_unavailable` döner ve
 * yöneticinin ayar yanıtında uyarı görünür (DOM-KAY-002, K-23). Dolu olduğu gün kaydı ayrı tutulmaz,
 * tavan sayımından türer; alınamayan başvuru yalnız kişisel veri taşımayan bir denetim satırıdır.
 */

/** Açık uçtan gelen yazmanın denetim rolü; hiçbir üyelik rolü bu işlemi yapmış görünmez. */
export const APPLICATION_FORM_ACTOR_ROLE = 'system'

/** Kurum kilidinde en çok bekleme: açık uç, kuyruğu uzatıp finans işlemlerini bekletemesin. */
const APPLICATION_LOCK_TIMEOUT = sql`set local lock_timeout = '3s'`
/** `lock_timeout` aşımının SQLSTATE'i. */
const LOCK_NOT_AVAILABLE = '55P03'

const ENTITY = 'prospect_application_form'

/** Başvuranın gördüğü ret: dürüsttür ama tavanı ve sayıyı söylemez (K-23). */
const APPLICATION_UNAVAILABLE_MESSAGE =
  'Başvurunuz şu anda alınamadı. Lütfen kurumla doğrudan iletişime geçin.'

const newFormKey = () => randomBytes(24).toString('base64url')

async function currentCandidateNotice(
  db: Database,
  institutionId: string,
): Promise<PrivacyNotice | null> {
  return latestNotice(await listPrivacyNotices(db, institutionId), {
    kind: 'notice',
    audience: 'aday',
  })
}

// --- Yönetici ------------------------------------------------------------------------------

/** Bugün (Europe/Istanbul) formdan açılan aday ve alınamayan başvuru; yalnız denetim indeksi okunur. */
async function todayApplicationEvents(db: Database, institutionId: string, now: Date) {
  const day = dayKey(now)
  const range = dayRange('createdAt', day, day)
  if (range?.fromInstant == null || range.toInstant == null) return { opened: 0, rejected: 0 }
  return countApplicationEvents(
    db,
    institutionId,
    new Date(range.fromInstant),
    new Date(range.toInstant),
  )
}

async function dailyLimitStatus(db: Database, institutionId: string, now: Date) {
  const { opened, rejected } = await todayApplicationEvents(db, institutionId, now)
  return { reached: opened >= APPLICATION_DAILY_PROSPECT_LIMIT, rejected }
}

function settingsView(
  row: ApplicationFormRow | null,
  notice: PrivacyNotice | null,
  dailyLimit: Awaited<ReturnType<typeof dailyLimitStatus>>,
) {
  return {
    enabled: row?.enabled ?? false,
    formKey: row?.formKey ?? null,
    siteOrigin: row?.siteOrigin ?? null,
    version: row?.version ?? null,
    noticeVersion: notice?.version ?? null,
    dailyLimit,
  }
}

/** Yöneticinin form görünümü; satır ilk anahtar üretilene kadar yoktur. */
export async function applicationFormSettings(ctx: ServiceContext) {
  const [row, notice, dailyLimit] = await Promise.all([
    findApplicationForm(ctx.db, ctx.institutionId),
    currentCandidateNotice(ctx.db, ctx.institutionId),
    dailyLimitStatus(ctx.db, ctx.institutionId, ctx.now),
  ])
  return settingsView(row, notice, dailyLimit)
}

/**
 * Formu açar/kapatır, site adresini yazar. Aydınlatması yayımlanmamış form açılamaz (DOM-KAY-003):
 * 422 `application_form_notice_missing`. İlk anahtar üretilmeden satır yoktur: 404.
 */
export function updateApplicationForm(
  ctx: ServiceContext,
  input: { enabled?: boolean | undefined; siteOrigin?: string | null | undefined },
  expectedVersion: number,
) {
  const work = ctx.db.transaction(async (tx) => {
    await lockInstitution(tx, ctx.institutionId)
    const row = await findApplicationForm(tx, ctx.institutionId)
    if (row === null) throw new NotFoundError()
    const notice = await currentCandidateNotice(tx, ctx.institutionId)
    if (input.enabled === true && notice === null)
      throw mapOperationError(
        new DomainError(
          'application_form_notice_missing',
          'Form açılmadan önce aday aydınlatma metnini yayımlayın.',
          { path: ['enabled'] },
        ),
      )
    const values = {
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
      ...(input.siteOrigin === undefined ? {} : { siteOrigin: input.siteOrigin }),
    }
    const updated = await updateApplicationFormRow(
      tx,
      ctx.institutionId,
      expectedVersion,
      values,
      ctx.now,
    )
    if (updated === null) throw new ConflictError()
    await auditWork(
      tx,
      ctx,
      'prospect.application_form.update',
      { type: ENTITY, id: ctx.institutionId },
      Object.keys(values),
    )
    return settingsView(updated, notice, await dailyLimitStatus(tx, ctx.institutionId, ctx.now))
  })
  return withDatabaseErrors(work)
}

/**
 * İlk anahtarı üretir ya da anahtarı yeniler; eski anahtar aynı anda geçersiz olur ve eski gömme
 * kodu 404 alır. Satır varken `If-Match` zorunludur (bayat ekrandan iki kez yenileme, yeni kodu
 * kopyalanmış siteyi kırar); ilk üretimde sürüm yoktur. Form ilk üretimde kapalı başlar.
 */
export function rotateApplicationFormKey(ctx: ServiceContext, expectedVersion: number | null) {
  const work = ctx.db.transaction(async (tx) => {
    await lockInstitution(tx, ctx.institutionId)
    const row = await findApplicationForm(tx, ctx.institutionId)
    if (row !== null && expectedVersion === null)
      throw new AppError(400, 'if_match_required', MESSAGES.if_match_required)
    const key = newFormKey()
    const written =
      row === null
        ? await insertApplicationForm(tx, ctx.institutionId, key, ctx.now)
        : await updateApplicationFormRow(
            tx,
            ctx.institutionId,
            expectedVersion ?? row.version,
            { formKey: key },
            ctx.now,
          )
    if (written === null) throw new ConflictError()
    // Anahtar değeri denetime yazılmaz, yalnız alan adı.
    await auditWork(
      tx,
      ctx,
      'prospect.application_form.rotate_key',
      { type: ENTITY, id: ctx.institutionId },
      ['formKey'],
    )
    return settingsView(
      written,
      await currentCandidateNotice(tx, ctx.institutionId),
      await dailyLimitStatus(tx, ctx.institutionId, ctx.now),
    )
  })
  return withDatabaseErrors(work)
}

// --- Açık uçlar ----------------------------------------------------------------------------

/** Dışarıya açık form: yalnız etkin anahtar ve `crm` modülü açıkken. */
async function resolveOpenForm(db: Database, formKey: string) {
  if (!isApplicationFormKey(formKey)) return null
  const row = await findApplicationFormByKey(db, formKey)
  if (row === null || !row.enabled) return null
  const institution = await getInstitutionModules(db, row.institutionId)
  if (institution === null || institution.modules.crm !== true) return null
  return { row, institutionType: institution.type }
}

/**
 * Formu gösteren veri: kurum adı, aktif kampüsler, güncel aydınlatma metni. Metni olmayan ya da
 * kampüsü kalmayan form açık değildir; başvuru hiçbir aydınlatma görmeden alınamaz (DOM-KAY-003).
 */
export async function publicApplicationForm(db: Database, formKey: string) {
  const form = await resolveOpenForm(db, formKey)
  if (form === null) throw new NotFoundError()
  const { institutionId, siteOrigin } = form.row
  const [notice, branches, [institution]] = await Promise.all([
    currentCandidateNotice(db, institutionId),
    loadRecords(db, institutionId, ['branches']),
    db
      .select({ name: institutions.name })
      .from(institutions)
      .where(eq(institutions.id, institutionId))
      .limit(1),
  ])
  const active = branches.flatMap((branch) =>
    branch.data.isActive === true && typeof branch.data.name === 'string'
      ? [{ id: branch.id, name: branch.data.name }]
      : [],
  )
  if (notice === null || active.length === 0 || institution === undefined) throw new NotFoundError()
  return {
    institutionName: institution.name,
    asksAgeGroup: prospectAgeGroupRequired(form.institutionType),
    siteOrigin,
    branches: active,
    notice: {
      version: applicationNoticeVersion(notice.version),
      title: notice.title,
      body: notice.body,
    },
  }
}

/**
 * Formun gömülebileceği üst pencere: statik sunucu sayfanın `frame-ancestors`'ünü buradan okur.
 * Hep başarıdır; geçersiz anahtar ve kapalı form `'none'` alır, sayfa da 404'ü API'den gösterir.
 */
export async function applicationFramePolicy(db: Database, formKey: string) {
  const form = await resolveOpenForm(db, formKey)
  return applicationFrameAncestors(form?.row.siteOrigin)
}

export interface PublicApplicationContext {
  db: Database
  now: Date
  log: FastifyBaseLogger
}

/** Kayıt düzeyinde fark: adaylarda yalnız başvurunun dokunduğu kayıt yazılır (ve yer değişenler). */
function applicationWrites(
  outcome: ProspectApplicationOutcome,
  prospects: ProspectApplicationState['prospects'],
  stored: ReadonlyMap<string, StoredRecord>,
): { writes: RecordWrite[]; fields: string[] } {
  if (outcome.kind === 'ignored') return { writes: [], fields: [] }
  const prospect = prospects.find((item) => item.id === outcome.prospectId)
  if (prospect === undefined) return { writes: [], fields: [] }
  const collection = 'prospects'
  const id = prospect.id
  // Çalıştırıcıdaki gibi JSON biçimi: `undefined` alan ne yazılır ne denetime girer.
  const data = JSON.parse(JSON.stringify(prospect)) as RecordData
  if (outcome.kind === 'noted') {
    const old = stored.get(id)
    if (old === undefined) return { writes: [], fields: [] }
    return {
      writes: [{ kind: 'update', collection, id, data, expectedVersion: old.version }],
      fields: ['notes', 'updatedAt'],
    }
  }
  // Core yeni adayı başa koyar; yerinde kalan kayıtlara yazılmaz, sığmazsa sıra yeniden dağılır.
  const positions = planPositions(prospects.map((item) => stored.get(item.id)?.position ?? null))
  const writes = prospects.flatMap((item, index): RecordWrite[] => {
    const position = positions[index] ?? 0
    if (item.id === id) return [{ kind: 'insert', collection, id, data, position }]
    const old = stored.get(item.id)
    return old === undefined || old.position === position
      ? []
      : [{ kind: 'move', collection, id: item.id, position, expectedVersion: old.version }]
  })
  return { writes, fields: Object.keys(data).sort() }
}

async function dailyLimitReached(db: Database, institutionId: string, now: Date) {
  const { opened } = await todayApplicationEvents(db, institutionId, now)
  return opened >= APPLICATION_DAILY_PROSPECT_LIMIT
}

/** Kilit altında kararı transaction dışına taşır: ret satırı geri alınmasın, kilit beklemesin. */
const OVER_LIMIT = 'over_limit'

/**
 * Tavan doluyken gönderim (K-23): başvuru saklanmaz, yalnız sayılır. Gövde, ad ve iletişim buraya hiç
 * gelmez. Sayım tavan gibi günlüktür ve `APPLICATION_DAILY_REJECTED_LIMIT` ile sınırlıdır; eşzamanlı
 * retler sınırı az aşabilir, sayı yalnız uyarı içindir. Olay logu günde bir kez yazılır.
 */
async function rejectOverLimit(context: PublicApplicationContext, institutionId: string) {
  const { rejected } = await todayApplicationEvents(context.db, institutionId, context.now)
  if (rejected === 0) context.log.warn({ event: 'prospect.application.daily_limit', institutionId })
  if (rejected < APPLICATION_DAILY_REJECTED_LIMIT)
    await context.db.insert(auditLog).values({
      institutionId,
      actorUserId: null,
      actorRole: APPLICATION_FORM_ACTOR_ROLE,
      action: APPLICATION_REJECTED_ACTION,
      entityType: ENTITY,
      entityId: institutionId,
      changes: { fields: [] },
      createdAt: context.now,
    })
  return mapOperationError(
    new DomainError('application_unavailable', APPLICATION_UNAVAILABLE_MESSAGE),
  )
}

/**
 * Başvuruyu işler (DOM-KAY-002, -003, -009). Dönen sonuç yanıta girmez: yeni aday, mükerrer not ve
 * gizli alan dışarıdan aynıdır. Gizli alan doluysa kurum kilidi alınmaz, bütün adaylar yüklenmez ve
 * ret sayılmaz. Yazılacak bir şey yoksa (gizli alan, yinelenen not) denetim satırı da yoktur.
 *
 * Dolu tavan 422 `application_unavailable`'dır (K-23); denetim mükerrer aramasından önce olduğu için
 * yeni başvuran ve kayıtlı aday aynı yanıtı alır, kişi varlığı belli olmaz.
 *
 * Kilitten önceki denetimler ucuz rettir: geçersiz form ve dolu tavan kurum kuyruğuna girmez, finans
 * işlemlerini bekletmez. Karar kilit altında yeniden verilir: kilit beklerken anahtar yenilenmiş, form
 * kapanmış ya da tavan dolmuş olabilir. Bekleme `APPLICATION_LOCK_TIMEOUT` ile sınırlıdır; aşılırsa
 * hiçbir şey yazılmaz, 409 `conflict` ile yeniden denenir (55P03).
 */
export async function submitApplication(
  context: PublicApplicationContext,
  formKey: string,
  input: { website?: string | undefined },
): Promise<ProspectApplicationOutcome> {
  const resolved = await resolveOpenForm(context.db, formKey)
  if (resolved === null) throw new NotFoundError()
  if (isHoneypotFilled(input.website)) return { kind: 'ignored' }
  const { institutionId } = resolved.row
  if (await dailyLimitReached(context.db, institutionId, context.now))
    throw await withDatabaseErrors(rejectOverLimit(context, institutionId))
  const work = context.db.transaction(async (tx) => {
    await tx.execute(APPLICATION_LOCK_TIMEOUT)
    await lockInstitution(tx, institutionId)
    const form = await resolveOpenForm(tx, formKey)
    if (form === null) throw new NotFoundError()
    if (await dailyLimitReached(tx, institutionId, context.now)) return OVER_LIMIT
    const { rows } = await loadOperationRecords(tx, institutionId, ['branches', 'prospects'], {})
    // Metin kilit altında okunur: eşzamanlı yayımdan sonra eski sürüm kabul edilmez.
    const notice = await currentCandidateNotice(tx, institutionId)
    if (notice === null) throw new NotFoundError()
    const stored = new Map(
      rows.filter((row) => row.collection === 'prospects').map((row) => [row.id, row]),
    )
    const dataOf = <K extends keyof ProspectApplicationState>(collection: K) =>
      rows
        .filter((row) => row.collection === collection)
        .map((row) => structuredClone(row.data) as ProspectApplicationState[K][number])
    const state = { branches: dataOf('branches'), prospects: dataOf('prospects') }
    let outcome: ProspectApplicationOutcome
    try {
      outcome = submitProspectApplication(state, input, {
        institutionType: form.institutionType,
        noticeVersion: notice.version,
        makeId: (prefix) => `${prefix}-${randomUUID()}`,
        now: context.now.toISOString(),
      })
    } catch (error) {
      throw mapOperationError(error)
    }
    const { writes, fields } = applicationWrites(outcome, state.prospects, stored)
    await writeOperationRecords(tx, institutionId, writes, context.now)
    if (outcome.kind !== 'ignored' && writes.length > 0)
      await tx.insert(auditLog).values({
        institutionId,
        actorUserId: null,
        actorRole: APPLICATION_FORM_ACTOR_ROLE,
        action: outcome.kind === 'created' ? APPLICATION_PROSPECT_ACTION : APPLICATION_NOTE_ACTION,
        entityType: 'prospects',
        entityId: outcome.prospectId,
        changes: { fields },
        createdAt: context.now,
      })
    context.log.info({
      event: 'operation.applied',
      action: APPLICATION_PROSPECT_ACTION,
      inserted: writes.filter((write) => write.kind === 'insert').length,
      updated: writes.filter((write) => write.kind === 'update').length,
      moved: writes.filter((write) => write.kind === 'move').length,
    })
    return outcome
  })
  const outcome = await withDatabaseErrors(
    work.catch((error: unknown) => {
      if (databaseErrorInfo(error)?.code === LOCK_NOT_AVAILABLE)
        throw new TransientConflictError({ cause: error })
      throw error
    }),
  )
  if (outcome === OVER_LIMIT)
    throw await withDatabaseErrors(rejectOverLimit(context, institutionId))
  return outcome
}
