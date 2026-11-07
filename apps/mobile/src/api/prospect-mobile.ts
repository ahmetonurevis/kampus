// Ön büro Aday Öğrenciler ve Tanışma Görüşmeleri ekranlarının saf görünüm mantığı (ON-122;
// DOM-KAY-003, -005, -030…034). Aday satırı, aşama gövdesi ve görüşme olayları web ile ortaktır
// (`@kampus/react-shared/prospect-model.ts`), kurallar core'dadır (`lib/prospects.ts`); burada
// yalnız telefona çevrilir. Yetki, kapsam ve kesin karar sunucudadır.
import type { ApiError } from '@kampus/api-client/errors.ts'
import type { CollectionQuery, CollectionSort } from '@kampus/react-shared/collections.ts'
import {
  CONTACT_LABELS,
  dateTimeLabel,
  lostReasonLabel,
  prospectContactOwner,
  slotLabel,
  stageTargets,
  type MeetingEvent,
  type MeetingKind,
  type ProspectRecord,
} from '@kampus/react-shared/prospect-model.ts'
import {
  PROSPECT_CHANGED_MESSAGE,
  PROSPECT_MESSAGES,
  type AddProspectNoteBody,
} from '@kampus/react-shared/use-prospect-commands.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import {
  addProspectNoteSchema,
  PROSPECT_LOST_REASON_LABELS,
  PROSPECT_LOST_REASONS,
  PROSPECT_STAGES,
  prospectStageLabel,
} from '@kampus/school-core/lib/prospects.ts'
import type { InstitutionType } from '@kampus/school-core/modules/collection-modules.ts'
import { navigation } from '@kampus/school-core/modules/full-navigation.ts'
import { commandFailure, type FieldErrors } from './command-failure.ts'
import { API_PAGE_SIZE, type ListState } from './list-state.ts'
import { isModuleOpen, type MemberRole, type MobileSession } from './session-state.ts'

/** Rozet tonu (`ui/components.tsx` `Tone`); kök testi React Native'e bağlanmasın diye burada yazılır. */
export type BadgeTone = 'primary' | 'green' | 'amber' | 'red'
export type SelectChoice = { value: string; label: string }
export type Fact = readonly [label: string, value: string]

type Session = Pick<MobileSession, 'role' | 'modules'>

/** Rolün menü sayfası var ve modülü açık mı (kapalı modülde sunucu da 403 `module_disabled` döner). */
export function staffPageOpen(session: Session, paths: Partial<Record<MemberRole, string>>) {
  const path = paths[session.role]
  if (path === undefined) return false
  const page = navigation[session.role].find((item) => item.path === path)
  return page !== undefined && isModuleOpen(session.modules, page.module)
}

/** Aday Öğrenciler yalnız ön büronun menüsündedir (`crm`); yönetici adayı web'de görür. */
export const canOpenProspects = (session: Session) => staffPageOpen(session, { onburo: 'adaylar' })
export const canOpenMeetings = (session: Session) =>
  staffPageOpen(session, { onburo: 'deneme-dersi-takvimi' })

// --- Aday listesi ---------------------------------------------------------------------------

/** Yeni aday önce; eşitlikte kimlik, sayfalar arası kararlı sıra (web varsayılanı `-createdAt`). */
const PROSPECT_SORT: readonly CollectionSort[] = ['-createdAt', 'id']
const MIN_SEARCH = 2

const isStage = (value: string) => (PROSPECT_STAGES as readonly string[]).includes(value)

/** Aşama süzgeci: tümü ve her aşama; dil okulunda görüşme aşaması seviye tespitidir. */
export function stageFilterOptions(type: InstitutionType): SelectChoice[] {
  return [
    { value: '', label: 'Tüm aşamalar' },
    ...PROSPECT_STAGES.map((stage) => ({ value: stage, label: prospectStageLabel(stage, type) })),
  ]
}

/** Liste sorgusu: arama (ad, telefon, ilgi) ve aşama sunucuda uygulanır. */
export function prospectListQuery(state: ListState, search: string): CollectionQuery {
  const q = search.trim()
  return {
    page: state.index + 1,
    pageSize: API_PAGE_SIZE,
    sort: PROSPECT_SORT,
    ...(q.length >= MIN_SEARCH ? { q } : {}),
    ...(isStage(state.filter) ? { filters: { stage: state.filter } } : {}),
  }
}

/** Aşama rozeti tonu (web `STAGE_TONES`): kayıt yeşil, vazgeçme kırmızı, teklif sarı. */
export function stageTone(stage: string | undefined): BadgeTone {
  if (stage === 'Kayıt oldu') return 'green'
  if (stage === 'Vazgeçti') return 'red'
  if (stage === 'Teklif verildi') return 'amber'
  return 'primary'
}

