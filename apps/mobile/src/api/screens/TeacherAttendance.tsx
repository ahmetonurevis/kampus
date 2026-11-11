import { useEffect, useMemo, useState } from 'react'
import { AppState, Pressable, View, useWindowDimensions } from 'react-native'
import { toApiError } from '@kampus/api-client/errors.ts'
import type { State } from '@kampus/school-core/data/seed.ts'
import { dateLabel, dayKey } from '@kampus/school-core/lib/format.ts'
import {
  attendanceMarks,
  bulkMark,
  lateMinutesIssueErrors,
  lateMinutesPayload,
  markCounts,
  minuteChangedIds,
  savedLateMinutes,
} from '@kampus/react-shared/attendance-model.ts'
import { useRecordAttendance } from '@kampus/react-shared/use-academic-commands.ts'
import { useCollectionAll } from '@kampus/react-shared/use-collection.ts'
import { useLessonsInRange } from '@kampus/react-shared/use-lessons.ts'
import {
  Badge,
  Button,
  Empty,
  Field,
  Icon,
  Sheet,
  T,
  toneSoft,
  useColors,
} from '../../ui/components.tsx'
import type { ApiScreenProps } from '../../route-types.ts'
import { ListRow, Notice, Screen, Section, Tabs } from '../../ui/SchoolLayout.tsx'
import {
  DEFAULT_TEACHER_ATTENDANCE_TAB,
  TEACHER_ATTENDANCE_TABS,
  type TeacherAttendanceTab,
} from '../attendance-history.ts'
import {
  ATTENDANCE_CHOICES,
  attendanceFailureText,
  attendancePayload,
  CHANGED_ELSEWHERE_NOTICE,
  changedElsewhere,
  attendanceTargets,
  isStaleDay,
  pinnedClassVersion,
  markStudent,
  teachingClassIds,
  unsavedCount,
  type AttendanceMark,
  type AttendanceTarget,
  type VersionPin,
} from '../attendance.ts'
import {
  ListLoading,
  QueryError,
  canOpenScreen,
  isModuleOpen,
  useApiSession,
  useNotify,
} from '../shell.ts'
import { useRouteTab } from '../use-route-tab.ts'
import { AttendanceHistory } from './attendance-history.tsx'

type ClassRecord = State['classes'][number]
type SubjectRecord = State['subjects'][number]
type StudentRecord = State['students'][number]
type TeacherRecord = State['teachers'][number]
type AssignmentRecord = State['assignments'][number]
type AttendanceRecord = State['attendance'][number]

/** Ders programı modülü; kapalıysa `/lessons` 403 verir ve liste sınıflardan kurulur. */
const PLANNING_MODULE = 'planning'

type ChoiceProps = {
  studentName: string
  value: AttendanceMark
  disabled: boolean
  onChange: (value: AttendanceMark) => void
}

/**
 * Dört durumlu seçici (radyo grubu). Seçim yalnız renkle değil, işaret simgesi, kalın yazı ve
 * `accessibilityState.checked` ile de bellidir; büyük yazıda seçenekler alt alta dizilir.
 */
function StatusChoice({ studentName, value, disabled, onChange }: ChoiceProps) {
  const c = useColors()
  const { fontScale } = useWindowDimensions()
  const stacked = fontScale > 1.3
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={`${studentName} yoklama durumu`}
      style={{ flexDirection: stacked ? 'column' : 'row', flexWrap: 'wrap', gap: 6 }}
    >
      {ATTENDANCE_CHOICES.map((choice) => {
        const checked = value === choice.value
        return (
          <Pressable
            key={choice.value}
            accessibilityRole="radio"
            accessibilityLabel={`${studentName}: ${choice.label}`}
            accessibilityState={{ checked, selected: checked, disabled }}
            disabled={disabled}
            onPress={() => onChange(choice.value)}
            style={({ pressed }) => ({
              flexGrow: 1,
              flexBasis: stacked ? undefined : '22%',
              minWidth: 48,
              minHeight: 48,
              paddingHorizontal: 8,
              paddingVertical: 6,
              flexDirection: 'row',
              gap: 4,
              justifyContent: 'center',
              alignItems: 'center',
              borderRadius: 10,
              borderWidth: 1,
              borderColor: checked ? c[choice.tone] : c.border,
              backgroundColor: checked ? toneSoft(c, choice.tone) : c.surface,
              opacity: disabled ? 0.55 : pressed ? 0.72 : 1,
            })}
          >
            {checked && <Icon name="Check" size={16} color={c[choice.tone]} />}
            <T
              bold={checked}
              size={14}
              style={{ textAlign: 'center', color: checked ? c[choice.tone] : c.muted }}
            >
              {choice.label}
            </T>
          </Pressable>
        )
      })}
    </View>
  )
}

