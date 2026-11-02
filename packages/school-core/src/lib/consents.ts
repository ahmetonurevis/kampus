import { z } from 'zod'

import { ADULT_AGE, ageOn } from './age.ts'
import {
  CONSENT_CHANNELS,
  CONSENT_PURPOSE_KEYS,
  CONSENT_PURPOSES,
  type ConsentChannel,
  type ConsentPurpose,
  type ConsentSubjectKind,
} from './consent-purposes.ts'
import { DomainError } from './errors.ts'
import { latestNotice, minimumConsentTextVersion, type PrivacyNotice } from './privacy-notices.ts'
import type { Actor } from './scope.ts'

/**
 * Amaç bazlı açık rıza (docs/muhendislik/guvenlik-kvkk.md §9; IST-017; DOM-YTK-057…062).
 *
 * Rıza kaydı yalnız kod ve zaman taşır; metnin kendisi `privacy_notices`'tadır. Kayıt değişmez:
 * tek değişiklik geri çekmedir (aynı satıra `withdrawnAt`, bir kez). Yeni karar yeni satırdır
 * (DOM-ILT-034). Aynı veri sahibi + amaç + karar için tek etkin (geri çekilmemiş) satır bulunur.
 *
 * Fonksiyonlar saftır ve `now` parametrelidir; kimlik, yükleme ve yazma servistedir. Girdi
 * dizileri değiştirilmez; ret `DomainError` ile, hiçbir taslak üretilmeden döner.
 */

z.config(z.locales.tr())

export const CONSENT_DECISIONS = ['granted', 'objected'] as const
export type ConsentDecision = (typeof CONSENT_DECISIONS)[number]
/** Rızayı verenin veri sahibiyle ilişkisi: kendisi ya da velayet sahibi veli (DOM-ILT-034). */
export const GRANTOR_RELATIONS = ['self', 'guardian'] as const
export type GrantorRelation = (typeof GRANTOR_RELATIONS)[number]
/** Kapanış nedeni: kullanıcının geri çekmesi ya da süresi dolan/eski sürümlü rızanın yenilenmesi. */
export const WITHDRAWAL_REASONS = ['withdrawn', 'renewed'] as const
export type WithdrawalReason = (typeof WITHDRAWAL_REASONS)[number]

/** Rıza satırı (servisin yüklediği; arşivliler verilmez). */
export type ConsentRecord = {
  id: string
  subjectKind: ConsentSubjectKind
  // kvkk: K — veri sahibi öğrenci kaydı ya da kullanıcı
  subjectId: string
  purpose: ConsentPurpose
  decision: ConsentDecision
  // kvkk: K — rızayı veren kullanıcı
  grantedByUserId: string
  grantorRelation: GrantorRelation
  /** Gösterilen rıza metni sürümü (`privacy_notices`). */
  textId: string
  textVersion: number
  channel: ConsentChannel
  givenAt: string
  /** Velinin rızası öğrencinin 18. yaş gününde, eğitim yılı rızası yıl sonunda biter. */
  expiresAt: string | null
  withdrawnAt: string | null
  // kvkk: K — geri çeken kullanıcı
  withdrawnByUserId: string | null
  withdrawalReason: WithdrawalReason | null
}
export type ConsentDraft = Omit<ConsentRecord, 'id'>
export type ConsentClosure = Pick<
  ConsentRecord,
  'id' | 'withdrawnAt' | 'withdrawnByUserId' | 'withdrawalReason'
> & { withdrawnAt: string; withdrawnByUserId: string; withdrawalReason: WithdrawalReason }

/**
 * Rıza ya da itiraz girdisi. Öğrenci amaçlarında `studentId` zorunludur; hesap amaçlarında
 * (`user`) veri sahibi oturumdaki kullanıcıdır ve `studentId` verilmez.
 */
