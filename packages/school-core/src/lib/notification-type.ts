import { z } from 'zod'

import type { ModuleKey } from '../modules/collection-modules.ts'

/**
 * Bildirim türü tanımının yapı taşları (IST-065; docs/domain/iletisim-ve-veli.md DOM-ILT-020,
 * -022, -023). Her alan kendi türlerini kendi dosyasında `defineNotificationType` ile tanımlar:
 * platform ve akademik türler `platform/notification-types.ts`, kayıt ve finans türleri Onur'un
 * dosyasında. Birleşik kayıt `modules/notification-types.ts`'tedir; bir tür kodu yalnız bir
 * kaynakta bulunur (`tests/notification-types.test.ts`).
 *
 * Tür; konuyu, hizmet/ticari sınıfını, alıcı kuralını (18 yaş altı ve yetişkin kitle), ilgili
 * modülü, çağıranın verisinin Zod şemasını, veriden konu kaydının kimliğini ve Türkçe başlık
 * şablonunu taşır. Kayıtta veri saklanmaz, yalnız konu kaydının kimliği saklanır; başlık okumada
 * şablondan öğrencinin ilk adıyla üretilir (DOM-ILT-023).
 */

export const NOTIFICATION_AUDIENCES = ['student', 'parent'] as const
export type NotificationAudience = (typeof NOTIFICATION_AUDIENCES)[number]

/**
 * Bildirim konuları (DOM-ILT-020 listesi). `enrollment` listede yoktur: kesin kayıt bildirimi
 * için eklendi (kayıt ve kurumla ilişki; tercih ekranı geldiğinde konu adı gözden geçirilir).
 */
export const NOTIFICATION_TOPICS = [
  'homework',
  'grade',
  'attendance',
  'payment',
  'announcement',
  'message',
  'appointment',
  'consent',
  'bulletin',
  'enrollment',
] as const
export type NotificationTopic = (typeof NOTIFICATION_TOPICS)[number]

/** Hizmet bildirimi ve ticari ileti (DOM-ILT-022). Ticari tür ileti onayı gelmeden eklenmez. */
export type NotificationCategory = 'service' | 'commercial'

/** Bildirim verisinin şeması: yalnız kimlik taşıyan katı nesne (bilinmeyen alan reddedilir). */
export type NotificationDataSchema = z.ZodObject<z.ZodRawShape, z.core.$strict>

export interface NotificationTypeSpec<D extends NotificationDataSchema = NotificationDataSchema> {
  readonly topic: NotificationTopic
  readonly category: NotificationCategory
  /** Kapatılamayan bildirim (DOM-ILT-020: acil durum, devamsızlık, onay son tarihi). */
  readonly mandatory: boolean
  /**
   * İlgili modül: kapalıysa bildirim üretilmez. Bildirim merkezi (`communication`) her türde
   * ayrıca açık olmalıdır; `null` yalnız `communication`'a bağlı türdür.
   */
  readonly module: ModuleKey | null
  /** Alıcı kitlesi: 18 yaş altı öğrencide ve yetişkin kursiyerde. */
  readonly audiences: {
    readonly minor: readonly NotificationAudience[]
    readonly adult: readonly NotificationAudience[]
  }
  /** Konu kaydının türü (istemci bağlantısı için). */
  readonly subjectType: string
  /**
   * Çağıranın verisi (`notify` `data`): yalnız kimlik; not, puan, tutar, sağlık, rehberlik ya da
   * serbest metin girmez (DOM-ILT-023). Kayda yazılmaz; yalnız konu kimliği çıkarılır.
   */
  readonly data: D
  /** Veriden konu kaydının kimliği. */
  subjectId(data: z.output<D>): string
  /**
   * Gösterilen başlık şablonu; `{öğrenci}` öğrencinin ilk adıyla değişir. Ayrıntı (puan, geri
   * bildirim metni, tutar) yazılmaz (DOM-ILT-023).
   */
  readonly titles: Readonly<Record<NotificationAudience, string>>
}

/** Bildirim verisinde kimlik alanı (kayıt kimliği; serbest metin değildir). */
export const notificationId = z.string().trim().min(1).max(200)

/**
 * Bildirim türü tanımı. Şema katı nesne olmalıdır; başlık yalnız `{öğrenci}` yer tutucusunu
 * alır. Tanım hatası programlama hatasıdır, modül yüklenirken atılır.
 */
export function defineNotificationType<const D extends NotificationDataSchema>(
  spec: NotificationTypeSpec<D>,
): NotificationTypeSpec<D> {
  if (spec.data.def.catchall?._zod.def.type !== 'never')
    throw new Error('notification data schema must be strict')
  for (const title of Object.values(spec.titles))
    for (const holder of title.match(/\{[^}]*\}/g) ?? [])
      if (holder !== '{öğrenci}') throw new Error(`unknown title placeholder: ${holder}`)
  return spec
}

/** Birden çok kaynakta tanımlanan tür kodları (birleşik kayıtta boş olmalı). */
export function duplicateNotificationTypes(
  ...sources: readonly Readonly<Record<string, unknown>>[]
): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const source of sources)
    for (const code of Object.keys(source)) {
      if (seen.has(code)) duplicates.add(code)
      seen.add(code)
    }
  return [...duplicates].sort()
}