/** İlgi alanının adı: dil okulunda hedef seviye, okulda ilgilendiği program. */
export const interestLabel = (type: InstitutionType) =>
  type === 'language_school' ? 'Hedef seviye' : 'İlgilendiği program'

/**
 * Telefon satırı (DOM-KAY-003): 18 yaş altı adayda numara velinindir ve "Veli ·" ile başlar. Ön
 * büro adayı arar; web listesi gibi numara açık yazılır (IST-028 maskesi dışa aktarım içindir).
 */
export function contactLine(prospect: Pick<ProspectRecord, 'phone' | 'minor'>): string {
  return prospectContactOwner(prospect) === 'guardian' ? `Veli · ${prospect.phone}` : prospect.phone
}

export type ProspectListItem = {
  title: string
  subtitle: string
  contact: string
  stageLabel: string
  tone: BadgeTone
  label: string
}

export function prospectListItem(
  prospect: ProspectRecord,
  type: InstitutionType,
  branch: string | undefined,
): ProspectListItem {
  const stageLabel = prospectStageLabel(prospect.stage, type)
  return {
    title: prospect.name,
    subtitle: [prospect.interest, branch].filter(Boolean).join(' · '),
    contact: contactLine(prospect),
    stageLabel,
    tone: stageTone(prospect.stage),
    label: `${prospect.name}, ${stageLabel}, ayrıntıyı aç`,
  }
}

// --- Aday ayrıntısı -------------------------------------------------------------------------

/**
 * Aday kartı (web `ProspectDetailPage` profil kartı): iletişimin sahibi etikette yazılır, veli adı
 * yalnız 18 yaş altında, vazgeçme nedeni yalnız vazgeçen adayda gösterilir.
 */
export function prospectFacts(
  prospect: ProspectRecord,
  type: InstitutionType,
  lookups: { branch?: string | undefined },
): Fact[] {
  const contact = CONTACT_LABELS[prospectContactOwner(prospect)]
  const lost = prospect.stage === 'Vazgeçti'
  return [
    [contact.phone, prospect.phone],
    ...(prospect.email ? [[contact.email, prospect.email] as const] : []),
    ['Kampüs', lookups.branch ?? '—'],
    [interestLabel(type), prospect.interest],
    ...(prospect.source ? [['Kaynak', prospect.source] as const] : []),
    ...(prospect.minor !== false && prospect.guardianName
      ? [['Veli', prospect.guardianName] as const]
      : []),
    ['Aday kaydı', dateLabel(prospect.createdAt, { year: 'numeric' })],
    ...(lost && prospect.lostReason
      ? [['Vazgeçme nedeni', lostReasonLabel(prospect.lostReason)] as const]
      : []),
    ...(lost && prospect.lostToInstitution
      ? [['Tercih ettiği kurum', prospect.lostToInstitution] as const]
      : []),
  ]
}

/** Planlanmış görüşme ve deneme dersi (DOM-KAY-033, -034); yoksa boş liste. */
export function prospectPlans(
  prospect: ProspectRecord,
  lookups: { branch?: string | undefined; group?: string | undefined },
): Fact[] {
  const plans: Fact[] = []
  if (prospect.trialAt) {
    const meeting = prospect.meeting
    plans.push([
      'Tanışma görüşmesi',
      [
        dateTimeLabel(prospect.trialAt),
        meeting ? slotLabel(prospect.trialAt, meeting.duration) : '',
        meeting?.room ?? '',
        lookups.branch ?? '',
      ]
        .filter(Boolean)
        .join(' · '),
    ])
  }
  const trial = prospect.trialLesson
  if (trial)
    plans.push([
      'Deneme dersi',
      [dateTimeLabel(trial.date), slotLabel(trial.date, trial.duration), lookups.group ?? '']
        .filter(Boolean)
        .join(' · '),
    ])
  return plans
}

export type NoteItem = { id: string; meta: string; text: string }

/**
 * İletişim geçmişi (DOM-KAY-032): notlar değişmez, kayıt sırasıyla; en altta adayın açılışı. Yazar
 * adı sunucuda oturumdan yazılmıştır.
 */
