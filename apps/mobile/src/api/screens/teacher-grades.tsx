import { useMemo, useState } from 'react'
import { View } from 'react-native'
import type { State } from '@kampus/school-core/data/seed.ts'
import { dateLabel, dayKey } from '@kampus/school-core/lib/format.ts'
import { GRADE_TYPE_LABELS } from '@kampus/school-core/lib/grades.ts'
import { useRecordGrade, useUpdateGrade } from '@kampus/react-shared/use-academic-commands.ts'
import { useCollectionAll } from '@kampus/react-shared/use-collection.ts'
import {
  Button,
  Empty,
  Field,
  Select,
  Sheet,
  T,
  DateField,
  useColors,
} from '../../ui/components.tsx'
import { ListRow, Notice, Section } from '../../ui/SchoolLayout.tsx'
import {
  displayScore,
  evaluationProblem,
  existingGrades,
  GRADE_TERM_CHOICES,
  gradeClassIds,
  gradeCreateInput,
  gradeTypeChoices,
  gradeUpdateInput,
  knownEvaluations,
  defaultGradeTerm,
  pinVersions,
  runGradeSave,
  settleSave,
  planGradeSave,
  withPinnedVersions,
  saveSummary,
  SKIPPED_MESSAGE,
  teachingSubjectIds,
  withoutSaved,
  type EvaluationKey,
  type GradeSaveResult,
  type VersionPins,
} from '../grade-entry.ts'
import { ListLoading, QueryError, useNotify } from '../shell.ts'

type ClassRecord = State['classes'][number]
type SubjectRecord = State['subjects'][number]
type StudentRecord = State['students'][number]
type TeacherRecord = State['teachers'][number]
type AssignmentRecord = State['assignments'][number]
type GradeRecord = State['grades'][number]

const typeLabel = (type: EvaluationKey['assessmentType']) =>
  GRADE_TYPE_LABELS[type].charAt(0).toLocaleUpperCase('tr') + GRADE_TYPE_LABELS[type].slice(1)

type SheetProps = {
  evaluation: EvaluationKey
  className: string
  subjectName: string
  onClose: () => void
}

/**
 * Bir değerlendirmenin (sınıf, ders, tür, dönem, gün) öğrenci listesi: kayıtsız öğrenciye puan girilir
 * (yeni not), kayıtlıda puan değiştirilirse gerekçeyle düzeltilir (web `GradeEntryPanel`/`GradePanel`).
 * Dokunulmayan öğrenciye istek atılmaz. Her not tek istektir (`POST /grades`, `PATCH /grades/:id`),
 * sırayla gider; ekran yalnız sunucu yanıtından sonra değişir. Başarısız kayıtta girilen puanlar ve
 * gerekçe korunur, hata öğrencinin altında Türkçe gösterilir; ağ/5xx belirsizliğinde kalan öğrenciler
 * gönderilmez. Hiçbir şey cihaza yazılmaz.
 */