export const giveConsentSchema = z
  .strictObject({
    purpose: z.enum(CONSENT_PURPOSE_KEYS),
    decision: z.enum(CONSENT_DECISIONS).default('granted'),
    // kvkk: K
    studentId: z.string().trim().min(1).max(200).optional(),
    textId: z.uuid('Rıza metni bulunamadı.'),
    channel: z.enum(CONSENT_CHANNELS),
  })
  .superRefine((data, ctx) => {
    const student = CONSENT_PURPOSES[data.purpose].subject === 'student'
    if (student && data.studentId === undefined)
      ctx.addIssue({ code: 'custom', path: ['studentId'], message: 'Öğrenci seçin.' })
    if (!student && data.studentId !== undefined)
      ctx.addIssue({
        code: 'custom',
        path: ['studentId'],
        message: 'Bu rıza öğrenci için değil, hesabınız için verilir.',
      })
  })
export type GiveConsentInput = z.input<typeof giveConsentSchema>

export const withdrawConsentSchema = z.strictObject({
  consentId: z.uuid('Rıza kaydı bulunamadı.'),
})
export type WithdrawConsentInput = z.infer<typeof withdrawConsentSchema>

/**
 * Öğrenci veri sahibi. Doğum tarihi (`YYYY-MM-DD`) bilinmiyorsa öğrenci 18 yaş altı sayılır
 * (en korumalı yorum; DOM-KAY-009 ile aynı).
 */
export type ConsentStudent = { id: string; birthDate: string | null }

/**
 * Velinin çocukla bağı (servis üyelik bağlantısından ve velayet kaydından kurar). Rızayı yalnız
 * doğrulanmış ve velayet sahibi veli verir (DOM-YTK-025, DOM-YTK-057).
 */
export type GuardianBond = { studentId: string; verified: boolean; custody: boolean }

/** Rıza işlemlerinin aktörü (`lib/scope.ts` `Actor` + zorunlu kullanıcı kimliği). */
export type ConsentActor = Pick<Actor, 'role' | 'links'> & { userId: string }

const forbidden = (code: string, message: string) =>
  new DomainError(code, message, { kind: 'forbidden' })
const studentNotFound = () =>
  new DomainError('consent_student_not_found', 'Öğrenci bulunamadı.', {
    kind: 'not_found',
    path: ['studentId'],
  })

/** Öğrenci `now` anında (Europe/Istanbul günü) 18 yaşını doldurmuş mu; doğum tarihi yoksa hayır. */
export const isAdultStudent = (student: ConsentStudent, now: string) =>
  student.birthDate !== null && ageOn(student.birthDate, now) >= ADULT_AGE

/**
 * Öğrencinin 18 yaşını doldurduğu Europe/Istanbul günü başlangıcı (UTC ISO). 29 Şubat doğumlu artık
 * olmayan yılda 1 Mart'ta yaş alır (`lib/age.ts` `ageOn` ile aynı). Türkiye 2016'dan beri sabit
 * UTC+3'tür; yaz saati yoktur.
 */
export function adulthoodStartsAt(birthDate: string): string {
  const year = Number(birthDate.slice(0, 4)) + ADULT_AGE
  const monthDay = birthDate.slice(5)
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  const day = monthDay === '02-29' && !leap ? `${year}-03-01` : `${year}-${monthDay}`
  return new Date(`${day}T00:00:00+03:00`).toISOString()
}

/**
 * Eğitim-öğretim yılının bitişi (DOM-ILT-033, DOM-YTK-058): kurum ayarındaki başlangıç yılı
 * (`academicYear`, 2026 → 2026–2027) 31 Ağustos sonunda, yani ertesi yılın 1 Eylül'ünün
 * Europe/Istanbul gün başında biter. Eğitim yılı rızası (`planConsent` `academicYearEndsAt`) en geç
 * bu anda düşer.
 */
export function academicYearEndsAt(academicYear: number): string {
  return new Date(`${academicYear + 1}-09-01T00:00:00+03:00`).toISOString()
}

