import {
  bookAppointment,
  bookAppointmentSchema,
  requireVisibleAppointment,
  updateAppointment,
} from '@kampus/school-core/lib/appointments.ts'
import type { Participant } from '@kampus/school-core/lib/communication.ts'
import { OPERATION_COMMANDS } from '@kampus/school-core/modules/commands.ts'

import { loadRecordsByIds } from '../db/records.ts'
import { ConflictError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { commandBody } from './command-result.ts'
import { environment, type CommandOptions } from './commands.ts'
import { runCommand, type CommandResponse } from './operation-runner.ts'

/**
 * Öğretmen randevusu servisi (docs/domain/iletisim-ve-veli.md DOM-ILT-100…104). Kurallar, rol
 * ve kapsam core'dadır (`lib/appointments.ts`, `requireAuthorized`); burada yalnız gereken
 * kayıtların yüklenmesi ve işlemin tek transaction'da çalıştırılması vardır.
 *
 * Talepte uygunluk saatlerinden yalnız seçilen saat yüklenir; çakışma denetimi için ders, etüt,
 * etkinlik ve randevular bütünüyle yüklenir. Kurum kilidi aynı saate eşzamanlı iki talepten
 * yalnız birinin yazılmasını sağlar; ikincisi çakışmayı görür (DOM-ILT-101).
 *
 * Durum değişikliğinde sürüm denetimi görünürlükten sonradır: kapsam dışı randevu `If-Match`
 * ne olursa olsun olmayan kayıtla aynı 404'ü alır, sürümü sızmaz (DOM-ILT-103). Bu yüzden
 * çalıştırıcıya `expectedVersions` verilmez; satır sürümü kurum kilidi altında okunur.
 * Randevu notu ve gerekçe loglanmaz; denetim kaydına yalnız değişen alan adları yazılır.
 */

const appointmentEntity = (id: string) => ({ type: 'appointments', id })

/** Veli bağlı çocuğu, öğrenci kendisi için randevu talep eder (DOM-ILT-100, -101). 201. */
export function bookAppointmentCommand(
  ctx: ServiceContext,
  input: unknown,
  options: CommandOptions,
): Promise<CommandResponse> {
  const spec = OPERATION_COMMANDS['appointment.book']
  const parsed = bookAppointmentSchema.safeParse(input)
  return runCommand(
    ctx,
    {
      action: 'appointment.book',
      collections: spec.collections,
      // Geçersiz gövde core'da 400 olur; o durumda hiçbir uygunluk saati yüklenmez.
      loadScope: { availability: { ids: parsed.success ? [parsed.data.slotId] : [] } },
      entity: (id: string) => appointmentEntity(id),
      load: async (tx) => {
        const { actor, institutionType, scalars } = await environment(tx, ctx, spec)
        const by: Participant = { ...actor, userId: ctx.actor.userId }
        return {
          scalars,
          run: (state, { now, makeId }) =>
            bookAppointment(state, by, input, makeId, now, { institutionType }).id,
        }
      },
    },
    (outcome) =>
      commandBody({ collection: 'appointments', id: outcome.result }, outcome.changes, 201),
    options.idempotency,
  )
}

/**
 * Randevunun durumunu değiştirir (DOM-ILT-102): öğretmen onaylar veya reddeder, talep eden geri
 * çeker, ikisi de onaylı randevuyu iptal eder. Sıra: görünürlük (404) → sürüm (409) → kural.
 */
export function updateAppointmentCommand(
  ctx: ServiceContext,
  appointmentId: string,
  input: unknown,
  options: CommandOptions,
): Promise<CommandResponse> {
  const spec = OPERATION_COMMANDS['appointment.update']
  return runCommand(
    ctx,
    {
      action: 'appointment.update',
      collections: spec.collections,
      entity: appointmentEntity(appointmentId),
      load: async (tx) => {
        const [{ actor, institutionType, scalars }, rows] = await Promise.all([
          environment(tx, ctx, spec),
          loadRecordsByIds(tx, ctx.institutionId, 'appointments', [appointmentId]),
        ])
        const by: Participant = { ...actor, userId: ctx.actor.userId }
        const version = rows[0]?.version
        return {
          scalars,
          run: (state, { now }) => {
            requireVisibleAppointment(state, by, appointmentId, { institutionType })
            if (options.expectedVersion !== null && version !== options.expectedVersion)
              throw new ConflictError()
            updateAppointment(state, by, appointmentId, input, now, { institutionType })
            return appointmentId
          },
        }
      },
    },
    (outcome) =>
      commandBody({ collection: 'appointments', id: outcome.result }, outcome.changes, 200),
    options.idempotency,
  )
}