export function prospectHistory(prospect: ProspectRecord): NoteItem[] {
  return [
    ...prospect.notes.map((note) => ({
      id: note.id,
      meta: [
        dateLabel(note.date, { year: 'numeric', hour: '2-digit', minute: '2-digit' }),
        note.author,
      ]
        .filter(Boolean)
        .join(' · '),
      text: note.text ?? '',
    })),
    {
      id: 'created',
      meta: dateLabel(prospect.createdAt, { year: 'numeric' }),
      text: `${prospect.source ?? 'Bilinmeyen kaynak'} üzerinden aday kaydı oluşturuldu.`,
    },
  ]
}

/** Seçilebilen hedef aşamalar (DOM-KAY-030); kayıtlı adayda boştur. */
export function stageChoices(stage: string | undefined, type: InstitutionType): SelectChoice[] {
  return stageTargets(stage).map((target) => ({
    value: target,
    label: prospectStageLabel(target, type),
  }))
}

export const LOST_REASON_OPTIONS: readonly SelectChoice[] = PROSPECT_LOST_REASONS.map((reason) => ({
  value: reason,
  label: PROSPECT_LOST_REASON_LABELS[reason],
}))

/**
 * Not gövdesi (DOM-KAY-032): core şemasıyla aynı sınırlar (2–2000 karakter, kırpılmış). Geçersizse
 * Türkçe alan mesajı döner ve istek atılmaz.
 */
export function checkNote(
  text: string,
): { ok: true; body: AddProspectNoteBody } | { ok: false; error: string } {
  const parsed = addProspectNoteSchema.shape.text.safeParse(text)
  return parsed.success
    ? { ok: true, body: { text: parsed.data } }
    : { ok: false, error: parsed.error.issues[0]?.message ?? 'Notu yazın.' }
}

export type ProspectFailure = {
  message: string | null
  fields: FieldErrors
  /** İletişim başka adayda: kardeş seçilerek yeniden açılır (DOM-KAY-030). */
  contactShared: boolean
  /** Kart bu arada değişti (`If-Match`); komut kancası kartı tazeler, form değerleri korunur. */
  changed: boolean
}

/** Komut hatası → pencere içinde gösterilecek metin (toast `silent`). */
export function prospectFailure(error: ApiError, collected: FieldErrors = {}): ProspectFailure {
  const changed = error.status === 409 && error.code === 'version_conflict'
  const base = commandFailure(error, PROSPECT_MESSAGES, collected)
  return {
    message: changed ? PROSPECT_CHANGED_MESSAGE : base.message,
    fields: base.fields,
    contactShared: error.code === 'prospect_contact_shared',
    changed,
  }
}

// --- Tanışma Görüşmeleri --------------------------------------------------------------------

export type MeetingView = 'upcoming' | 'past'
export const MEETING_VIEWS: readonly { value: MeetingView; label: string }[] = [
  { value: 'upcoming', label: 'Yaklaşan' },
  { value: 'past', label: 'Geçmiş' },
]

/** Tür süzgeci; deneme dersi yalnız dil okulunda vardır (DOM-KAY-034), okulda süzgeç çizilmez. */
export function meetingKindOptions(type: InstitutionType): SelectChoice[] {
  return type === 'language_school'
    ? [
        { value: '', label: 'Tüm türler' },
        { value: 'meeting', label: 'Tanışma görüşmesi' },
        { value: 'trial', label: 'Deneme dersi' },
      ]
    : []
}

const isKind = (value: string): value is MeetingKind => value === 'meeting' || value === 'trial'

/** Görünüm ve tür süzgeci; sıralama `meetingEvents`'tendir (yaklaşan yakından, geçmiş yeniden). */
export function filterMeetings(
  events: readonly MeetingEvent[],
  view: MeetingView,
  kind: string,
): MeetingEvent[] {
  return events.filter(
    (event) => event.upcoming === (view === 'upcoming') && (!isKind(kind) || event.kind === kind),
  )
}

/** Bellekteki listenin sayfası (sayfa 0 tabanlı). */
export function pageOf<T>(items: readonly T[], index: number, pageSize = API_PAGE_SIZE): T[] {
  return items.slice(index * pageSize, (index + 1) * pageSize)
}

export type MeetingListItem = {
  title: string
  subtitle: string
  eyebrow: string
  stageLabel: string
  tone: BadgeTone
  label: string
}

export function meetingListItem(event: MeetingEvent): MeetingListItem {
  return {
    title: event.name,
    subtitle: [event.kindLabel, event.branch, event.place]
      .filter((part) => part !== '—')
      .join(' · '),
    eyebrow: `${event.whenLabel} · ${event.timeRange}`,
    stageLabel: event.stageLabel,
    tone: stageTone(event.stage),
    label: `${event.name}, ${event.kindLabel}, ${event.whenLabel} ${event.timeRange}, ayrıntıyı aç`,
  }
}