type SheetProps = {
  target: AttendanceTarget
  /** Sınıf kaydının açılışta sabitlenen sürümü (`If-Match`); yalnız açılışta ve çakışmada yenilenir. */
  classVersion: number | undefined
  /** Sürüm henüz okunmadı ya da yenileniyor; eski sürümle gönderilmesin diye kayıt bekler. */
  versionPending: boolean
  today: string
  /** Çakışmadan sonra sunucunun son sürümünü yeniden sabitler. */
  onRepin: () => void
  /** Gün değişti (gece yarısı geçti): ekran yeni güne geçer, pencere kapanır. */
  onDayChanged: () => void
  onClose: () => void
}

/**
 * Sınıfın bugünkü yoklaması (web "Yoklama al" formu). Varsayılan "Geldi"; kayıtlı gün varsa onun
 * durumu yüklenir. Kayıt tek istektir ve yinelenmez: ikinci gönderim aynı günün kaydını günceller
 * (DOM-AKD-035). İyimser güncelleme yoktur; başarıdan sonra liste sunucudan tazelenir. Hata pencere
 * içinde gösterilir (toast pencerenin altında kalır). Başarısız kayıtta öğretmenin işaretleri
 * silinmez: sürüm çakışmasında (409) sorgular tazelenir, ekran sunucunun son hâlini gösterir ve
 * ondan farklı işaretler "kaydedilmemiş" olarak kalır (web `AttendanceTaking` ile aynı).
 */