/**
 * Rızayı kim verir (DOM-YTK-057). Öğrenci amaçlarında 18 yaş altında yalnız doğrulanmış bağı ve
 * velayeti bulunan veli (`guardian`), 18 ve üstünde yalnız öğrencinin kendisi (`self`); hesap
 * amaçlarında yalnız hesap sahibi veli ya da 18 yaşını doldurmuş öğrenci. Yaş `now`'ın Europe/Istanbul
 * gününe göre hesaplanır. Kapsam dışı öğrenci bulunamadı (404), yetkisiz kişi 403 alır.
 */
export function requireConsentAuthority(input: {
  actor: ConsentActor
  purpose: ConsentPurpose
  student: ConsentStudent | null
  guardianBonds: readonly GuardianBond[]
  now: string
}): GrantorRelation {
  const { actor, student, now } = input
  if (CONSENT_PURPOSES[input.purpose].subject === 'user') {
    if (actor.role === 'veli') return 'self'
    if (actor.role === 'ogrenci') {
      // Hesap amacında öğrencinin kendi kaydı yaşı verir; kaydı bilinmeyen öğrenci 18 altı sayılır.
      if (student !== null && ownsStudent(actor, student.id) && isAdultStudent(student, now))
        return 'self'
      throw new DomainError(
        'consent_not_applicable',
        'Bu rıza 18 yaşından küçük öğrenciden alınmaz.',
        { kind: 'rule' },
      )
    }
    throw forbidden('consent_forbidden', 'Bu işlem için yetkiniz bulunmuyor.')
  }
  if (student === null) throw studentNotFound()
  const adult = isAdultStudent(student, now)
  if (actor.role === 'ogrenci') {
    if (!ownsStudent(actor, student.id)) throw studentNotFound()
    if (!adult)
      throw forbidden(
        'consent_guardian_required',
        '18 yaşından küçük öğrenci için rızayı velayet sahibi veli verir.',
      )
    return 'self'
  }
  if (actor.role === 'veli') {
    const linked = actor.links.some((link) => link.kind === 'child' && link.recordId === student.id)
    if (!linked) throw studentNotFound()
    if (adult)
      throw forbidden(
        'consent_adult_self',
        'Öğrenci 18 yaşını doldurduğu için rızayı kendisi verir.',
      )
    const bond = input.guardianBonds.find((item) => item.studentId === student.id)
    if (bond === undefined || !bond.verified || !bond.custody)
      throw forbidden(
        'consent_custody_required',
        'Bu rızayı yalnız doğrulanmış velayet sahibi veli verebilir.',
      )
    return 'guardian'
  }
  throw forbidden('consent_forbidden', 'Bu işlem için yetkiniz bulunmuyor.')
}

/** `requireConsentAuthority` reddetmiyorsa `true` (ekranda onay kutusunu göstermek için). */
export function canGiveConsent(input: Parameters<typeof requireConsentAuthority>[0]): boolean {
  try {
    requireConsentAuthority(input)
    return true
  } catch (error) {
    if (error instanceof DomainError) return false
    throw error
  }
}

const ownsStudent = (actor: ConsentActor, studentId: string) =>
  actor.links.some((link) => link.kind === 'student' && link.recordId === studentId)

const isOpen = (consent: ConsentRecord) => consent.withdrawnAt === null

/**
 * Satırın ilişkisi veri sahibinin bugünkü yaşına uyuyor mu (DOM-YTK-057, DOM-YTK-062). Yaş her
 * sorguda öğrencinin güncel doğum tarihinden hesaplanır; satırdaki `expiresAt` yazıldığı andaki
 * bilgiyi taşır ve doğum tarihi sonradan girilip düzeltilebilir.
 *
 * - Velinin rızası (`guardian`) ve öğrencinin itirazı (`self` + `objected`) yalnız öğrenci 18 yaş
 *   altındayken etkilidir. İtiraz velinin rızasına karşıdır; 18 yaşını dolduran öğrencinin kendi
 *   kararı itirazdan etkilenmez.
 * - Öğrencinin kendi rızası (`self` + `granted`) yalnız 18 yaşını doldurmuşken etkilidir.
 * - Doğum tarihi bilinmeyen öğrenci 18 yaş altı sayılır (DOM-YTK-057): velinin rızası geçerli kalır,
 *   öğrencinin kendi rızası sayılmaz. Velinin rızasını geçersiz saymak rızayı hiç alınamaz kılardı
 *   (doğum tarihi yokken rızayı yalnız veli verebilir); muhafazakâr yorum yetki tarafındadır ve
 *   doğum tarihi girildiği anda bu denetim veli rızasını keser.
 * - Hesap amaçlarında (`user`) yaş denetimi yoktur.
 */
