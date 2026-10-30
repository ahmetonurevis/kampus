import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { dateLabel, dayKey, timeLabel } from '@kampus/school-core/lib/format.ts'
import { useSchool } from '../store/SchoolProvider.tsx'
import { context, nameOf, rowsFor } from '../model/school.ts'
import { contentTitle } from '../model/presentation.ts'
import { useMinute } from '../ui/use-minute.ts'
import {
  Badge,
  Button,
  IconButton,
  SearchField,
  Select,
  Sheet,
  T,
  styles,
} from '../ui/components.tsx'
import { EmptyResults, ListRow, Notice, Screen, Tabs, TextAction } from '../ui/SchoolLayout.tsx'

function shiftDay(day, offset) {
  return dayKey(new Date(+new Date(`${day}T12:00:00+03:00`) + offset * 86400000))
}
export default function Timetable({ navigation }) {
  const now = useMinute() * 60000
  const { data, session } = useSchool(),
    scope = context(data, session)
  const [day, setDay] = useState(dayKey()),
    [query, setQuery] = useState(''),
    [classId, setClassId] = useState(''),
    [subject, setSubject] = useState(''),
    [filters, setFilters] = useState(false)
  const rows = useMemo(
    () => rowsFor(data, session, 'ders-programi'),
    [data, session.role, session.childId],
  )
  const weekStart = shiftDay(day, -((new Date(`${day}T12:00:00+03:00`).getUTCDay() + 6) % 7))
  const days = Array.from({ length: 7 }, (_, index) => shiftDay(weekStart, index))
  const course = (lesson) =>
    lesson.subject || data.subjects.find((s) => s.id === lesson.subjectId)?.name || lesson.title
  const lessons = rows.filter(
    ({ source }) =>
      dayKey(source.date) === day &&
      (!classId || source.classId === classId) &&
      (!subject || course(source) === subject) &&
      `${source.title} ${course(source)} ${nameOf(data, 'teachers', source.teacherId)} ${nameOf(data, 'classes', source.classId)}`
        .toLocaleLowerCase('tr')
        .includes(query.trim().toLocaleLowerCase('tr')),
  )
  function clear() {
    setQuery('')
    setSubject('')
    setClassId('')
  }
  return (
    <>
      <Screen>
        <T muted size={14}>
          {scope.teacher
            ? 'Selin Kaya · Matematik'
            : `${scope.student.name} · ${scope.classroom.name}`}
        </T>
        <View style={{ gap: 12 }}>
          <View style={styles.between}>
            <IconButton
              name="ChevronLeft"
              label="Önceki hafta"
              onPress={() => setDay(shiftDay(day, -7))}
            />
            <T bold size={15} style={{ flex: 1, textAlign: 'center' }}>
              {dateLabel(`${weekStart}T12:00:00+03:00`)} –{' '}
              {dateLabel(`${shiftDay(weekStart, 6)}T12:00:00+03:00`)}
            </T>
            <IconButton
              name="ChevronRight"
              label="Sonraki hafta"
              onPress={() => setDay(shiftDay(day, 7))}
            />
          </View>
          <Tabs
            value={day}
            onChange={setDay}
            options={days.map((value) => ({
              value,
              label: dateLabel(`${value}T12:00:00+03:00`, {
                weekday: 'short',
                day: 'numeric',
                month: undefined,
              }),
            }))}
          />
          <SearchField value={query} onChange={setQuery} placeholder="Ders veya öğretmen ara" />
          <View style={[styles.between, { flexWrap: 'wrap' }]}>
            <T muted size={13}>
              {lessons.length} ders · {dateLabel(`${day}T12:00:00+03:00`, { weekday: 'long' })}
            </T>
            <View style={styles.row}>
              <TextAction onPress={() => setDay(dayKey())}>Bugün</TextAction>
              <TextAction onPress={() => setFilters(true)}>
                Filtrele{subject || classId ? ' (aktif)' : ''} ⌄
              </TextAction>
            </View>
          </View>
        </View>
        <View style={{ gap: 12 }}>
          {lessons.map((row) => {
            const lesson = row.source,
              end = +new Date(lesson.date) + lesson.duration * 60000,
              current = +new Date(lesson.date) <= now && end > now
            return (
              <ListRow
                key={row.id}
                card
                title={course(lesson)}
                eyebrow={`${timeLabel(lesson.date)}–${timeLabel(new Date(end))}`}
                subtitle={`${scope.teacher ? nameOf(data, 'classes', lesson.classId) : nameOf(data, 'teachers', lesson.teacherId)} · Derslik ${lesson.room}`}
                badge={current ? <Badge text="Ders sürüyor" /> : undefined}
                onPress={() => navigation.navigate('Detail', { row })}
                label={`${timeLabel(lesson.date)} ${lesson.title} ders ayrıntısı`}
              >
                {contentTitle(lesson.title, course(lesson)) !== course(lesson) && (
                  <T muted size={13}>
                    {contentTitle(lesson.title, course(lesson))}
                  </T>
                )}
              </ListRow>
            )
          })}
          {!lessons.length &&
            (query || subject || classId ? (
              <EmptyResults noun="ders" onClear={clear} />
            ) : (
              <Notice title="Bu gün için ders yok" text="Takvimden başka bir gün seçebilirsin." />
            ))}
        </View>
      </Screen>
      {filters && (
        <Sheet
          visible
          compact
          title="Program filtreleri"
          onClose={() => setFilters(false)}
          footer={
            <Button primary onPress={() => setFilters(false)}>
              Dersleri göster
            </Button>
          }
        >
          <Select
            label="Ders"
            value={subject}
            options={[...new Set(rows.map((r) => course(r.source)).filter(Boolean))].map(
              (value) => ({ value, label: value }),
            )}
            onChange={setSubject}
          />
          {scope.teacher && (
            <Select
              label="Sınıf"
              value={classId}
              onChange={setClassId}
              options={scope.teacherClasses.map((c) => ({ value: c.id, label: c.name }))}
            />
          )}
          <TextAction onPress={clear}>Filtreleri temizle</TextAction>
        </Sheet>
      )}
    </>
  )
}
