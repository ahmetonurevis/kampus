import { randomBytes } from 'node:crypto'

import { eq } from 'drizzle-orm'
import type { FastifyBaseLogger } from 'fastify'

import {
  applicationFrameAncestors,
  applicationNoticeVersion,
  isApplicationFormKey,
  isHoneypotFilled,
  submitProspectApplication,
  type ProspectApplicationOutcome,
} from '@kampus/school-core/lib/prospect-application-form.ts'
import { DomainError } from '@kampus/school-core/lib/errors.ts'
import { latestNotice, type PrivacyNotice } from '@kampus/school-core/lib/privacy-notices.ts'
import { prospectAgeGroupRequired } from '@kampus/school-core/lib/prospects.ts'

import type { Database } from '../db/client.ts'
import { listPrivacyNotices } from '../db/privacy.ts'
import {
  findApplicationForm,
  findApplicationFormByKey,
  insertApplicationForm,
  updateApplicationFormRow,
  type ApplicationFormRow,
} from '../db/prospect-application-forms.ts'
import { lockInstitution, loadRecords } from '../db/records.ts'
import { institutions } from '../db/schema/auth.ts'
import { AppError, ConflictError, MESSAGES, NotFoundError, withDatabaseErrors } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { getInstitutionModules } from './modules.ts'
import { mapOperationError, runOperation } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Kurum sitesine gömülen ön başvuru formu (ON-133; docs/domain/kayit-ve-crm.md DOM-KAY-002, -003,
 * -004, -007, -009; IST-145). Kurallar core `lib/prospect-application-form.ts`'tedir.
 *
 * Açık uçlarda kimlik yoktur: kurum yalnız form anahtarından çözülür, istemcinin kurum bilgisi
 * okunmaz. Biçimi bozuk anahtar, yenilenmiş ya da bilinmeyen anahtar, kapalı form, kapalı `crm`
 * modülü, yayımlanmış aday aydınlatması ya da aktif kampüs olmaması dışarıdan aynı 404'tür.
 *
 * Yazma, ön büronun aday açmasıyla aynı yoldan gider (`runOperation`: kurum kilidi, bütün adayları
 * yükleme, tek transaction, denetim satırı). Denetimde kullanıcı olmadığı için aktör sabit
 * `APPLICATION_FORM_ACTOR`'dır; telefon, e-posta ve ad log ve denetime girmez (alan adları).
 */

/** Açık uçtan gelen yazmanın denetim aktörü; `audit_log.actor_user_id` kullanıcıya bağlı değildir. */
export const APPLICATION_FORM_ACTOR = {
  userId: 'web-basvuru-formu',
  role: 'onburo',
  membershipId: '',
} as const

const ENTITY = 'prospect_application_form'

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

function settingsView(row: ApplicationFormRow | null, notice: PrivacyNotice | null) {
  return {
    enabled: row?.enabled ?? false,
    formKey: row?.formKey ?? null,
    siteOrigin: row?.siteOrigin ?? null,
    version: row?.version ?? null,
    noticeVersion: notice?.version ?? null,
  }
}

/** Yöneticinin form görünümü; satır ilk anahtar üretilene kadar yoktur. */
export async function applicationFormSettings(ctx: ServiceContext) {
  const [row, notice] = await Promise.all([
    findApplicationForm(ctx.db, ctx.institutionId),
    currentCandidateNotice(ctx.db, ctx.institutionId),
  ])
  return settingsView(row, notice)
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
    return settingsView(updated, notice)
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
    return settingsView(written, await currentCandidateNotice(tx, ctx.institutionId))
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

/**
 * Başvuruyu işler (DOM-KAY-002, -003, -009). Dönen sonuç yanıta girmez: yeni aday, mükerrer not ve
 * gizli alan dışarıdan aynıdır. Gizli alan doluysa kurum kilidi alınmaz, bütün adaylar yüklenmez.
 */
export async function submitApplication(
  context: PublicApplicationContext,
  formKey: string,
  input: { website?: string | undefined },
): Promise<ProspectApplicationOutcome> {
  const form = await resolveOpenForm(context.db, formKey)
  if (form === null) throw new NotFoundError()
  if (isHoneypotFilled(input.website)) return { kind: 'ignored' }
  const { institutionId } = form.row
  const ctx: ServiceContext = {
    db: context.db,
    institutionId,
    actor: APPLICATION_FORM_ACTOR,
    now: context.now,
    log: context.log,
  }
  const { result } = await runOperation(ctx, {
    action: 'prospect.application',
    collections: ['branches', 'prospects'],
    entity: (outcome: ProspectApplicationOutcome) => ({
      type: 'prospects',
      id: outcome.kind === 'ignored' ? '' : outcome.prospectId,
    }),
    load: async (tx) => {
      // Metin kilit altında okunur: eşzamanlı yayımdan sonra eski sürüm kabul edilmez.
      const notice = await currentCandidateNotice(tx, institutionId)
      if (notice === null) throw new NotFoundError()
      return {
        run: (state, { now, makeId }) =>
          submitProspectApplication(state, input, {
            institutionType: form.institutionType,
            noticeVersion: notice.version,
            makeId,
            now,
          }),
      }
    },
  })
  return result
}