function AttendanceSheet({
  target,
  classVersion,
  versionPending,
  today,
  onRepin,
  onDayChanged,
  onClose,
}: SheetProps) {
  const c = useColors()
  const notify = useNotify()
  const students = useCollectionAll<StudentRecord>('students', {
    filters: { classId: target.classId },
  })
  const saved = useCollectionAll<AttendanceRecord>('attendance', {
    filters: { classId: target.classId, dateFrom: today, dateTo: today },
  })
  const record = useRecordAttendance()
  // Yalnız kullanıcının dokunduğu işaretler; kayıtlı ya da varsayılan durum altta türetilir.
  const [edits, setEdits] = useState<Record<string, AttendanceMark>>({})
  const [failure, setFailure] = useState<string | null>(null)
  // Geç kalma dakikası alanları (ham metin) ve alan hataları; kayıtlı dakika altta türetilir.
  const [minuteEdits, setMinuteEdits] = useState<Record<string, string>>({})
  const [minuteErrors, setMinuteErrors] = useState<Record<string, string>>({})
  // İlk düzenlemedeki sunucu durumu; sonradan değişirse başka yerde değişmiş demektir.
  const [baseline, setBaseline] = useState<Record<string, AttendanceMark> | null>(null)

  const active = useMemo(
    () => (students.data ?? []).map((row) => row.record).filter((row) => row.isActive !== false),
    [students.data],
  )
  const ids = useMemo(() => active.map((student) => student.id), [active])
  const savedRecords = useMemo(() => (saved.data ?? []).map((row) => row.record), [saved.data])
  const base = useMemo(() => attendanceMarks(ids, savedRecords), [ids, savedRecords])
  const marks = useMemo(() => attendanceMarks(ids, savedRecords, edits), [ids, savedRecords, edits])
  const minuteText = useMemo(
    () => ({ ...savedLateMinutes(savedRecords), ...minuteEdits }),
    [savedRecords, minuteEdits],
  )
  const counts = markCounts(marks)
  const changed = unsavedCount(
    base,
    marks,
    minuteChangedIds(marks, savedLateMinutes(savedRecords), minuteText),
  )
  const elsewhere = changedElsewhere(baseline, base, edits)
  const alreadyTaken = savedRecords.length > 0
  const busy = record.isPending
  const blocked = busy || versionPending
  const loading = !students.data || !saved.data
  const error = students.error ?? saved.error

  // Durum değişince o öğrencinin eski dakika hatası kalkar; gönderimde yeniden hesaplanır.
  const clearMinuteErrors = (studentIds: readonly string[]) =>
    setMinuteErrors((current) => {
      const next = { ...current }
      for (const id of studentIds) delete next[id]
      return next
    })
  const change = (next: Record<string, AttendanceMark>) => {
    setFailure(null)
    clearMinuteErrors(Object.keys(next).filter((id) => next[id] !== edits[id]))
    if (baseline === null && Object.keys(next).length > 0) setBaseline(base)
    setEdits(next)
  }

  async function save() {
    if (isStaleDay(today)) {
      onDayChanged()
      return
    }
    const updating = alreadyTaken
    // Geçersiz dakika istek atılmadan o öğrencinin alanında gösterilir (kural core şemasındandır).
    const late = lateMinutesPayload(marks, minuteText)
    setMinuteErrors(late.errors)
    if (Object.keys(late.errors).length > 0) {
      setFailure('Geç kalma süresini kontrol edin.')
      return
    }
    const outcome = await record.submit(
      attendancePayload({
        classId: target.classId,
        today,
        marks,
        classVersion,
        lateMinutes: late.minutes,
      }),
      // Hata pencerede gösterilir; aynı mesaj toast olarak da çıkmaz.
      { silent: () => true },
    )
    if (outcome.status === 'busy') return
    if (outcome.status === 'failed') {
      // İşaretler yerinde kalır; kayıtlı durum sunucudan tazelenir (409) ya da hiç değişmemiştir.
      // Üst sınır (ders süresi) sunucuda denetlenir; iletisi o öğrencinin alanına yazılır.
      const fieldErrors = lateMinutesIssueErrors(outcome.error.issues)
      setMinuteErrors(fieldErrors)
      setFailure(
        Object.keys(fieldErrors).length > 0
          ? 'Geç kalma süresini kontrol edin.'
          : attendanceFailureText(outcome.error),
      )
      // Çakışmada sunucunun son hâli ekrandadır ve hata gösterildi: sürüm yeniden sabitlenir,
      // başka yerde değişti uyarısı bir sonraki düzenlemedeki durumdan sayılır.
      setBaseline(null)
      onRepin()
      return
    }
    setMinuteEdits({})
    notify(updating ? 'Yoklama güncellendi.' : 'Yoklama kaydedildi.')
    onClose()
  }

  return (
    <Sheet
      visible
      title={`${target.title} yoklaması`}
      onClose={onClose}
      footer={
        !loading && !error && active.length > 0 ? (
          <View style={{ gap: 12 }}>
            <T muted size={14} accessibilityLiveRegion="polite">
              {counts.present} geldi · {counts.absent} gelmedi · {counts.late} geç geldi ·{' '}
              {counts.excused} mazeretli
            </T>
            {failure && <Notice tone="red" title="Yoklama kaydedilemedi" text={failure} />}
            {elsewhere && !failure && (
              <Notice tone="amber" title="Yoklama değişti" text={CHANGED_ELSEWHERE_NOTICE} />
            )}
            <Button
              accent
              icon="ClipboardCheck"
              disabled={blocked}
              label={busy ? 'Yoklama kaydediliyor' : 'Yoklamayı kaydet'}
              onPress={() => void save()}
            >
              {busy ? 'Yoklama kaydediliyor…' : 'Yoklamayı kaydet'}
            </Button>
          </View>
        ) : undefined
      }
    >
      <View style={{ gap: 6 }}>
        <T bold size={16}>
          {target.subtitle}
        </T>
        <T muted size={14}>
          {dateLabel(`${today}T09:00:00.000Z`, { year: 'numeric', weekday: 'long' })}
          {active.length > 0 ? ` · ${active.length} öğrenci` : ''}
        </T>
      </View>
      {error ? (
        <QueryError
          error={error}
          onRetry={() => {
            if (students.error) void students.refetch()
            if (saved.error) void saved.refetch()
          }}
        />
      ) : loading ? (
        <ListLoading label="Sınıf listesi yükleniyor…" />
      ) : active.length === 0 ? (
        <Empty title="Aktif öğrenci yok" text="Bu sınıfta yoklama alınacak öğrenci bulunmuyor." />
      ) : (
        <>
          {alreadyTaken && (
            <Notice
              title="Bugünkü yoklama kayıtlı"
              text="Kaydetmek mevcut kaydı günceller; yeni kayıt açılmaz."
            />
          )}
          {changed > 0 && (
            <T muted size={14} accessibilityLiveRegion="polite">
              {changed} öğrencide kaydedilmemiş değişiklik var.
            </T>
          )}
          <Button
            icon="CheckCheck"
            disabled={busy}
            onPress={() => change(bulkMark(edits, ids, 'present'))}
          >
            Tümünü geldi işaretle
          </Button>
          <View style={{ gap: 12 }} accessibilityRole="list">
            {active.map((student) => (
              <View
                key={student.id}
                style={{
                  gap: 10,
                  padding: 14,
                  borderWidth: 1,
                  borderColor: c.border,
                  borderRadius: 12,
                  backgroundColor: c.surface,
                }}
              >
                <T bold size={15}>
                  {student.name}
                </T>
                <StatusChoice
                  studentName={student.name}
                  value={marks[student.id] ?? 'present'}
                  disabled={busy}
                  onChange={(status) => change(markStudent(edits, student.id, status))}
                />
                {marks[student.id] === 'late' && (
                  <View style={{ gap: 6 }}>
                    <T bold size={14}>
                      Geç kalma süresi (dakika, isteğe bağlı)
                    </T>
                    <Field
                      hideLabel
                      compact
                      label={`${student.name}: geç kalma süresi, dakika`}
                      value={minuteText[student.id] ?? ''}
                      keyboard="number-pad"
                      maxLength={3}
                      placeholder="Örn. 10"
                      editable={!busy}
                      error={minuteErrors[student.id] ?? ''}
                      hint="Boş bırakırsanız dakikasız geç geldi olarak kaydedilir."
                      onChange={(text) => {
                        setFailure(null)
                        clearMinuteErrors([student.id])
                        setMinuteEdits((current) => ({ ...current, [student.id]: text }))
                      }}
                    />
                  </View>
                )}
              </View>
            ))}
          </View>
        </>
      )}
    </Sheet>
  )
}

