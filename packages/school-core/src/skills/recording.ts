import { z } from 'zod'
import { FILE_PURPOSES } from '../content/taxonomy.ts'
import { isCalendarDay, isUnderAdultAge } from '../lib/age.ts'
import { dayKey } from '../lib/format.ts'
import type { Actor } from '../lib/scope.ts'
import type { InstitutionType } from '../modules/collection-modules.ts'
import { appealDeadline, gradingDueAt } from './rubric.ts'
import { istanbulLocalToUtc, type Deadline } from './scoring.ts'

/**
 * Konuşma görevinin ses kaydı: erişim ve saklama sonu (docs/domain/beceri-gelisimi.md
 * DOM-BEC-050…053; ADR 0003 karar 6, 9, 13). Kayıt kişisel veridir (K); biyometrik işleme yoktur
 * (DOM-BEC-051): burada yalnız kimin dinleyebileceği ve kaydın ne zaman silineceği hesaplanır.
 * Fonksiyonlar saftır, `now` alır; satırları servis yükler.
 */

/** Saklama süresi (DOM-BEC-052): dönem sonundan ve puanlama/itiraz kapanışından sonra 6 ay. */
export const RECORDING_RETENTION_MONTHS = 6

// --- Erişim -------------------------------------------------------------------------------

export type RecordingReader = {
  role: Actor['role']
  /**
   * Kaydın kursiyeri kişinin kendisi (öğrenci) ya da bağlı çocuğu (veli). Bağ çağıranın okuma
   * kapsamındandır (velayetsiz bağ kapsamda yoktur).
   */
  ownsLearner: boolean
  /**
   * Personel teslimi okuyabiliyor mu: görevin öğretmeni (atamayı gören), ikinci puanlayıcı ve
   * itiraz değerlendiricisi (atamayı gören öğretmen), uyuşmazlıktaki koordinatör ve yönetici.
   */
  readsSubmission: boolean
  /** Kursiyerin doğum tarihi (`YYYY-MM-DD`); bilinmiyorsa 18 yaş altı sayılır (DOM-YTK-057). */
  learnerBirthDate: string | null
}

/**
 * Ses kaydını dinleyebilir mi (DOM-BEC-053): kaydın sahibi; 18 yaş altındaysa velisi; teslimi
 * okuyan öğretmen (görevin öğretmeni, ikinci puanlayıcı, itiraz değerlendiricisi, koordinatör) ve
 * yönetici. Sınıf arkadaşı, başka veli ve ön büro dinleyemez. 18 yaşını doldurmuş kursiyerin kaydı
 * veliye açılmaz (DOM-DIL-090: yetişkinin verisi üçüncü kişiye gösterilmez).
 */
// TODO(beceri-ses-yonetici): DOM-BEC-053 yöneticiyi saymaz; yönetici teslimi, puanı ve itirazı
// okuduğu (DOM-YTK-028) ve erişimi denetim kaydına düştüğü için dinleyebilir sayıldı. Domain
// yöneticiyi dışarıda bırakırsa yalnız bu dal değişir.
export function canAccessRecording(reader: RecordingReader, now: Date | string): boolean {
  switch (reader.role) {
    case 'ogrenci':
      return reader.ownsLearner
    case 'veli':
      return (
        reader.ownsLearner &&
        (reader.learnerBirthDate === null ||
          !isCalendarDay(reader.learnerBirthDate) ||
          isUnderAdultAge(reader.learnerBirthDate, now))
      )
    case 'ogretmen':
    case 'yonetici':
      return reader.readsSubmission
    default:
      return false
  }
}

// --- Sesli geri bildirim ---------------------------------------------------------------------

/** Sesli geri bildirimin süre sınırı (DOM-BEC-056): `feedback_audio` amacının sınırı, 3 dakika. */
export const FEEDBACK_AUDIO_SECONDS = FILE_PURPOSES.feedback_audio.maxDurationSeconds

/**
 * Puan gövdesindeki sesli geri bildirim (DOM-BEC-056): puanlayanın `feedback_audio` amacıyla
 * yüklediği hazır dosyanın kimliği; verilmezse `null` (yazılı geri bildirim her zaman zorunludur).
 */
export const feedbackAudioFileIdSchema = z
  .uuid('Sesli geri bildirim dosyası geçersiz.')
  .nullable()
  .default(null)

