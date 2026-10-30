import { and, eq, sql } from 'drizzle-orm'

import {
  setModuleEnabled,
  type ModuleToggleResult,
} from '@kampus/school-core/lib/institution-modules.ts'
import { modulesFor } from '@kampus/school-core/modules/collection-modules.ts'

import type { InstitutionType } from '../auth.ts'
import type { Database } from '../db/client.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import { institutions } from '../db/schema/auth.ts'
import { institutionSettings } from '../db/schema/institution-settings.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { effectiveModules, toModuleMap } from './modules.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'

/**
 * Kurum modül ayarı (DOM-YTK-040, DOM-YTK-042). Kurum satırında (`institutions`, Better Auth
 * tablosu) sürüm yoktur; iyimser kilit `institution_settings.version` ile yapılır ve her modül
 * değişikliği onu bir artırır. Kural core `setModuleEnabled`'dadır; burada yalnız yükleme, sürüm
 * denetimi ve yazma vardır.
 */

export interface ModuleSettings {
  /** `If-Match` için kurum ayar sürümü. */
  version: number
  /** Kurum türünde bulunan modüller (core sırasıyla) ve etkin durumları. */
  modules: { key: string; enabled: boolean }[]
}

interface InstitutionRow {
  type: InstitutionType
  stored: Record<string, boolean>
  version: number
}

/** Kurum türü, saklanan harita ve ayar sürümü; ayar satırı yoksa `null`. */
async function loadInstitution(
  db: Database,
  institutionId: string,
): Promise<InstitutionRow | null> {
  const [row] = await db
    .select({
      type: institutions.type,
      enabledModules: institutions.enabledModules,
      version: institutionSettings.version,
    })
    .from(institutions)
    .innerJoin(institutionSettings, eq(institutionSettings.institutionId, institutions.id))
    .where(eq(institutions.id, institutionId))
    .limit(1)
  return row
    ? { type: row.type, stored: toModuleMap(row.enabledModules), version: row.version }
    : null
}

export async function getModuleSettings(
  db: Database,
  institutionId: string,
): Promise<ModuleSettings> {
  const row = await loadInstitution(db, institutionId)
  if (!row) throw new NotFoundError()
  const effective = effectiveModules(row.stored, row.type)
  return {
    version: row.version,
    modules: modulesFor(row.type).map((key) => ({ key, enabled: effective[key] === true })),
  }
}

export interface ModuleChange {
  moduleKey: string
  enabled: boolean
  /** Etkin modül haritası (`/me` ile aynı). */
  enabledModules: Record<string, boolean>
  /** Yeni ayar sürümü. */
  version: number
}

/**
 * Modülü açar/kapatır. Aynı transaction'da: kurum kilidi → sürüm denetimi (tutmazsa 409) → core
 * kuralı → `enabled_modules` ve sürüm → denetim kaydı. Kapatma kayıtlara dokunmaz. Yanıt
 * `Idempotency-Key` ile saklanır.
 */
export function changeModule(
  ctx: ServiceContext,
  input: {
    moduleKey: string
    body: unknown
    expectedVersion: number
    idempotency: IdempotencyRequest | null
  },
): Promise<CommandResponse> {
  const { moduleKey, body, expectedVersion } = input
  // `after` ve `respond` aynı işlemin parçalarıdır; yeni sürüm yazıldıktan sonra yanıta taşınır.
  const out: { loaded?: InstitutionRow; change?: ModuleChange } = {}
  return runCommand<ModuleToggleResult>(
    ctx,
    {
      action: 'module.set',
      collections: [],
      entity: { type: 'module', id: moduleKey },
      load: async (tx) => {
        const row = await loadInstitution(tx, ctx.institutionId)
        if (!row) throw new NotFoundError()
        if (row.version !== expectedVersion) throw new ConflictError()
        out.loaded = row
        return {
          // Core kuralı saklanan haritayı değiştirmez; yeni haritayı döndürür.
          run: () =>
            setModuleEnabled(
              { institutionType: row.type, modules: row.stored },
              { role: ctx.actor.role },
              moduleKey,
              body,
            ),
        }
      },
      after: async (tx, result) => {
        const type = out.loaded?.type
        if (type === undefined) throw new Error('module change: institution not loaded')
        await tx
          .update(institutions)
          .set({ enabledModules: result.modules })
          .where(eq(institutions.id, ctx.institutionId))
        // Sürüm koşulu eşzamanlı yazmaya karşı ikinci güvencedir (kurum kilidi zaten sıralar).
        const [bumped] = await tx
          .update(institutionSettings)
          .set({ version: sql`${institutionSettings.version} + 1`, updatedAt: ctx.now })
          .where(
            and(
              eq(institutionSettings.institutionId, ctx.institutionId),
              eq(institutionSettings.version, expectedVersion),
            ),
          )
          .returning({ version: institutionSettings.version })
        if (!bumped) throw new ConflictError()
        await tx.insert(auditLog).values({
          institutionId: ctx.institutionId,
          actorUserId: ctx.actor.userId,
          actorRole: ctx.actor.role,
          action: 'module.set',
          entityType: 'module',
          entityId: result.moduleKey,
          changes: { fields: ['enabledModules'] },
          createdAt: ctx.now,
        })
        out.change = {
          moduleKey: result.moduleKey,
          enabled: result.enabled,
          enabledModules: effectiveModules(result.modules, type),
          version: bumped.version,
        }
      },
    },
    () => {
      if (out.change === undefined) throw new Error('module change was not written')
      return { statusCode: 200, body: { data: out.change } }
    },
    input.idempotency,
  )
}
