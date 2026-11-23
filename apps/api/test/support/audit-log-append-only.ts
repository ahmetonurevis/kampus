import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { eq, sql } from 'drizzle-orm'

import type { App } from '../../src/app.ts'
import type { Database } from '../../src/db/client.ts'
import { auditLog } from '../../src/db/schema/audit-log.ts'
import { institutions } from '../../src/db/schema/auth.ts'
import { databaseErrorInfo } from '../../src/errors.ts'
import { createInstitution } from './app.ts'

/** Tetikleyicinin reddi: 55000 ve tablo adı; ileti teknik ve İngilizcedir, kullanıcıya gösterilmez. */
async function rejectsAppendOnly(work: Promise<unknown>) {
  await assert.rejects(work, (error: unknown) => {
    assert.equal(databaseErrorInfo(error)?.code, '55000')
    const cause = (error as { cause?: { message?: string } }).cause
    assert.match(cause?.message ?? String(error), /audit_log rows are append-only/)
    return true
  })
}

/**
 * OG-200: `audit_log` yalnız eklemeyle büyür (migration 0043). PGlite ve gerçek PostgreSQL 16
 * testleri aynı gövdeyi koşar.
 */
export async function assertAuditLogAppendOnly(db: Database, app: App) {
  const institution = await createInstitution(app)
  const [created] = await db
    .insert(auditLog)
    .values({
      institutionId: institution.id,
      actorUserId: institution.admin.id,
      actorRole: 'yonetici',
      action: 'og200.insert',
      entityType: 'module',
      entityId: randomUUID(),
    })
    .returning({ id: auditLog.id })
  assert.ok(created, 'INSERT çalışmalı')

  await rejectsAppendOnly(
    db.update(auditLog).set({ action: 'og200.degisti' }).where(eq(auditLog.id, created.id)),
  )
  await rejectsAppendOnly(db.delete(auditLog).where(eq(auditLog.id, created.id)))
  await rejectsAppendOnly(db.execute(sql`truncate audit_log`))

  // Kurum silinince `institution_id` yabancı anahtarı satırı `set null` ile güncellemeye kalkar; o da reddedilir.
  await rejectsAppendOnly(db.delete(institutions).where(eq(institutions.id, institution.id)))

  // İmha işinin ayarı denetim satırını açmaz (ortak işlevin aksine istisna yoktur).
  await rejectsAppendOnly(
    db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('kampus.allow_immutable_purge', 'on', true)`)
      await tx.delete(auditLog).where(eq(auditLog.id, created.id))
    }),
  )

  const [row] = await db.select().from(auditLog).where(eq(auditLog.id, created.id))
  assert.equal(row?.action, 'og200.insert', 'reddedilen işlemler satırı değiştirmemeli')
  assert.equal(row?.institutionId, institution.id)
}
