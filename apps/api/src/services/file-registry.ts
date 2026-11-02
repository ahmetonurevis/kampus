import type { FilePurpose } from '@kampus/school-core/content/taxonomy.ts'

import type { Role } from '../auth.ts'
import type { Database } from '../db/client.ts'
import type { StoredFile } from '../db/files.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'

/**
 * Dosya amaçlarının API tarafı (ADR 0003 karar 3, 6, 9): kim yükler, hangi modüle bağlıdır,
 * bağlantı ne kadar yaşar ve erişimi denetim kaydına girer mi. Tür ve boyut sınırı core
 * `FILE_PURPOSES`'tadır (DOM-KYN-004); burada yalnız yetki ve sunum vardır.
 */
export interface FilePurposeAccess {
  /** Amaç bu modüle bağlıdır; kapalıysa yükleme ve bağlantı 403 `module_disabled`. */
  module: string | null
  /** Yükleyebilen roller; ötekiler 403. */
  uploaders: readonly Role[]
  /** İmzalı bağlantının ömrü, saniye (karar 6: varsayılan 5 dk, konuşma kaydı 2 dk). */
  linkTtlSeconds: number
  /** Bağlantı üretimi `audit_log`'a `file.access` olarak yazılır (DOM-BEC-053, DOM-YTK-052). */
  auditAccess: boolean
}

const STAFF: readonly Role[] = ['yonetici', 'ogretmen']

export const FILE_PURPOSE_ACCESS = {
  submission: {
    module: 'learning',
    uploaders: ['ogrenci'],
    linkTtlSeconds: 300,
    auditAccess: true,
  },
  material: { module: 'learning', uploaders: STAFF, linkTtlSeconds: 300, auditAccess: false },
  question_image: { module: 'learning', uploaders: STAFF, linkTtlSeconds: 300, auditAccess: false },
  // Öğrencinin sorusuna eklediği fotoğraf (DOM-ILT-094): çocuk verisi, her bağlantı denetimde.
  student_question_photo: {
    module: 'learning',
    uploaders: ['ogrenci'],
    linkTtlSeconds: 300,
    auditAccess: true,
  },
  // En kısa ömür; dinleme bağlantısı kayıt süresi + 60 sn yaşar (`listeningWindowMs`, OG-049).
  listening_audio: {
    module: 'learning',
    uploaders: STAFF,
    linkTtlSeconds: 300,
    auditAccess: false,
  },
  speaking_recording: {
    module: 'learning',
    uploaders: ['ogrenci'],
    linkTtlSeconds: 120,
    auditAccess: true,
  },
  // Kurum belgesi (imzalı sözleşme taraması vb.) modüle bağlı değildir.
  document: {
    module: null,
    uploaders: ['yonetici', 'onburo'],
    linkTtlSeconds: 300,
    auditAccess: false,
  },
} as const satisfies Record<FilePurpose, FilePurposeAccess>

/**
 * Dosyanın bağlanabileceği kayıt türü (ADR 0003 karar 5, 6). Dosyanın kendi izin tablosu yoktur:
 * bağlı dosyanın bağlantısı, bağlı kaydın okuma kuralından geçer (`canRead`; school-core kapsam
 * fonksiyonunu çağıran servis). Tüketici (teslim, kaynak sürümü, soru; F4b4) kendi türünü
 * `defineFileAttachment` ile modül yüklenirken kaydeder.
 */
export interface FileAttachmentKind {
  /** Bu kayda bağlanabilecek amaçlar. */
  purposes: readonly FilePurpose[]
  /**
   * Kişi bağlı kaydı (ve bu dosyayı) okuyabilir mi; okuyamayan dosyayı da göremez (404). Dosya
   * satırı amaca özgü kural için verilir (konuşma kaydında DOM-BEC-053).
   */
  canRead: (
    tx: Database,
    ctx: ServiceContext,
    attachedId: string,
    file: StoredFile,
  ) => Promise<boolean>
  /**
   * Saklama sonu gelmiş dosyanın imhası bekletilir mi (DOM-BEC-052: konuşma kaydı puanlama ve
   * itiraz kapanana kadar). İmha işi dosya satırını kilitledikten sonra sorar; yoksa beklenmez.
   */
  purgeHeld?: (
    tx: Database,
    institutionId: string,
    attachedId: string,
    file: StoredFile,
  ) => Promise<boolean>
}

const ATTACHED_TYPE_PATTERN = /^[a-z][a-z0-9_]{1,62}$/
const registry = new Map<string, FileAttachmentKind>()

export function defineFileAttachment(type: string, kind: FileAttachmentKind): void {
  if (!ATTACHED_TYPE_PATTERN.test(type)) throw new Error(`invalid file attachment type: ${type}`)
  if (registry.has(type)) throw new Error(`file attachment type already defined: ${type}`)
  registry.set(type, kind)
}

export function fileAttachmentKind(type: string): FileAttachmentKind | undefined {
  return registry.get(type)
}