function TargetRow({ target, onOpen }: { target: AttendanceTarget; onOpen: () => void }) {
  const status = target.taken ? 'Yoklama alındı' : 'Yoklama bekliyor'
  if (!target.canTake)
    return (
      <ListRow
        card
        title={target.title}
        subtitle={target.subtitle}
        badge={<Badge text="Yedek ders" />}
      >
        <T muted size={13}>
          Yoklamayı sınıfın ders öğretmeni alır.
        </T>
      </ListRow>
    )
  return (
    <ListRow
      card
      title={target.title}
      subtitle={target.subtitle}
      label={`${target.title}, ${target.subtitle}, ${status}. Yoklamayı aç`}
      onPress={onOpen}
      badge={<Badge text={status} />}
    />
  )
}

function TargetList({
  targets,
  onOpen,
}: {
  targets: readonly AttendanceTarget[]
  onOpen: (target: AttendanceTarget) => void
}) {
  return (
    <View style={{ gap: 10 }} accessibilityRole="list">
      {targets.map((target) => (
        <TargetRow key={target.key} target={target} onOpen={() => onOpen(target)} />
      ))}
    </View>
  )
}

/** Europe/Istanbul günü; uygulama öne gelince yeniden hesaplanır (gece yarısı arka planda geçmiş olabilir). */
function useAttendanceDay(): [string, () => void] {
  const [day, setDay] = useState(() => dayKey())
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setDay(dayKey())
    })
    return () => subscription.remove()
  }, [])
  return [day, () => setDay(dayKey())]
}