const relationApplies = (consent: ConsentRecord, student: ConsentStudent | null, now: string) => {
  if (consent.subjectKind === 'user') return true
  if (student === null || student.id !== consent.subjectId) return false
  const adult = isAdultStudent(student, now)
  if (consent.grantorRelation === 'guardian' || consent.decision === 'objected') return !adult
  return adult
}

const inForce = (
  consent: ConsentRecord,
  now: string,
  minimumVersion: number,
  student: ConsentStudent | null,
) => {
  const at = Date.parse(now)
  return (
    isOpen(consent) &&
    Date.parse(consent.givenAt) <= at &&
    (consent.expiresAt === null || at < Date.parse(consent.expiresAt)) &&
    (consent.decision === 'objected' || consent.textVersion >= minimumVersion) &&
    relationApplies(consent, student, now)
  )
}

/**
 * Rızanın veri sahibi. Öğrenci amaçlarında güncel doğum tarihiyle öğrenci kaydı (veli rızasının ve
 * itirazın erginlikte düşmesi bundan hesaplanır), hesap amaçlarında hesabın kullanıcı kimliği.
 */
export type ConsentSubject =
  { kind: 'student'; student: ConsentStudent } | { kind: 'user'; userId: string }

/**
 * Geçerli rıza var mı (DOM-YTK-061): aynı veri sahibi ve amaç için geri çekilmemiş, süresi
 * dolmamış, en düşük geçerli metin sürümünden eski olmayan metne verilmiş ve ilişkisi öğrencinin
 * bugünkü yaşına uyan `granted` satır var ve etkin bir öğrenci itirazı (`objected`, DOM-YTK-062)
 * yok. Geri çekme anında etkilidir: `withdrawnAt` dolu satır hiçbir anda rıza saymaz.
 *
 * En düşük sürüm çağıranın verdiği yayımlanmış metinlerden hesaplanır (`minimumConsentTextVersion`,
 * DOM-YTK-060); ayrı bir sayı alınmaz ki unutulup yeniden rıza şartı sessizce düşmesin. Listede
 * amacın hiç rıza metni yoksa liste eksik yüklenmiştir ve sonuç `false`'tur (rıza metni silinemez,
 * arşivlenemez). Veri sahibi türü amaca uymuyorsa da `false`.
 */
export function hasValidConsent(
  consents: readonly ConsentRecord[],
  query: {
    purpose: ConsentPurpose
    subject: ConsentSubject
    /** Kurumun yayımlanmış bütün metinleri (`listPrivacyNotices`). */
    texts: readonly PrivacyNotice[]
  },
  now: string,
): boolean {
  const { subject, purpose } = query
  if (subject.kind !== CONSENT_PURPOSES[purpose].subject) return false
  if (latestNotice(query.texts, { kind: 'consent_text', purpose }) === null) return false
  const subjectId = subject.kind === 'user' ? subject.userId : subject.student.id
  const student = subject.kind === 'student' ? subject.student : null
  const minimum = minimumConsentTextVersion(query.texts, purpose)
  let granted = false
  for (const consent of consents) {
    if (
      consent.subjectKind !== subject.kind ||
      consent.subjectId !== subjectId ||
      consent.purpose !== purpose ||
      !inForce(consent, now, minimum, student)
    )
      continue
    if (consent.decision === 'objected') return false
    granted = true
  }
  return granted
}