function GradeEntrySheet({ evaluation, className, subjectName, onClose }: SheetProps) {
  const c = useColors()
  const notify = useNotify()
  const students = useCollectionAll<StudentRecord>('students', {
    filters: { classId: evaluation.classId },
  })
  const grades = useCollectionAll<GradeRecord>('grades', {
    filters: {
      classId: evaluation.classId,
      subjectId: evaluation.subjectId,
      dateFrom: evaluation.date,
      dateTo: evaluation.date,
    },
  })
  const record = useRecordGrade()
  const update = useUpdateGrade()
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [topic, setTopic] = useState('')
  const [reason, setReason] = useState('')
  const [attempted, setAttempted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [results, setResults] = useState<Record<string, GradeSaveResult>>({})

  const active = useMemo(
    () => (students.data ?? []).map((row) => row.record).filter((row) => row.isActive !== false),
    [students.data],
  )
  const ids = useMemo(() => active.map((student) => student.id), [active])
  const live = useMemo(
    () => existingGrades(grades.data ?? [], evaluation),
    [grades.data, evaluation],
  )
  // Düzeltmenin `If-Match` sürümü liste ilk yüklendiğinde sabitlenir; odak tazelemesi onu değiştirmez.
  const [pins, setPins] = useState<VersionPins | null>(null)
  if (pins === null && grades.data) setPins(pinVersions(live))
  const existing = useMemo(() => withPinnedVersions(live, pins), [live, pins])
  const plan = planGradeSave({ studentIds: ids, existing, edits, reason })
  const planBy = new Map(plan.items.map((item) => [item.studentId, item]))
  const loading = !students.data || !grades.data
  const loadError = students.error ?? grades.error
  // Veri varken (kayıttan sonra tazeleme koptu) hata listenin üstünde uyarıdır; liste ve alt bilgi kalır.
  const blocking = loading ? loadError : undefined
  const failed = Object.values(results).filter((item) => item.status !== 'saved').length
  const hasNew = active.some((student) => !existing.has(student.id))

  const retry = () => {
    if (students.error) void students.refetch()
    if (grades.error) void grades.refetch()
  }

  const setScore = (studentId: string, text: string) => {
    setEdits((current) => ({ ...current, [studentId]: text }))
    setResults((current) =>
      Object.fromEntries(Object.entries(current).filter(([id]) => id !== studentId)),
    )
  }

  async function save() {
    setAttempted(true)
    if (!plan.ready || saving) return
    setSaving(true)
    // Hata öğrencinin altında gösterilir; aynı mesaj toast olarak da çıkmaz.
    const outcome = await runGradeSave(plan.items, async (item) =>
      item.kind === 'create'
        ? await record.submit(gradeCreateInput(evaluation, item, topic), { silent: () => true })
        : await update.submit(gradeUpdateInput(item, reason), { silent: () => true }),
    )
    // Liste sunucudan tazelenmeden kayıtlı puan eski görünürdü; tazelenene kadar kilit açılmaz.
    // Tazeleme ağ hatasıyla biterse eldeki liste kalır (hata listenin üstünde uyarı olur).
    const refreshed = await grades.refetch()
    const fresh =
      refreshed.isError || !refreshed.data ? null : existingGrades(refreshed.data, evaluation)
    const settled = settleSave({ items: plan.items, results: outcome, pins, fresh })
    setPins(settled.pins)
    setEdits(withoutSaved(edits, outcome))
    setResults(settled.results)
    setSaving(false)
    if (Object.values(outcome).every((item) => item.status === 'saved')) {
      const done = saveSummary(outcome)
      if (done) notify(done)
      onClose()
    }
  }

  const counts = [
    plan.created > 0 ? `${plan.created} yeni not` : '',
    plan.updated > 0 ? `${plan.updated} düzeltme` : '',
  ].filter(Boolean)
  const summary = saveSummary(results)
  return (
    <Sheet
      visible
      pinFooter
      title={`${className} · ${subjectName}`}
      onClose={onClose}
      footer={
        !loading && active.length > 0 ? (
          <View style={{ gap: 10 }}>
            <T muted size={14} accessibilityLiveRegion="polite">
              {counts.length > 0 ? counts.join(' · ') : 'Kaydedilecek değişiklik yok.'}
              {plan.invalid > 0 ? ` · ${plan.invalid} puan düzeltilmeli` : ''}
            </T>
            {failed > 0 && (
              <Notice
                tone="red"
                title="Bazı notlar kaydedilemedi"
                text={`${summary ? `${summary} ` : ''}Girdiğiniz puanlar korundu; ilgili öğrencinin altındaki iletiye bakın.`}
              />
            )}
            <Button
              accent
              icon="CircleCheck"
              disabled={saving}
              label={saving ? 'Notlar kaydediliyor' : 'Notları kaydet'}
              onPress={() => void save()}
            >
              {saving ? 'Notlar kaydediliyor…' : 'Notları kaydet'}
            </Button>
          </View>
        ) : undefined
      }
    >
      <View style={{ gap: 6 }}>
        <T bold size={16}>
          {typeLabel(evaluation.assessmentType)} · {evaluation.term}. dönem
        </T>
        <T muted size={14}>
          {dateLabel(`${evaluation.date}T09:00:00.000Z`, { year: 'numeric', weekday: 'long' })}
          {active.length > 0 ? ` · ${active.length} öğrenci` : ''}
        </T>
      </View>
      {blocking ? (
        <QueryError error={blocking} onRetry={retry} />
      ) : loading ? (
        <ListLoading label="Öğrenci listesi yükleniyor…" />
      ) : active.length === 0 ? (
        <Empty title="Aktif öğrenci yok" text="Bu sınıfta not girilecek öğrenci bulunmuyor." />
      ) : (
        <>
          {loadError && (
            <Notice
              tone="amber"
              title="Liste güncellenemedi"
              text="Bağlantı sorunu nedeniyle sunucudaki son durum alınamadı. Girdiğiniz puanlar duruyor; bağlantı gelince yeniden deneyin."
            >
              <Button icon="RefreshCw" label="Listeyi yeniden yükle" onPress={retry}>
                Yeniden dene
              </Button>
            </Notice>
          )}
          {existing.size > 0 && (
            <Notice
              title="Bu değerlendirmenin notları kayıtlı"
              text="Puanı değiştirirseniz not düzeltilir; eski puan düzeltme geçmişinde saklanır."
            />
          )}
          {hasNew && (
            <Field
              label="Kazanım / konu (isteğe bağlı, yeni notlara)"
              value={topic}
              onChange={setTopic}
              maxLength={200}
              editable={!saving}
              compact
            />
          )}
          {existing.size > 0 && (
            <Field
              label="Düzeltme gerekçesi"
              value={reason}
              onChange={setReason}
              multiline
              compact
              maxLength={500}
              editable={!saving}
              hint="Yalnız kayıtlı bir notu değiştirirken gerekir."
              {...(attempted && plan.reasonError ? { error: plan.reasonError } : {})}
            />
          )}
          <View style={{ gap: 12 }} accessibilityRole="list">
            {active.map((student) => {
              const item = planBy.get(student.id)
              const current = existing.get(student.id)
              const result = results[student.id]
              const message =
                result?.status === 'failed'
                  ? result.message
                  : result?.status === 'skipped'
                    ? SKIPPED_MESSAGE
                    : attempted && item?.kind === 'invalid'
                      ? item.message
                      : undefined
              const status =
                item?.kind === 'create'
                  ? 'Yeni not'
                  : item?.kind === 'update'
                    ? 'Düzeltilecek'
                    : result?.status === 'saved'
                      ? `Kaydedildi: ${result.score}`
                      : current
                        ? current.fromQuiz
                          ? 'Quizden aktarıldı; düzeltilemez'
                          : `Kayıtlı puan: ${current.score}`
                        : 'Not girilmedi'
              return (
                <View
                  key={student.id}
                  style={{
                    gap: 8,
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
                  <T muted size={13} accessibilityLiveRegion="polite">
                    {status}
                  </T>
                  <Field
                    label={`${student.name} puanı, 0 ile 100 arası`}
                    hideLabel
                    value={displayScore(
                      current,
                      edits[student.id] ??
                        (result?.status === 'saved' ? String(result.score) : undefined),
                    )}
                    onChange={(text) => setScore(student.id, text)}
                    keyboard="number-pad"
                    maxLength={3}
                    placeholder="Puan (0-100)"
                    editable={!saving && !current?.fromQuiz}
                    {...(message ? { error: message } : {})}
                  />
                </View>
              )
            })}
          </View>
        </>
      )}
    </Sheet>
  )
}

/**
 * Öğretmen: Not girişi ve düzeltme (web `Sınıflarım` > "Not listesi"nin yazma tarafı). Seçenekler
 * yalnız öğretmenin ders atamalarındandır (başka sınıf ve ders seçilemez; yetkiyi sunucu yine
 * denetler, DOM-AKD-054). Seçilen sınıf ve dersin daha önce girilmiş değerlendirmeleri listelenir,
 * dokununca tür, dönem ve tarih dolar. Dönem ortalaması saklanmaz, kayıtlardan hesaplanır.
 */
export function TeacherGrades() {
  const [open, setOpen] = useState<EvaluationKey | null>(null)
  const [classId, setClassId] = useState('')
  const [subjectId, setSubjectId] = useState('')
  const [type, setType] = useState('sinav')
  const [term, setTerm] = useState(() => String(defaultGradeTerm(dayKey())))
  const [date, setDate] = useState(() => dayKey())
  const [problem, setProblem] = useState<string | null>(null)

  const teachers = useCollectionAll<TeacherRecord>('teachers')
  const assignments = useCollectionAll<AssignmentRecord>('assignments')
  const classes = useCollectionAll<ClassRecord>('classes')
  const subjects = useCollectionAll<SubjectRecord>('subjects')
  const history = useCollectionAll<GradeRecord>(
    'grades',
    { filters: { classId, subjectId } },
    { enabled: classId !== '' && subjectId !== '' },
  )
  const queries = [teachers, assignments, classes, subjects]
  const error = queries.find((query) => query.error)?.error

  const teacherId = teachers.data?.[0]?.record.id ?? ''
  const rows = useMemo(() => assignments.data?.map((row) => row.record) ?? [], [assignments.data])
  const classNames = useMemo(
    () => new Map((classes.data ?? []).map((row) => [row.id, row.record])),
    [classes.data],
  )
  const subjectNames = useMemo(
    () => new Map((subjects.data ?? []).map((row) => [row.id, row.record.name])),
    [subjects.data],
  )
  const classOptions = useMemo(
    () =>
      [...gradeClassIds(rows, teacherId)]
        .map((id) => ({ value: id, label: classNames.get(id)?.name ?? 'Sınıf' }))
        .sort((left, right) => left.label.localeCompare(right.label, 'tr', { numeric: true })),
    [rows, teacherId, classNames],
  )
  const subjectOptions = teachingSubjectIds(rows, teacherId, classId).map((id) => ({
    value: id,
    label: subjectNames.get(id) ?? 'Ders',
  }))
  const typeOptions = gradeTypeChoices(classNames.get(classId)?.grade)
  const known = useMemo(() => knownEvaluations(history.data ?? []), [history.data])

  const chooseClass = (next: string) => {
    setClassId(next)
    setProblem(null)
    const only = teachingSubjectIds(rows, teacherId, next)
    // Tek dersi olan sınıfta ders kendiliğinden seçilir; aksi hâlde eski seçim geçersizdir.
    setSubjectId(only.length === 1 ? (only[0] ?? '') : '')
    if (type === 'katilim' && (classNames.get(next)?.grade ?? 0) > 8) setType('sinav')
  }

  const openList = () => {
    const key = {
      classId,
      subjectId,
      assessmentType: typeOptions.find((option) => option.value === type)?.value,
      term: term === '2' ? (2 as const) : term === '1' ? (1 as const) : undefined,
      date,
    }
    const issue = evaluationProblem(key, dayKey())
    setProblem(issue)
    if (issue === null && key.assessmentType && key.term)
      setOpen({ ...key, assessmentType: key.assessmentType, term: key.term })
  }

  if (error)
    return (
      <QueryError
        error={error}
        onRetry={() => {
          for (const query of queries) if (query.error) void query.refetch()
        }}
      />
    )
  if (queries.some((query) => !query.data)) return <ListLoading label="Sınıflarınız yükleniyor…" />
  if (classOptions.length === 0)
    return (
      <Empty
        title="Ders verdiğiniz sınıf yok"
        text="Not girmek için bir sınıfta ders ataması gerekir; atamalar yönetimden yapılır."
      />
    )
  return (
    <>
      <View style={{ gap: 16 }}>
        <T muted>
          Sınıf ve dersi seçin; öğrenci listesinde puan girin ya da kayıtlı notu gerekçeyle
          düzeltin.
        </T>
        <Select label="Sınıf" value={classId} options={classOptions} onChange={chooseClass} />
        <Select
          label="Ders"
          value={subjectId}
          options={subjectOptions}
          onChange={(next) => {
            setSubjectId(next)
            setProblem(null)
          }}
        />
        {known.length > 0 && (
          <Section title="Girilmiş değerlendirmeler">
            <View style={{ gap: 10 }} accessibilityRole="list">
              {known.slice(0, 6).map((item) => (
                <ListRow
                  key={`${item.key.assessmentType}|${item.key.term}|${item.key.date}`}
                  card
                  title={`${typeLabel(item.key.assessmentType)} · ${item.key.term}. dönem`}
                  subtitle={`${dateLabel(`${item.key.date}T09:00:00.000Z`, { year: 'numeric' })} · ${item.count} not`}
                  label={`${typeLabel(item.key.assessmentType)}, ${item.key.term}. dönem, ${item.key.date}, ${item.count} not. Seç`}
                  onPress={() => {
                    setType(item.key.assessmentType)
                    setTerm(String(item.key.term))
                    setDate(item.key.date)
                    setProblem(null)
                  }}
                />
              ))}
            </View>
          </Section>
        )}
        <Select
          label="Değerlendirme türü"
          value={type}
          options={typeOptions}
          required
          onChange={(next) => setType(next)}
        />
        <Select
          label="Dönem"
          value={term}
          options={GRADE_TERM_CHOICES}
          required
          onChange={(next) => setTerm(next)}
        />
        <DateField label="Tarih" value={date} onChange={(next) => setDate(next)} />
        {problem && <Notice tone="red" title="Seçimi tamamlayın" text={problem} />}
        <Button accent icon="Award" label="Öğrenci listesini aç" onPress={openList}>
          Öğrenci listesini aç
        </Button>
      </View>
      {open && (
        <GradeEntrySheet
          // Başka değerlendirmeye geçince girilen puanlar taşınmaz.
          key={`${open.classId}|${open.subjectId}|${open.assessmentType}|${open.term}|${open.date}`}
          evaluation={open}
          className={classNames.get(open.classId)?.name ?? 'Sınıf'}
          subjectName={subjectNames.get(open.subjectId) ?? 'Ders'}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  )
}
