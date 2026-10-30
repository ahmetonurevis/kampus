import { usePersistentDraft } from '../store/use-persistent-draft.js'
import DraftStatus from '../ui/DraftStatus.jsx'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { View, Pressable, useWindowDimensions } from 'react-native'
import { useSchool } from '../store/SchoolProvider.jsx'
import { context, nameOf } from '../model/school.ts'
import { recordAttendance } from '@kampus/school-core/lib/domain.ts'
import { dateLabel, dayKey } from '@kampus/school-core/lib/format.ts'
import {
  Button,
  Card,
  DateField,
  SearchField,
  Select,
  Sheet,
  T,
  useColors,
} from '../ui/components.jsx'
import {
  EmptyResults,
  Notice,
  Pagination,
  Screen,
  Section,
  TextAction,
} from '../ui/SchoolLayout.jsx'

export default function Attendance({ route }) {
  const { data, session, commit, busy, notify } = useSchool(),
    scope = context(data, session),
    c = useColors(),
    { fontScale } = useWindowDimensions()
  const [classId, setClassId] = useState(
    scope.teacherClasses.some((s) => s.id === route.params.classId)
      ? route.params.classId
      : scope.teacherClasses[0]?.id || '',
  )
  const [date, setDate] = useState(route.params.date || dayKey()),
    [query, setQuery] = useState(''),
    [page, setPage] = useState(0),
    [filters, setFilters] = useState(false),
    [error, setError] = useState(''),
    [saved, setSaved] = useState(false)
  const [draftClass, setDraftClass] = useState(classId),
    [draftDate, setDraftDate] = useState(date)
  const scrollRef = useRef(null)
  const students = useMemo(
    () => data.students.filter((s) => s.isActive && s.classId === classId),
    [data.students, classId],
  )
  const initialMarks = useMemo(
    () =>
      Object.fromEntries(
        students.map((student) => [
          student.id,
          data.attendance.find(
            (record) => record.studentId === student.id && dayKey(record.date) === date,
          )?.status || '',
        ]),
      ),
    [students, data.attendance, date],
  )
  const draft = usePersistentDraft(
    'attendance',
    `${classId}:${date}`,
    { marks: initialMarks },
    JSON.stringify(initialMarks),
  )
  const marks = draft.value.marks
  const setMarks = (update) =>
    draft.set((old) => ({ marks: typeof update === 'function' ? update(old.marks) : update }))
  useEffect(() => {
    setError('')
    setPage(0)
    setSaved(false)
  }, [classId, date])
  useEffect(() => setPage(0), [query])
  const filtered = students.filter((s) =>
    s.name.toLocaleLowerCase('tr').includes(query.trim().toLocaleLowerCase('tr')),
  )
  const pageSize = 6
  const current = Math.min(page, Math.max(0, Math.ceil(filtered.length / pageSize) - 1))
  function change(id, value) {
    setMarks((old) => ({ ...old, [id]: value }))
    setSaved(false)
    setError('')
  }
  async function save() {
    if (students.some((s) => !marks[s.id])) {
      setError('Kaydetmeden önce tüm öğrencilerin durumunu seç.')
      notify('Tüm öğrencilerin yoklama durumunu seç.', 'error')
      return
    }
    const ok = await commit(
      (s) => recordAttendance(s, classId, `${date}T09:00:00+03:00`, marks),
      'Yoklama kaydedildi.',
    )
    if (ok) {
      await draft.clear({ marks })
      setSaved(true)
      setError('')
    }
  }
  return (
    <>
      <Screen
        scrollRef={scrollRef}
        footer={
          students.length ? (
            <>
              {saved && (
                <Notice
                  tone="green"
                  title="Yoklama kaydedildi"
                  text={`${nameOf(data, 'classes', classId)} · ${students.length} öğrenci`}
                />
              )}
              <Button accent disabled={busy || !draft.ready || date > dayKey()} onPress={save}>
                {busy ? 'Yoklama kaydediliyor…' : 'Yoklamayı kaydet'}
              </Button>
            </>
          ) : undefined
        }
      >
        <Card soft style={{ gap: 8 }}>
          <T bold size={16}>
            {nameOf(data, 'classes', classId)} · Matematik · Selin Kaya
          </T>
          <View style={{ gap: 6 }}>
            <T muted size={14}>
              {dateLabel(`${date}T09:00:00+03:00`, { year: 'numeric' })}
            </T>
            <T muted size={14}>
              {students.length} öğrenci · {students.filter((s) => marks[s.id]).length} işaretlendi
            </T>
            <TextAction
              onPress={() => {
                setDraftClass(classId)
                setDraftDate(date)
                setFilters(true)
              }}
            >
              Sınıf veya tarih değiştir
            </TextAction>
          </View>
        </Card>
        {date > dayKey() && (
          <Notice
            tone="red"
            title="Gelecek tarih seçildi"
            text="Yoklama almak için bugünü veya geçmiş bir günü seç."
          />
        )}
        <Section
          title="Öğrenciler"
          action="Tümünü mevcut işaretle"
          onPress={() => {
            if (!draft.ready || busy) return
            setMarks(Object.fromEntries(students.map((s) => [s.id, 'present'])))
            setSaved(false)
            setError('')
          }}
        >
          <DraftStatus draft={draft} />
          <SearchField value={query} onChange={setQuery} placeholder="Öğrenci ara" />
          <T muted size={13}>
            {filtered.length} sonuç
          </T>
          <View style={{ gap: 12 }}>
            {filtered.slice(current * pageSize, current * pageSize + pageSize).map((student) => (
              <View
                key={student.id}
                style={{
                  gap: 12,
                  padding: 14,
                  borderWidth: 1,
                  borderColor: c.border,
                  borderRadius: 12,
                  backgroundColor: c.surface,
                }}
              >
                <View>
                  <T bold size={15}>
                    {student.name}
                  </T>
                  {marks[student.id] === 'late' && (
                    <T muted size={12}>
                      Geç geldi (kayıtlı)
                    </T>
                  )}
                </View>
                <View style={{ flexDirection: fontScale > 1.3 ? 'column' : 'row', gap: 6 }}>
                  {[
                    ['present', 'Mevcut', 'green'],
                    ['absent', 'Yok', 'accent'],
                    ['excused', 'Mazeretli', 'primary'],
                  ].map(([key, label, tone]) => (
                    <Pressable
                      key={key}
                      accessibilityRole="radio"
                      accessibilityLabel={`${student.name}: ${label}`}
                      aria-checked={marks[student.id] === key}
                      accessibilityState={{
                        selected: marks[student.id] === key,
                        checked: marks[student.id] === key,
                      }}
                      disabled={!draft.ready || busy}
                      onPress={() => change(student.id, key)}
                      style={{
                        minWidth: 48,
                        flex: fontScale > 1.3 ? undefined : 1,
                        minHeight: 48,
                        padding: 6,
                        justifyContent: 'center',
                        alignItems: 'center',
                        borderRadius: 9,
                        borderWidth: 1,
                        borderColor: c.border,
                        backgroundColor:
                          marks[student.id] === key ? c[tone + 'Soft'] : c.background,
                      }}
                    >
                      <T
                        bold
                        size={13}
                        style={{
                          textAlign: 'center',
                          color:
                            marks[student.id] === key
                              ? tone === 'accent'
                                ? c.accentText
                                : c[tone]
                              : c.muted,
                        }}
                      >
                        {label}
                      </T>
                    </Pressable>
                  ))}
                </View>
              </View>
            ))}
          </View>
          {!filtered.length && <EmptyResults noun="öğrenci" onClear={() => setQuery('')} />}
        </Section>
        <Pagination
          count={filtered.length}
          index={current}
          pageSize={pageSize}
          onChange={(value) => {
            setPage(value)
            scrollRef.current?.scrollTo({ y: 0, animated: false })
          }}
        />
        {!!error && <Notice tone="red" title="Yoklama kaydedilemedi" text={error} />}
      </Screen>
      {filters && (
        <Sheet
          compact
          visible
          title="Yoklama seçimi"
          onClose={() => setFilters(false)}
          footer={
            <Button
              primary
              onPress={() => {
                if (
                  !/^\d{4}-\d{2}-\d{2}$/.test(draftDate) ||
                  !Number.isFinite(+new Date(draftDate))
                ) {
                  notify('Geçerli bir tarih seçin.', 'error')
                  return
                }
                setSaved(false)
                setClassId(draftClass)
                setDate(draftDate)
                setQuery('')
                setFilters(false)
              }}
            >
              Sınıfı göster
            </Button>
          }
        >
          <Select
            label="Sınıf"
            required
            value={draftClass}
            options={scope.teacherClasses.map((s) => ({ value: s.id, label: s.name }))}
            onChange={setDraftClass}
          />
          <DateField label="Yoklama tarihi" value={draftDate} onChange={setDraftDate} />
          <T muted size={13}>
            Kaydetmediğin seçimler sınıf ve tarih için taslak olarak korunur.
          </T>
        </Sheet>
      )}
    </>
  )
}