export type FeedbackAudioReader = {
  role: Actor['role']
  /** Bağlı olduğu puan bu kişiye gösteriliyor (personelde görünür puan, kursiyer ve velide açılmış). */
  scoreShown: boolean
}

/**
 * Sesli geri bildirimi dinleyebilir mi (DOM-BEC-056): puanın kendisini gören herkes ve yalnız
 * onlar. Kursiyer ve bağlı veli geri bildirim açılınca (DOM-BEC-045), puanlayan öğretmen, teslimi
 * okuyan öğretmen ve yönetici görünür puanla; ikinci puanlayıcı ilk puanı görmediğinden onun
 * sesini de duymaz (DOM-BEC-024). Ses öğretmenindir: kursiyerin kaydındaki 18 yaş kuralı
 * (DOM-BEC-053) burada yoktur, yazılı geri bildirim gibi açılır. Ön büro hiç dinlemez.
 */
export function canHearFeedbackAudio(reader: FeedbackAudioReader): boolean {
  if (reader.role === 'onburo') return false
  return reader.scoreShown
}

// --- Saklama ------------------------------------------------------------------------------

/** Tarih aralığı (`YYYY-MM-DD`, iki uç dahil): ders yılı veya kur grubu. */
export type DayRange = { startDate: string; endDate: string }

/**
 * Akademik yıl kurum tanımı yokken (`school`): Eylül'de başlayan yıl 31 Ağustos'ta biter
 * (`lib/consents.ts` `academicYearEndsAt` ile aynı sınır).
 */
function fallbackSchoolYearEnd(day: string): string {
  const year = Number(day.slice(0, 4))
  const month = Number(day.slice(5, 7))
  return `${month >= 9 ? year + 1 : year}-08-31`
}

/**
 * Saklamanın başladığı dönem sonu günü (DOM-BEC-052). `school`: kaydın gününü içeren ders yılının
 * bitişi; tanımlı yıl yoksa 31 Ağustos. `language_school`: kursiyerin kaydın gününü içeren kur
 * grubunun bitişi (birden çoksa en geç biteni); yoksa o günden sonra biten en geç grup; hiç grup
 * yoksa kaydın günü (saklama yalnız puanlama ve itiraz kapanışından başlar).
 */
export function recordingPeriodEnd(input: {
  institutionType: InstitutionType
  on: Date | string
  academicYears: readonly DayRange[]
  groups: readonly DayRange[]
}): string {
  const day = dayKey(input.on)
  const covers = (range: DayRange) => range.startDate <= day && day <= range.endDate
  const latest = (ranges: readonly DayRange[]) =>
    ranges.reduce<string | null>(
      (end, range) => (end === null || range.endDate > end ? range.endDate : end),
      null,
    )
  if (input.institutionType === 'school')
    return latest(input.academicYears.filter(covers)) ?? fallbackSchoolYearEnd(day)
  return (
    latest(input.groups.filter(covers)) ??
    latest(input.groups.filter((range) => range.endDate >= day)) ??
    day
  )
}

/** Günün Europe/Istanbul sonu (23.59.59,999), UTC ISO. */
function endOfIstanbulDay(day: string): string {
  const start = istanbulLocalToUtc(`${day}T23:59`)
  if (start === null) throw new RangeError(`invalid calendar day: ${day}`)
  return new Date(Date.parse(start) + 59_999).toISOString()
}

/** Takvim gününe ay ekler; ayın son gününü aşan gün ayın sonuna çekilir (31 Ağustos → 28 Şubat). */
function addMonths(day: string, months: number): string {
  const year = Number(day.slice(0, 4))
  const month = Number(day.slice(5, 7)) - 1 + months
  const target = new Date(Date.UTC(year, month, 1))
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate()
  target.setUTCDate(Math.min(Number(day.slice(8, 10)), lastDay))
  return target.toISOString().slice(0, 10)
}

