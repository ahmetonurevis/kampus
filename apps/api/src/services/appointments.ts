import {
  bookableSlots,
  bookAppointment,
  bookAppointmentSchema,
  updateAppointment,
  type BookableSlot,
} from '@kampus/school-core/lib/appointments.ts'
import type { Participant } from '@kampus/school-core/lib/communication.ts'
import { OPERATION_COMMANDS } from '@kampus/school-core/modules/commands.ts'

import type { ServiceContext } from '../plugins/authenticate.ts'
import { commandBody } from './command-result.ts'
import { environment, type CommandOptions } from './commands.ts'
import { runCommand, runReadOnly, type CommandResponse } from './operation-runner.ts'

/**
 * Öğretmen randevusu servisi (docs/domain/iletisim-ve-veli.md DOM-ILT-100…104). Kurallar, rol
 * ve kapsam core'dadır (`lib/appointments.ts`, `requireAuthorized`); burada yalnız gereken
 * kayıtların yüklenmesi ve işlemin tek transaction'da çalıştırılması vardır.
 *
 * Talepte uygunluk saatlerinden yalnız seçilen saat yüklenir; çakışma denetimi için ders, etüt,
 * etkinlik ve randevular bütünüyle yüklenir. Kurum kilidi aynı saate eşzamanlı iki talepten
 * yalnız birinin yazılmasını sağlar; ikincisi çakışmayı görür (DOM-ILT-101).
 *
 * Durum değişikliğinde `If-Match` çalıştırıcının `expectedVersions` denetimiyle karşılaştırılır:
 * sürüm farkı core kapsam ve yetki denetiminden sonra bildirilir. Kapsam dışı randevu yanlış
 * sürümde de olmayan kayıtla aynı 404'ü, görünür ama yetkisiz geçiş 403'ü, yetkili kullanıcı
 * 409 `version_conflict` alır (DOM-ILT-102, DOM-ILT-103).
 * Randevu notu ve gerekçe loglanmaz; denetim kaydına yalnız değişen alan adları yazılır.
 */

const appointmentEntity = (id: string) => ({ type: 'appointments', id })

/**
 * Veli ve öğrencinin alınabilir saatleri (DOM-ILT-105): core `bookableSlots` talepteki çakışma
 * denetimiyle aynı kararı verir. Salt okunur çalışır (`runReadOnly`): kurum kilidi alınmaz, hiçbir
 * şey yazılmaz; kayıtlar yalnız etkin kurumdan yüklenir. Kapsam dışı öğrenci 404, pasif öğrenci
 * 422 core'dandır.
 * TODO(perf): ders programı, etüt, etkinlik ve randevular bütünüyle yüklenir (talep ucuyla aynı);
 * büyük kurumda aralıkla süzülerek yüklenmeli.
 */
export function listBookableSlots(ctx: ServiceContext, query: unknown): Promise<BookableSlot[]> {
  const spec = OPERATION_COMMANDS['appointment.slots']
  return runReadOnly(ctx, {
    action: 'appointment.slots',
    collections: spec.collections,
    load: async (tx) => {
      const { actor, institutionType, scalars } = await environment(tx, ctx, spec)
      const by: Participant = { ...actor, userId: ctx.actor.userId }
      return {
        scalars,
        run: (state, { now }) => bookableSlots(state, by, query, now, { institutionType }),
      }
    },
  })
}

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
 * çeker, ikisi de onaylı randevuyu iptal eder. Sıra: olmayan kayıt (404) → görünürlük (404) →
 * yetki (403) → sürüm (409) → kural.
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
      ...(options.expectedVersion === null
        ? {}
        : {
            expectedVersions: [
              { collection: 'appointments', id: appointmentId, version: options.expectedVersion },
            ],
          }),
      entity: appointmentEntity(appointmentId),
      load: async (tx) => {
        const { actor, institutionType, scalars } = await environment(tx, ctx, spec)
        const by: Participant = { ...actor, userId: ctx.actor.userId }
        return {
          scalars,
          run: (state, { now }) => {
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
