import { z } from 'zod'

import { DomainError } from './errors.ts'
import { requireSameGuardian, type GuardianLink } from './guardianship.ts'
import { assertStaffInvitation, staffEmailSchema, staffNameSchema } from './staff-accounts.ts'

/**
 * Veli hesabı daveti (docs/domain/yetki-ve-kapsam.md DOM-YTK-071; personel daveti DOM-YTK-070).
 * Kesin kayıttan sonra yönetici ya da ön büro velinin hesabını açar: kullanıcı (parolasız), `veli`
 * üyeliği ve seçilen her öğrenci için çocuk bağlantısı (`membership_links` `child`) tek işlemde
 * yazılır. Veli kaydı (`parentId`) verilirse kaydın seçilen öğrencilerdeki bağları
 * (`student_guardians`) hesaba bağlanır; okuma kapsamı velayeti bu bağlardan okur
 * (`guardedActorLinks`). Veli kaydı verilmezse velayet bağı kurulmaz: çocuk bağlantısı tek başına
 * kapsam vermez (kapalı başarısız), velayet ve yakınlık bağ ucundan (`planGuardianLink`) girilir.
 *
 * Saf fonksiyonlardır: API kurum kilidi altında okuduğu üyelik, davet ve bağları verir; karar
 * burada verilir. Öğrenci ve veli kaydının kurumda varlığı çağıranındır (yoksa 404).
 */

z.config(z.locales.tr())

/** Bir davette en çok bu kadar öğrenci (kardeşler). */
export const GUARDIAN_INVITATION_MAX_STUDENTS = 10

const recordId = (message: string) => z.string().trim().min(1, message).max(200)

/**
 * Davet girdisi: e-posta ve ad personel davetiyle aynı kuralla; 1–10 benzersiz öğrenci; isteğe
 * bağlı veli kaydı. API gövde şeması ve web form şemasıdır.
 */
export const guardianInvitationInputSchema = z.strictObject({
  // kvkk: K
  email: staffEmailSchema,
  // kvkk: K
  name: staffNameSchema,
  studentIds: z
    .array(recordId('Öğrenci seçin.'))
    .min(1, 'En az bir öğrenci seçin.')
    .max(
      GUARDIAN_INVITATION_MAX_STUDENTS,
      `En çok ${GUARDIAN_INVITATION_MAX_STUDENTS} öğrenci seçilebilir.`,
    )
    .refine((ids) => new Set(ids).size === ids.length, 'Aynı öğrenci bir kez seçilir.'),
  parentId: recordId('Veli kaydını seçin.').optional(),
})
export type GuardianInvitationInput = z.infer<typeof guardianInvitationInputSchema>

export const GUARDIAN_INVITATION_MESSAGES = {
  guardian_record_not_linked: 'Seçilen veli kaydı bu öğrencinin velisi değil.',
  guardian_link_exists: 'Bu veli kaydı zaten bir veli hesabına bağlı ya da bekleyen bir davette.',
} as const satisfies Record<string, string>

/** Davetin yazacakları: öğrenciler, veli kaydı ve hesaba bağlanacak velayet bağları. */
export interface GuardianInvitationPlan {
  studentIds: string[]
  parentId: string | null
  bondIds: string[]
}

/**
 * Yeni hesabın henüz üyeliği yoktur. Kayıt ile hesap denetimi (`requireSameGuardian`) bu yer
 * tutucuyla çalışır: hiçbir bağda geçmediği için kaydın başka bir hesapla eşlenmiş olması
 * yakalanır.
 */
const NEW_ACCOUNT = ''

/**
 * Davet kararı (DOM-YTK-071). Sıra: kurumda kayıtlı e-posta 409 `member_exists`, bekleyen davet 409
 * `invitation_exists`; veli kaydı verilmişse seçilen her öğrencide kaydın etkin bağı olmalı (422
 * `guardian_record_not_linked`), o bağ başka hesaba bağlı ya da kayıt kurumun bekleyen bir veli
 * davetinde tutuluyorsa 409 `guardian_link_exists`, kayıt başka öğrencide başka hesapla eşlenmişse
 * 422 `guardian_identity_mismatch`. `links` seçilen öğrencilerin etkin bağları, `identityLinks`
 * veli kaydının kurumdaki bütün etkin bağlarıdır. Doğrulama hatasında hiçbir şey yazılmaz.
 */
export function planGuardianInvitation(input: {
  input: unknown
  alreadyMember: boolean
  pendingInvitation: boolean
  parentInvitationPending: boolean
  links: readonly GuardianLink[]
  identityLinks: readonly GuardianLink[]
}): GuardianInvitationPlan {
  const data = guardianInvitationInputSchema.parse(input.input)
  assertStaffInvitation({
    alreadyMember: input.alreadyMember,
    pendingInvitation: input.pendingInvitation,
    teacherLinked: false,
    teacherInvitationPending: false,
  })
  const { parentId } = data
  if (parentId === undefined) return { studentIds: data.studentIds, parentId: null, bondIds: [] }
  const bonds = data.studentIds.map((studentId) => {
    const bond = input.links.find(
      (link) => link.studentId === studentId && link.parentId === parentId,
    )
    if (bond === undefined)
      throw new DomainError(
        'guardian_record_not_linked',
        GUARDIAN_INVITATION_MESSAGES.guardian_record_not_linked,
        { path: ['parentId'] },
      )
    return bond
  })
  if (input.parentInvitationPending || bonds.some((bond) => bond.membershipId !== null))
    throw new DomainError(
      'guardian_link_exists',
      GUARDIAN_INVITATION_MESSAGES.guardian_link_exists,
      {
        kind: 'conflict',
        path: ['parentId'],
      },
    )
  try {
    requireSameGuardian(parentId, NEW_ACCOUNT, input.identityLinks)
  } catch (error) {
    // Bu gövdede hesap alanı yok: hata formdaki veli kaydı alanına düşer.
    if (error instanceof DomainError)
      throw new DomainError(error.code, error.message, {
        kind: error.kind,
        path: ['parentId'],
        cause: error,
      })
    throw error
  }
  return { studentIds: data.studentIds, parentId, bondIds: bonds.map((bond) => bond.id) }
}