/**
 * Rıza ya da itiraz verir (DOM-YTK-058, DOM-YTK-062).
 *
 * - Yetki `requireConsentAuthority`; itirazı yalnız 18 yaş altı öğrenci kendisi için ve itiraz
 *   edilebilir amaçta verir (`objection_not_applicable`).
 * - `textId` amacın son yayımlanmış rıza metni olmalıdır: metin yoksa ya da başka amacınsa 404
 *   `consent_text_not_found`, eskiyse 409 `consent_text_outdated`.
 * - Aynı veri sahibi + amaç + karar için yürürlükteki satır varsa 409 `consent_exists` /
 *   `objection_exists` (mükerrer). Açık ama süresi dolmuş, eski sürümlü ya da ilişkisi öğrencinin
 *   bugünkü yaşına uymayan satır (ör. doğum tarihi sonradan girilen reşit öğrencinin velisinin
 *   rızası) `renewed` nedeniyle aynı işlemde kapatılır (`close`); tek etkin satır kısıtı böyle
 *   korunur.
 * - Bitiş: eğitim yılı amaçlarında `academicYearEndsAt` (`now`'dan sonra ve en çok bir yıl
 *   içinde olmalı); veli rızası ve öğrenci itirazı ayrıca öğrencinin 18. yaş gününde biter; erken
 *   olan geçerlidir.
 */
export function planConsent(input: {
  actor: ConsentActor
  student: ConsentStudent | null
  guardianBonds: readonly GuardianBond[]
  texts: readonly PrivacyNotice[]
  /** Veri sahibinin bu amaçtaki açık (geri çekilmemiş) satırları; fazlası yok sayılır. */
  consents: readonly ConsentRecord[]
  input: unknown
  now: string
  academicYearEndsAt?: string | null
}): { consent: ConsentDraft; close: ConsentClosure[] } {
  const data = giveConsentSchema.parse(input.input)
  const { actor, now } = input
  const purpose = CONSENT_PURPOSES[data.purpose]
  const student =
    data.studentId === undefined
      ? input.student
      : input.student?.id === data.studentId
        ? input.student
        : null

  let relation: GrantorRelation
  if (data.decision === 'objected') {
    if (!purpose.objectable || actor.role !== 'ogrenci')
      throw new DomainError('objection_not_applicable', 'Bu amaç için itiraz kaydı alınmaz.', {
        kind: 'rule',
        path: ['decision'],
      })
    if (student === null || !ownsStudent(actor, student.id)) throw studentNotFound()
    if (isAdultStudent(student, now))
      throw new DomainError(
        'objection_not_applicable',
        '18 yaşını dolduran öğrenci rızayı kendisi verir veya vermez; itiraz gerekmez.',
        { kind: 'rule', path: ['decision'] },
      )
    relation = 'self'
  } else {
    relation = requireConsentAuthority({
      actor,
      purpose: data.purpose,
      student,
      guardianBonds: input.guardianBonds,
      now,
    })
  }

  const text = input.texts.find((item) => item.id === data.textId)
  if (text === undefined || text.kind !== 'consent_text' || text.purpose !== data.purpose)
    throw new DomainError('consent_text_not_found', 'Rıza metni bulunamadı.', {
      kind: 'not_found',
      path: ['textId'],
    })
  if (latestNotice(input.texts, { kind: 'consent_text', purpose: data.purpose })?.id !== text.id)
    throw new DomainError(
      'consent_text_outdated',
      'Rıza metni güncellendi; lütfen güncel metni okuyup yeniden onaylayın.',
      { kind: 'conflict', path: ['textId'] },
    )

  const subjectKind = purpose.subject
  const subjectId = subjectKind === 'user' ? actor.userId : student?.id
  if (subjectId === undefined) throw studentNotFound()
  const at = Date.parse(now)
  const minimum = minimumConsentTextVersion(input.texts, data.purpose)
  const subjectStudent = subjectKind === 'student' ? student : null
  const open = input.consents.filter(
    (consent) =>
      consent.subjectKind === subjectKind &&
      consent.subjectId === subjectId &&
      consent.purpose === data.purpose &&
      consent.decision === data.decision &&
      isOpen(consent),
  )
  if (open.some((consent) => inForce(consent, now, minimum, subjectStudent)))
    throw data.decision === 'granted'
      ? new DomainError('consent_exists', 'Bu amaç için geçerli bir rızanız zaten var.', {
          kind: 'conflict',
        })
      : new DomainError('objection_exists', 'Bu amaç için itirazınız zaten kayıtlı.', {
          kind: 'conflict',
        })

  const ends: number[] = []
  if (data.decision === 'granted' && purpose.validity === 'academic_year') {
    const yearEnd = input.academicYearEndsAt ? Date.parse(input.academicYearEndsAt) : Number.NaN
    if (!(yearEnd > at && yearEnd <= at + 366 * 86_400_000))
      throw new DomainError(
        'academic_year_required',
        'Eğitim yılı bitiş tarihi tanımlı değil; rıza şu anda alınamıyor.',
        { kind: 'rule' },
      )
    ends.push(yearEnd)
  }
  // Velinin rızası ve öğrencinin itirazı yalnız öğrenci 18 yaş altındayken etkilidir; bitiş satıra
  // da yazılır. Doğum tarihi sonradan girilirse `hasValidConsent` güncel yaşla ayrıca keser.
  if ((relation === 'guardian' || data.decision === 'objected') && student?.birthDate)
    ends.push(Date.parse(adulthoodStartsAt(student.birthDate)))

  return {
    consent: {
      subjectKind,
      subjectId,
      purpose: data.purpose,
      decision: data.decision,
      grantedByUserId: actor.userId,
      grantorRelation: relation,
      textId: text.id,
      textVersion: text.version,
      channel: data.channel,
      givenAt: now,
      expiresAt: ends.length === 0 ? null : new Date(Math.min(...ends)).toISOString(),
      withdrawnAt: null,
      withdrawnByUserId: null,
      withdrawalReason: null,
    },
    close: open.map((consent) => ({
      id: consent.id,
      withdrawnAt: now,
      withdrawnByUserId: actor.userId,
      withdrawalReason: 'renewed',
    })),
  }
}

