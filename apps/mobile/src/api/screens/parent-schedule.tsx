import { useMemo, useState } from 'react'
import { View } from 'react-native'
import { toApiError } from '@kampus/api-client/errors.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import { useCollectionAll } from '@kampus/react-shared/use-collection.ts'
import { useLessonsInRange } from '@kampus/react-shared/use-lessons.ts'
import { Button, Empty, T } from '../../ui/components.tsx'
import { ListRow, Section } from '../../ui/SchoolLayout.tsx'
import { addDays, weekRange, weekSchedule, weekStart, weekTitle } from '../parent-tracking.ts'
import { ListLoading, QueryError } from '../QueryState.tsx'

type Named = { name: string }

/**
 * Veli: seçili çocuğun haftalık ders programı (web Akademik Takip "Ders programı" sekmesi), salt
 * okunur. Program çocuğun sınıfına daraltılarak `GET /lessons` ile haftanın günleri (Europe/Istanbul)
 * için okunur; iptal edilen ders görünmez. Ders ve öğretmen adları okunamazsa satır genel adla
 * kalır, program engellenmez. Hafta yalnız bellekte tutulur; çocuk değişince ekran yeniden
 * kurulur ve bu haftaya döner.
 */
export function ParentSchedule({ classId }: { classId: string }) {
  const thisWeek = weekStart(dayKey())
  const [start, setStart] = useState(thisWeek)
  const lessons = useLessonsInRange({ classId, ...weekRange(start) })
  const subjects = useCollectionAll<Named>('subjects')
  const teachers = useCollectionAll<Named>('teachers')
  const days = useMemo(
    () =>
      weekSchedule(lessons.data ?? [], start, {
        subjects: new Map((subjects.data ?? []).map((row) => [row.id, row.record.name])),
        teachers: new Map((teachers.data ?? []).map((row) => [row.id, row.record.name])),
      }),
    [lessons.data, subjects.data, teachers.data, start],
  )

  return (
    <>
      <View style={{ gap: 10 }}>
        <T bold size={17} accessibilityRole="header">
          {weekTitle(start)}
        </T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Button small onPress={() => setStart(addDays(start, -7))}>
            Önceki hafta
          </Button>
          <Button small disabled={start === thisWeek} onPress={() => setStart(thisWeek)}>
            Bu hafta
          </Button>
          <Button small onPress={() => setStart(addDays(start, 7))}>
            Sonraki hafta
          </Button>
        </View>
      </View>
      {lessons.error ? (
        <QueryError error={toApiError(lessons.error)} onRetry={() => void lessons.refetch()} />
      ) : !lessons.data ? (
        <ListLoading label="Program yükleniyor…" />
      ) : days.length === 0 ? (
        <Empty title="Bu hafta ders yok" text="Programa ders eklendiğinde burada görünür." />
      ) : (
        days.map((day) => (
          <Section key={day.day} title={day.label}>
            <View style={{ gap: 10 }} accessibilityRole="list">
              {day.lessons.map((lesson) => (
                <ListRow
                  key={lesson.id}
                  card
                  eyebrow={lesson.time}
                  title={lesson.title}
                  subtitle={lesson.subtitle}
                />
              ))}
            </View>
          </Section>
        ))
      )}
    </>
  )
}