/**
 * Ses kaydının saklama sonu (DOM-BEC-052; ADR 0003 karar 13). Saklama dönem sonundan
 * (`recordingPeriodEnd`) ve sürümün puanlama ile itiraz süresinin kapanışından hangisi geçse ondan
 * başlar; 6 ay sonra o günün Europe/Istanbul sonunda biter. İmha işi bu andan sonraki ilk turda
 * siler.
 *
 * Kapanış bağlanma anında beklenen takvimle hesaplanır: son teslim + 7 gün puanlama, sonra 5 iş
 * günü itiraz (DOM-BEC-025). Sonraki olaylar bilinen anlarla yeniden hesaplatır (servis yalnız
 * ileri alır, `extendedRecordingRetention`):
 * - `announcedAt`: sonuç duyurusu (puanın kesinleşmesi); itiraz süresi beklenen puanlama sonundan
 *   değil bu andan işler (geç puanlama saklamayı öteler).
 * - `appealFiledAt`: itiraz açıldı; karar süresi domain'de yok, açılıştan 5 iş günü varsayılır.
 * - `appealDecidedAt`: itiraz kararı; kapanış karardan önce olmaz.
 */
// TODO(beceri-ses-itiraz-gec): Domain itirazın karar süresini vermiyor; açılıştan 5 iş günü
// varsayıldı. Karar gecikirse imha işi açık itirazlı kaydı silmez (`recordingPurgeHeld`) ve karar
// anı saklamayı yeniden öteler.
export function recordingRetentionUntil(input: {
  periodEndDate: string
  deadline: Pick<Deadline, 'dueAt'>
  submittedAt: string
  announcedAt?: string | null
  appealFiledAt?: string | null
  appealDecidedAt?: string | null
  holidays?: readonly string[]
}): string {
  const announcedAt =
    input.announcedAt ?? gradingDueAt(input.deadline, { submittedAt: input.submittedAt })
  const closings = [
    endOfIstanbulDay(input.periodEndDate),
    appealDeadline(announcedAt, input.holidays),
    input.appealFiledAt ? appealDeadline(input.appealFiledAt, input.holidays) : null,
    input.appealDecidedAt ?? null,
  ]
  const start = closings.reduce<string>(
    (latest, at) => (at !== null && Date.parse(at) > Date.parse(latest) ? at : latest),
    closings[0] as string,
  )
  return endOfIstanbulDay(addMonths(dayKey(start), RECORDING_RETENTION_MONTHS))
}

/**
 * Yeniden hesaplanan saklama sonu yazılır mı (DOM-BEC-052): yalnız ileri alınır, asla geri
 * çekilmez. Saklama sonu yoksa (`null`: kayıt değil) ya da gelmişse (`<= now`: rıza geri çekilince
 * imhaya işaretlenen ya da süresi dolmuş kayıt) dokunulmaz; erken silme isteği korunur
 * (DOM-YTK-059). Yazılacak değeri, değişiklik yoksa `null` döndürür.
 */
export function extendedRecordingRetention(input: {
  current: Date | string | null
  computed: string
  now: Date | string
}): string | null {
  if (input.current === null) return null
  const current = new Date(input.current).getTime()
  if (current <= new Date(input.now).getTime()) return null
  return Date.parse(input.computed) > current ? new Date(input.computed).toISOString() : null
}

/**
 * İmha işi saklama sonu gelmiş kaydı atlar mı (DOM-BEC-052: saklama puanlama ve itiraz kapandıktan
 * sonra işler). Atlanır: sürüme açık itiraz varsa ya da sürüm teslimin son sürümüyse ve puanı
 * kesinleşmemişse (puanlanmamış, ikinci puan ya da koordinatör bekliyor). Eski sürüm puanlanmaz
 * (yeni sürüm yerini aldı), beklemez. Veri sahibi rızasını geri çektiyse beklenmez: erken silme
 * itiraz hakkını kaldırır (DOM-BEC-052, DOM-YTK-059).
 */
// TODO(beceri-ses-puansiz): Hiç puanlanmayan (ör. arşivlenen atama) son sürümün kaydı puanlanana
// kadar bekler; domain puanlanmamış teslimin saklama sınırını vermiyor.
export function recordingPurgeHeld(input: {
  versionId: string
  latestVersionId: string | null
  settled: boolean
  appeals: readonly { submissionVersionId: string; outcome: string | null }[]
  consentWithdrawn: boolean
}): boolean {
  if (input.consentWithdrawn) return false
  if (input.appeals.some((a) => a.submissionVersionId === input.versionId && a.outcome === null))
    return true
  return input.versionId === input.latestVersionId && !input.settled
}