/**
 * Rızayı ya da itirazı geri çeker (DOM-YTK-059): aynı satıra `withdrawnAt = now` yazılır ve
 * rıza o anda geçersizdir. Satırı veren kullanıcı ya da veri sahibi için şu anda rıza verebilecek
 * kişi geri çeker (veli rızasını 18 yaşını dolduran öğrenci de çeker); itirazı yalnız öğrencinin
 * kendisi. Kapsam dışı satır 404 `consent_not_found`, ikinci geri çekme 409
 * `consent_already_withdrawn` (mükerrer).
 */
export function planConsentWithdrawal(input: {
  actor: ConsentActor
  consent: ConsentRecord | null
  student: ConsentStudent | null
  guardianBonds: readonly GuardianBond[]
  input: unknown
  now: string
}): ConsentClosure {
  const data = withdrawConsentSchema.parse(input.input)
  const { actor, consent, now } = input
  if (consent === null || consent.id !== data.consentId) throw consentNotFound()
  const own = consent.grantedByUserId === actor.userId
  // Hesap rızasını ve itirazı yalnız veren kişi geri çeker; öğrenci rızasını şu anki yetkili de.
  if (!own && (consent.decision === 'objected' || consent.subjectKind === 'user'))
    throw consentNotFound()
  if (
    !own &&
    !canGiveConsent({
      actor,
      purpose: consent.purpose,
      student: input.student?.id === consent.subjectId ? input.student : null,
      guardianBonds: input.guardianBonds,
      now,
    })
  )
    throw consentNotFound()
  if (consent.withdrawnAt !== null)
    throw new DomainError('consent_already_withdrawn', 'Bu kayıt zaten geri çekilmiş.', {
      kind: 'conflict',
    })
  return {
    id: consent.id,
    withdrawnAt: now,
    withdrawnByUserId: actor.userId,
    withdrawalReason: 'withdrawn',
  }
}

const consentNotFound = () =>
  new DomainError('consent_not_found', 'Rıza kaydı bulunamadı.', { kind: 'not_found' })
