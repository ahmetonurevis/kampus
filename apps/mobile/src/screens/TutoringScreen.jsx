import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import {
  automationExams,
  automationSchemas,
  planTutoring,
  tutoringSessions,
  runAssessment,
} from '@kampus/school-core/lib/assessment-automation.ts'
import { dateLabel, dayKey, timeLabel } from '@kampus/school-core/lib/format.ts'
import { recordError, useSchool } from '../store/SchoolProvider.jsx'
import {
  Badge,
  Button,
  Card,
  DateField,
  Empty,
  Field,
  Heading,
  Select,
  Sheet,
  T,
  useColors,
} from '../ui/components.jsx'
import { ListRow, Notice, Screen, Section } from '../ui/SchoolLayout.jsx'
import { useMinute } from '../ui/use-minute.js'

const ATTENDANCE = ['Geldi', 'Gelmedi', 'İzinli'].map((value) => ({ value, label: value }))
const stamp = (value) => `${dateLabel(value)} ${timeLabel(value)}`

export default function TutoringScreen({ route }) {
  const { data, session, commit, notify, busy } = useSchool(),
    c = useColors()
  const minute = useMinute()
  const now = minute * 60000
  const canManage = ['yonetici', 'ogretmen'].includes(session.role)
  const exams = useMemo(
    () => automationExams(data, session),
    [data.mockExams, data.students, data.classes, session.role, session.childId],
  )
  const [input, setInput] = useState(() => ({
    examId: exams.find((e) => e.id === route.params?.examId)?.id || exams[0]?.id || '',
    threshold: '70',
    fromDate: dayKey(new Date(Date.now() + 86400000)),
    toDate: dayKey(new Date(Date.now() + 14 * 86400000)),
    duration: '30',
    maxGroupSize: '12',
    branchId: '',
    subjectId: '',
  }))
  const [plan, setPlan] = useState(null),
    [errors, setErrors] = useState({}),
    [error, setError] = useState(''),
    [selectedId, setSelectedId] = useState(''),
    [slotInput, setSlotInput] = useState(null),
    [slotErrors, setSlotErrors] = useState({}),
    [marks, setMarks] = useState(null),
    [cancelReason, setCancelReason] = useState(null),
    [confirmSlot, setConfirmSlot] = useState(null)

  const teachers = data.teachers.filter(
    (t) => t.isActive && (session.role === 'yonetici' || t.id === 't1'),
  )
  const subjects = data.subjects.filter(
    (s) =>
      data.mockExams.find((e) => e.id === input.examId)?.subjectIds.includes(s.id) &&
      (session.role !== 'ogretmen' || s.id === data.teachers.find((t) => t.id === 't1')?.subjectId),
  )
  const subjectName = (id) => data.subjects.find((s) => s.id === id)?.name || id
  const studentName = (id) => data.students.find((s) => s.id === id)?.name || id
  const branchName = (id) => data.branches.find((b) => b.id === id)?.name || id
  const teacherName = (id) => data.teachers.find((t) => t.id === id)?.name || id
  const sessions = useMemo(
    () =>
      tutoringSessions(data, session).map((s) => ({
        ...s,
        title: `${subjectName(s.subjectId)} · ${s.topic}`,
        teacher: teacherName(s.teacherId),
        campus: branchName(s.branchId),
      })),
    [data, session.role, session.childId],
  )
  const selected = sessions.find((s) => s.id === selectedId)
  const slots = data.availability
    .filter((s) => Date.parse(s.date) > now && teachers.some((t) => t.id === s.teacherId))
    .map((s) => ({ ...s, teacher: teacherName(s.teacherId) }))
  const previewRows = plan
    ? [
        ...plan.sessions.map((s, i) => ({
          ...s,
          id: `planned-${i}`,
          teacher: teacherName(s.teacherId),
          status: 'Planlanabilir',
        })),
        ...plan.unresolved.map((s, i) => ({
          ...s,
          id: `unresolved-${i}`,
          teacher: '—',
          room: '—',
          status: 'Yerleştirilemedi',
        })),
      ]
    : []

  function changeInput(key, value) {
    setInput((old) => ({ ...old, [key]: value, ...(key === 'examId' ? { subjectId: '' } : {}) }))
    setPlan(null)
    setError('')
    setErrors({})
  }
  function showError(exception) {
    recordError(exception, 'tutoring', 'warn')
    const message =
      exception.issues?.[0]?.message ||
      (exception.name === 'Error'
        ? exception.message
        : 'Etüt işlemi tamamlanamadı. Tekrar deneyin.')
    setError(message)
    notify(message, 'error')
  }
  const issuesByField = (issues) => {
    const found = {}
    for (const issue of issues) found[issue.path.join('.')] ||= issue.message
    return found
  }
  function previewPlan() {
    const parsed = automationSchemas.plan.safeParse(input)
    if (!parsed.success) {
      setErrors(issuesByField(parsed.error.issues))
      notify(parsed.error.issues[0].message, 'error')
      return
    }
    try {
      setPlan(planTutoring(data, session, input))
      setError('')
    } catch (exception) {
      setPlan(null)
      showError(exception)
    }
  }
  async function savePlan() {
    if (!plan?.sessions.length) return
    const ok = await commit(
      (next, makeId) =>
        runAssessment(
          next,
          session,
          'plan',
          { ...input, expectedPlan: JSON.stringify(plan) },
          makeId,
        ),
      'Otomatik etüt planı kaydedildi.',
    )
    if (ok) setPlan(null)
  }
  function openSlot() {
    setSlotErrors({})
    setSlotInput({
      teacherId: teachers[0]?.id || '',
      date: input.fromDate,
      time: '16:00',
      duration: '30',
    })
  }
  async function saveSlot() {
    const value = {
      teacherId: slotInput.teacherId,
      date: `${slotInput.date}T${slotInput.time}+03:00`,
      duration: slotInput.duration,
    }
    const parsed = automationSchemas.slot.safeParse(value)
    if (!parsed.success) {
      setSlotErrors(issuesByField(parsed.error.issues))
      notify(parsed.error.issues[0].message, 'error')
      return
    }
    const ok = await commit(
      (next, makeId) => runAssessment(next, session, 'slot', value, makeId),
      'Öğretmen uygunluk saati eklendi.',
    )
    if (ok) {
      setSlotInput(null)
      setPlan(null)
    }
  }
  async function removeSlot() {
    const ok = await commit(
      (next, makeId) => runAssessment(next, session, 'slot-remove', {}, makeId, confirmSlot.id),
      'Uygunluk saati kaldırıldı.',
    )
    if (ok) {
      setConfirmSlot(null)
      setPlan(null)
    }
  }
  const startAttendance = () =>
    setMarks(
      Object.fromEntries(selected.studentIds.map((id) => [id, selected.attendance[id] || 'Geldi'])),
    )
  async function saveAttendance() {
    const ok = await commit(
      (next, makeId) => runAssessment(next, session, 'attendance', { marks }, makeId, selected.id),
      'Etüt yoklaması kaydedildi.',
    )
    if (ok) setMarks(null)
  }
  async function cancel() {
    const ok = await commit(
      (next, makeId) =>
        runAssessment(next, session, 'cancel', { reason: cancelReason }, makeId, selected.id),
      'Etüt iptal edildi.',
    )
    if (ok) {
      setCancelReason(null)
      setPlan(null)
    }
  }
  const closeDetail = () => {
    setSelectedId('')
    setMarks(null)
    setCancelReason(null)
  }

  if (!data.modules.tutoring)
    return (
      <Screen>
        <Notice
          title="Modül kullanıma kapalı"
          text="Yönetici modül ayarlarını değiştirebilir."
          tone="amber"
        />
      </Screen>
    )
  const valid = (list) => list.filter((e) => e)
  return (
    <Screen>
      <Heading
        title="Otomatik Etüt"
        subtitle="Eksik kazanımlara göre uygun öğretmen, saat ve derslikle etüt planlayın."
      />
      {canManage && (
        <Section panel title="Eksik kazanımlardan etüt planla">
          <T muted size={14}>
            Güncel optik soru sonuçları kullanılır. Eşiğin altındaki kazanımlar kampüs, sınıf düzeyi
            ve ders bazında gruplanır. Ders, randevu, etkinlik ve diğer etüt çakışmaları kontrol
            edilir.
          </T>
          {!data.modules.exams && (
            <Notice
              title="Deneme sınavları modülü kapalı"
              text="Etüt planlamak için deneme sınavları modülünü açın."
              tone="amber"
            />
          )}
          <Select
            label="Sınav"
            required
            value={input.examId}
            options={exams.map((e) => ({ value: e.id, label: e.title }))}
            onChange={(v) => changeInput('examId', v)}
          />
          <FieldError message={errors.examId} />
          <Field
            label="Kazanım başarı eşiği (%)"
            keyboard="number-pad"
            value={input.threshold}
            onChange={(v) => changeInput('threshold', v)}
          />
          <FieldError message={errors.threshold} />
          <DateField
            label="Etüt başlangıç tarihi"
            value={input.fromDate}
            onChange={(v) => changeInput('fromDate', v)}
          />
          <FieldError message={errors.fromDate} />
          <DateField
            label="Etüt bitiş tarihi"
            value={input.toDate}
            onChange={(v) => changeInput('toDate', v)}
          />
          <FieldError message={errors.toDate} />
          <Field
            label="Etüt süresi (dakika)"
            keyboard="number-pad"
            value={input.duration}
            onChange={(v) => changeInput('duration', v)}
          />
          <FieldError message={errors.duration} />
          <Field
            label="Grup başına en fazla öğrenci"
            keyboard="number-pad"
            value={input.maxGroupSize}
            onChange={(v) => changeInput('maxGroupSize', v)}
          />
          <FieldError message={errors.maxGroupSize} />
          <Select
            label="Kampüs"
            value={input.branchId}
            options={[
              { value: '', label: 'Tüm kampüsler' },
              ...data.branches
                .filter((b) => b.isActive)
                .map((b) => ({ value: b.id, label: b.name })),
            ]}
            onChange={(v) => changeInput('branchId', v)}
          />
          <Select
            label="Ders"
            value={input.subjectId}
            options={[
              { value: '', label: 'Yetkimdeki tüm dersler' },
              ...subjects.map((s) => ({ value: s.id, label: s.name })),
            ]}
            onChange={(v) => changeInput('subjectId', v)}
          />
          {!!error && (
            <T accessibilityRole="alert" style={{ color: c.red }}>
              {error}
            </T>
          )}
          <T muted size={13}>
            Öğretmenin en az etüt süresi kadar uygunluk aralığı olmalıdır. Derslik kapasitesi grup
            sınırını ayrıca kısıtlar. Aynı sınav/kazanım için mevcut etüt öğrencileri tekrar
            atanmaz.
          </T>
          <Button primary disabled={!data.modules.exams || busy} onPress={previewPlan}>
            Etüt planını önizle
          </Button>
          <Button icon="Plus" onPress={openSlot}>
            Uygunluk saati ekle
          </Button>
        </Section>
      )}
      {plan && (
        <Section panel title="Etüt planı önizlemesi">
          <T muted size={14}>
            {plan.evaluatedStudents} öğrenci değerlendirildi · {plan.sessions.length} etüt
            planlanabilir · {plan.unresolved.length} grup yerleştirilemedi · {plan.covered.length}{' '}
            öğrenci/kazanım zaten etütte.
          </T>
          {!plan.evaluatedStudents && (
            <Notice
              title="Optik değerlendirme yok"
              text="Bu sınavda güncel optik kazanım değerlendirmesi yok. Önce cevap dosyasını değerlendirin."
              tone="amber"
            />
          )}
          {previewRows.length ? (
            <View style={{ gap: 12 }}>
              {previewRows.map((row) => (
                <ListRow
                  key={row.id}
                  card
                  title={`${subjectName(row.subjectId)} · ${row.topic}`}
                  eyebrow={row.date ? stamp(row.date) : undefined}
                  subtitle={valid([
                    `${row.teacher} · ${branchName(row.branchId)} · Derslik ${row.room}`,
                    row.studentIds.map(studentName).join(', '),
                    row.reason,
                  ]).join('\n')}
                  badge={<Badge text={row.status} />}
                />
              ))}
            </View>
          ) : (
            <Empty
              title="Etüt gerekmiyor"
              text="Eşiğin altında yeni etüt gerektiren kazanım bulunamadı."
            />
          )}
          {!!plan.unresolved.length && (
            <T muted size={13}>
              Yerleştirilemeyen gruplar kaydedilmez. Uygunluk saati ekleyip tekrar
              planlayabilirsiniz.
            </T>
          )}
          <Button accent disabled={!plan.sessions.length || busy} onPress={savePlan}>
            {busy ? 'Kaydediliyor…' : 'Onayla ve etütleri oluştur'}
          </Button>
          <Button onPress={() => setPlan(null)}>Önizlemeyi kapat</Button>
        </Section>
      )}
      <Section title="Etütlerim">
        <T muted size={13}>
          {canManage
            ? 'Görev kapsamınızdaki etütler ve yoklamaları'
            : 'Öğrenciye atanan kazanım etütleri'}
        </T>
        {sessions.length ? (
          <View style={{ gap: 12 }}>
            {sessions.map((s) => (
              <ListRow
                key={s.id}
                card
                title={s.title}
                eyebrow={stamp(s.date)}
                subtitle={`${s.teacher} · ${s.campus} · Derslik ${s.room}\n${s.studentIds
                  .map(studentName)
                  .join(', ')}`}
                badge={<Badge text={s.status} />}
                label={`${s.title}, etüt ayrıntısı`}
                onPress={() => setSelectedId(s.id)}
              />
            ))}
          </View>
        ) : (
          <Empty title="Henüz atanmış etüt yok" text="Planlanan etütler burada görünür." />
        )}
      </Section>
      {canManage && (
        <Section title="Öğretmen uygunluk saatleri">
          <T muted size={13}>
            Planlayıcı bu aralıkları kullanır; mevcut randevu ve etütler ayrıca kontrol edilir.
          </T>
          {slots.length ? (
            <View style={{ gap: 12 }}>
              {slots.map((slot) => (
                <Card key={slot.id}>
                  <T bold>{slot.teacher}</T>
                  <T muted size={14}>
                    {stamp(slot.date)} · {slot.duration} dakika
                  </T>
                  <Button small onPress={() => setConfirmSlot(slot)}>
                    Uygunluğu kaldır
                  </Button>
                </Card>
              ))}
            </View>
          ) : (
            <Empty title="Uygunluk saati yok" text="Gelecek uygunluk saati yok." />
          )}
        </Section>
      )}
      {selectedId && (
        <Sheet visible title={selected?.title || 'Etüt bulunamadı'} onClose={closeDetail}>
          {selected ? (
            <>
              <Badge text={selected.status} />
              <T>
                {dateLabel(selected.date, { year: 'numeric' })} {timeLabel(selected.date)} ·{' '}
                {selected.duration} dakika
              </T>
              <T>
                {selected.teacher} · {selected.campus} · Derslik {selected.room}
              </T>
              {selected.studentIds.map((studentId) => (
                <T key={studentId}>
                  {studentName(studentId)} · Kazanım başarısı %
                  {selected.scores.find((s) => s.studentId === studentId)?.percent} ·{' '}
                  {selected.attendance[studentId] || 'Yoklama alınmadı'}
                </T>
              ))}
              {!!selected.cancelReason && <T>İptal nedeni: {selected.cancelReason}</T>}
              {canManage && selected.status !== 'İptal' && (
                <View style={{ gap: 10 }}>
                  <Button disabled={Date.parse(selected.date) > now} onPress={startAttendance}>
                    Yoklama al / güncelle
                  </Button>
                  {selected.status !== 'Tamamlandı' && (
                    <Button danger onPress={() => setCancelReason('')}>
                      Etüdü iptal et
                    </Button>
                  )}
                </View>
              )}
              {canManage && Date.parse(selected.date) > now && (
                <T muted size={13}>
                  Yoklama etüt başladığında alınabilir.
                </T>
              )}
            </>
          ) : (
            <T>Etüt mevcut rol veya çocuk kapsamında bulunamadı.</T>
          )}
        </Sheet>
      )}
      {slotInput && (
        <Sheet
          visible
          title="Uygunluk saati ekle"
          onClose={() => !busy && setSlotInput(null)}
          footer={
            <Button primary disabled={busy} onPress={saveSlot}>
              {busy ? 'Kaydediliyor…' : 'Uygunluk saatini kaydet'}
            </Button>
          }
        >
          <Select
            label="Öğretmen"
            required
            value={slotInput.teacherId}
            options={teachers.map((t) => ({
              value: t.id,
              label: `${t.name} · ${subjectName(t.subjectId)}`,
            }))}
            onChange={(v) => setSlotInput((old) => ({ ...old, teacherId: v }))}
          />
          <FieldError message={slotErrors.teacherId} />
          <DateField
            label="Uygunluk tarihi"
            value={slotInput.date}
            onChange={(v) => setSlotInput((old) => ({ ...old, date: v }))}
          />
          <DateField
            time
            label="Uygunluk saati"
            value={slotInput.time}
            onChange={(v) => setSlotInput((old) => ({ ...old, time: v }))}
          />
          <FieldError message={slotErrors.date} />
          <Field
            label="Uygunluk süresi (dakika)"
            keyboard="number-pad"
            value={slotInput.duration}
            onChange={(v) => setSlotInput((old) => ({ ...old, duration: v }))}
          />
          <FieldError message={slotErrors.duration} />
        </Sheet>
      )}
      {marks && selected && (
        <Sheet
          visible
          title="Etüt yoklaması"
          onClose={() => !busy && setMarks(null)}
          footer={
            <Button primary disabled={busy} onPress={saveAttendance}>
              {busy ? 'Kaydediliyor…' : 'Yoklamayı kaydet'}
            </Button>
          }
        >
          {selected.studentIds.map((studentId) => (
            <Select
              key={studentId}
              required
              label={studentName(studentId)}
              value={marks[studentId]}
              options={ATTENDANCE}
              onChange={(v) => setMarks((old) => ({ ...old, [studentId]: v }))}
            />
          ))}
        </Sheet>
      )}
      {cancelReason !== null && selected && (
        <Sheet
          visible
          title="Etüdü iptal et"
          onClose={() => !busy && setCancelReason(null)}
          footer={
            <Button primary disabled={busy} onPress={cancel}>
              {busy ? 'Kaydediliyor…' : 'İptali onayla'}
            </Button>
          }
        >
          <Field
            label="İptal nedeni"
            multiline
            maxLength={500}
            value={cancelReason}
            onChange={setCancelReason}
          />
        </Sheet>
      )}
      {confirmSlot && (
        <Sheet
          visible
          compact
          title="Uygunluğu kaldır"
          onClose={() => !busy && setConfirmSlot(null)}
          footer={
            <Button primary disabled={busy} onPress={removeSlot}>
              Kaldırmayı onayla
            </Button>
          }
        >
          <T>
            {confirmSlot.teacher} · {stamp(confirmSlot.date)} uygunluğu kaldırılacak. Önceden
            oluşturulmuş etüt ve randevular korunur.
          </T>
        </Sheet>
      )}
    </Screen>
  )
}

function FieldError({ message }) {
  const c = useColors()
  return message ? (
    <T accessibilityRole="alert" size={13} style={{ color: c.red }}>
      {message}
    </T>
  ) : null
}