/**
 * Bugünkü yoklama sekmesi (web `ogretmen/yoklama` "Yoklama al" bölümü). Bugünün (Europe/Istanbul)
 * dersleri `/lessons` ucundan gelir (sunucu öğretmenin kendi derslerine daraltır, iptal dersler
 * dönmez); ders verilen ama bugün dersi olmayan sınıflar ayrı bölümdedir. Ders programı modülü
 * kapalıysa web'deki gibi yalnız ders verilen sınıflar listelenir. Öğretmen yalnız ders verdiği
 * sınıfın bugünkü yoklamasını alır; yetkiyi sunucu yine denetler (DOM-YTK-022, DOM-AKD-035). Gün
 * uygulama öne gelince ve pencere açılırken yeniden hesaplanır. Geçmiş ayrı sekmededir
 * (`attendance-history.tsx`).
 */
function TodayAttendance() {
  const session = useApiSession()
  const notify = useNotify()
  const planningOpen = isModuleOpen(session.modules, PLANNING_MODULE)
  const [today, refreshDay] = useAttendanceDay()
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  // Pencere açılırken okunan sınıf sürümü; odak tazelemesi onu değiştirmez (`pinnedClassVersion`).
  const [pin, setPin] = useState<VersionPin | null>(null)

  // Öğretmen `teachers` okumasında yalnız kendi kaydını görür; atamalar ders verdiği sınıfları verir.
  const teachers = useCollectionAll<TeacherRecord>('teachers', {})
  const assignments = useCollectionAll<AssignmentRecord>('assignments', {})
  const classes = useCollectionAll<ClassRecord>('classes', {})
  const subjects = useCollectionAll<SubjectRecord>('subjects', {})
  const taken = useCollectionAll<AttendanceRecord>('attendance', {
    filters: { dateFrom: today, dateTo: today },
  })
  const lessons = useLessonsInRange({ dateFrom: today, dateTo: today }, { enabled: planningOpen })

  const teacherId = teachers.data?.[0]?.record.id ?? ''
  const sections = useMemo(() => {
    if (!teachers.data || !assignments.data || !classes.data || !subjects.data || !taken.data)
      return undefined
    if (planningOpen && !lessons.data) return undefined
    return attendanceTargets({
      lessons: planningOpen ? (lessons.data ?? []) : null,
      today,
      classNames: new Map(classes.data.map((row) => [row.id, row.record.name])),
      subjectNames: new Map(subjects.data.map((row) => [row.id, row.record.name])),
      teachingClassIds: teachingClassIds(
        assignments.data.map((row) => row.record),
        teacherId,
      ),
      takenClassIds: new Set(taken.data.map((row) => row.record.classId)),
    })
  }, [
    teachers.data,
    assignments.data,
    classes.data,
    subjects.data,
    taken.data,
    lessons.data,
    planningOpen,
    today,
    teacherId,
  ])
  const queries = [teachers, assignments, classes, subjects, taken]
  const lessonError = planningOpen && lessons.error ? toApiError(lessons.error) : null
  const error = queries.find((query) => query.error)?.error ?? lessonError
  const selected = sections
    ? [...sections.lessons, ...sections.classes].find((target) => target.key === selectedKey)
    : undefined

  // Sınıf sürümü (`If-Match`) eskimesin: açılışta ve çakışmadan sonra sınıflar tazelenir, gelen
  // sürüm hedefe sabitlenir. Hata olursa eldeki sürüm sabitlenir; eskiyse sunucu 409 verir.
  const repin = (target: AttendanceTarget) => {
    void classes.refetch().then((result) => {
      const version = result.data?.find((row) => row.id === target.classId)?.version
      setPin({ key: target.key, version })
    })
  }

  const openTarget = (target: AttendanceTarget) => {
    // Gün eskidiyse önce yeni güne geçilir; dünün dersi açılmaz.
    if (isStaleDay(today)) {
      refreshDay()
      notify('Gün değişti; bugünkü dersler yeniden yüklendi.', 'error')
      return
    }
    setSelectedKey(target.key)
    setPin(null)
    repin(target)
  }

  return (
    <>
      <View style={{ gap: 6 }}>
        <T muted>
          {planningOpen
            ? 'Bugünkü dersleriniz. Yoklama almak için derse ya da sınıfa dokunun.'
            : 'Ders verdiğiniz sınıflar. Bugünkü yoklama için sınıfa dokunun.'}
        </T>
        <T muted size={13}>
          Yoklama sınıf ve gün bazındadır; aynı sınıfın bugünkü dersleri tek kaydı paylaşır.
        </T>
      </View>
      {error ? (
        <QueryError
          error={error}
          onRetry={() => {
            for (const query of queries) if (query.error) void query.refetch()
            if (lessonError) void lessons.refetch()
          }}
        />
      ) : !sections ? (
        <ListLoading label="Bugünkü dersler yükleniyor…" />
      ) : sections.lessons.length === 0 && sections.classes.length === 0 ? (
        planningOpen ? (
          <Empty
            title="Bugün yoklama alınacak ders yok"
            text="İptal edilen dersler burada görünmez; ders atamaları yönetimden yapılır."
          />
        ) : (
          <Empty title="Ders verdiğiniz sınıf yok" text="Ders atamaları yönetimden yapılır." />
        )
      ) : planningOpen ? (
        <>
          <Section title="Bugünkü dersler">
            {sections.lessons.length > 0 ? (
              <TargetList targets={sections.lessons} onOpen={openTarget} />
            ) : (
              <T muted>Bugün programda dersiniz yok. İptal edilen dersler görünmez.</T>
            )}
          </Section>
          {sections.classes.length > 0 && (
            <Section title="Bugün dersi olmayan sınıflar">
              <TargetList targets={sections.classes} onOpen={openTarget} />
            </Section>
          )}
        </>
      ) : (
        <TargetList targets={sections.classes} onOpen={openTarget} />
      )}
      {selected && (
        <AttendanceSheet
          key={selected.key}
          target={selected}
          classVersion={pinnedClassVersion(pin, selected.key).version}
          versionPending={pinnedClassVersion(pin, selected.key).pending}
          onRepin={() => repin(selected)}
          today={today}
          onDayChanged={() => {
            setSelectedKey(null)
            refreshDay()
            notify('Gün değişti; bugünkü dersler yeniden yüklendi.', 'error')
          }}
          onClose={() => setSelectedKey(null)}
        />
      )}
    </>
  )
}

/**
 * Öğretmen: yoklama (web `ogretmen/yoklama`). İki sekme: bugünkü yoklamayı alma ve yoklama geçmişi
 * (salt okunur). Devamsızlık bildirimi geçmiş sekmesini açar (`route.params.tab`).
 */
export default function TeacherAttendance({
  route,
  navigation,
}: ApiScreenProps<'TeacherAttendance'>) {
  const session = useApiSession()
  const open = canOpenScreen(session, 'TeacherAttendance')
  const [tab, setTab] = useRouteTab<TeacherAttendanceTab>(
    route.params,
    DEFAULT_TEACHER_ATTENDANCE_TAB,
    () => navigation.setParams({ tab: undefined }),
  )
  if (!open)
    return (
      <Screen>
        <Empty title="Modül kullanıma kapalı" text="Yönetici modül tercihlerini değiştirebilir." />
      </Screen>
    )
  return (
    <Screen>
      <Tabs value={tab} onChange={setTab} options={TEACHER_ATTENDANCE_TABS} />
      {tab === 'gecmis' ? <AttendanceHistory /> : <TodayAttendance />}
    </Screen>
  )
}
