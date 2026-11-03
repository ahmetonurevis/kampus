import { useMemo, useState } from 'react'
import { View } from 'react-native'
import { toApiError } from '@kampus/api-client/errors.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import { isUnreadableCollectionError } from '@kampus/react-shared/collections.ts'
import { useCollectionAll } from '@kampus/react-shared/use-collection.ts'
import { useLessonsInRange } from '@kampus/react-shared/use-lessons.ts'
import { Badge, Button, Empty, Sheet, T } from '../../ui/components.tsx'
import { DetailPair, ListRow, Section } from '../../ui/SchoolLayout.tsx'
import { useApiSession } from '../auth.tsx'
import {
  addDays,
  isModuleOn,
  TUTORING_LABEL,
  weekRange,
  weekSchedule,
  weekStart,
  weekTitle,
  type TutoringDetail,
  type TutorSessionFields,
} from '../parent-tracking.ts'
import { ListLoading, QueryError } from '../QueryState.tsx'

type Named = { name: string }

const TUTORING_MODULE = 'tutoring'

/** Etüt ayrıntısı (web "Etüt ayrıntısı" paneli): ders, konu, saat, derslik, öğretmen, öğrenci sayısı. */
function TutoringSheet({
  title,
  detail,
  onClose,
}: {
  title: string
  detail: TutoringDetail
  onClose: () => void
}) {
  return (
    <Sheet visible title="Etüt ayrıntısı" onClose={onClose}>
      <T bold size={17} accessibilityRole="header">
        {title}
      </T>
      <Section title="Bilgiler" panel>
        <View style={{ gap: 12 }}>
          <DetailPair label="Ders" value={detail.subject} />
          <DetailPair label="Konu" value={detail.topic} />
          <DetailPair label="Saat" value={`${detail.time} · ${detail.duration} dakika`} />
          <DetailPair label="Derslik" value={detail.room} />
          <DetailPair label="Öğretmen" value={detail.teacher || '—'} />
          <DetailPair label="Öğrenci sayısı" value={String(detail.studentCount)} />
        </View>
      </Section>
    </Sheet>
  )
}

/**
 * Veli: seçili çocuğun haftalık ders programı (web Akademik Takip "Ders programı" sekmesi), salt
 * okunur. Program çocuğun sınıfına daraltılarak `GET /lessons` ile haftanın günleri (Europe/Istanbul)
 * için okunur; iptal edilen ders görünmez. Kazanım etütleri (`tutoring` modülü açıksa) aynı haftada "Etüt"
 * etiketli kart olarak gelir: `GET /collections/tutorSessions` haftanın günleriyle okunur, sunucu
 * velinin çocuklarına daraltır, seçili çocuk ayrıca uygulanır; iptal edilen etüt görünmez. Etüt
 * okunamazsa (403/404) program yalnız ders gösterir, diğer hatada dersler engellenmez ve uyarı çıkar. Ders ve öğretmen adları okunamazsa satır genel adla
 * kalır, program engellenmez. Hafta yalnız bellekte tutulur; çocuk değişince ekran yeniden
 * kurulur ve bu haftaya döner.
 */
export function ParentSchedule({ classId, childId }: { classId: string; childId: string }) {
  const session = useApiSession()
  const tutoringOn = isModuleOn(session.modules, TUTORING_MODULE)
  const [openTutoring, setOpenTutoring] = useState<{
    title: string
    detail: TutoringDetail
  } | null>(null)
  const thisWeek = weekStart(dayKey())
  const [start, setStart] = useState(thisWeek)
  const range = weekRange(start)
  const lessons = useLessonsInRange({ classId, ...range })
  const tutorSessions = useCollectionAll<TutorSessionFields>(
    'tutorSessions',
    { filters: range },
    { enabled: tutoringOn },
  )
  const tutoringError =
    tutorSessions.error && !isUnreadableCollectionError(tutorSessions.error)
      ? tutorSessions.error
      : null
  const subjects = useCollectionAll<Named>('subjects')
  const teachers = useCollectionAll<Named>('teachers')
  const days = useMemo(
    () =>
      weekSchedule(
        lessons.data ?? [],
        start,
        {
          subjects: new Map((subjects.data ?? []).map((row) => [row.id, row.record.name])),
          teachers: new Map((teachers.data ?? []).map((row) => [row.id, row.record.name])),
        },
        {
          sessions: tutoringOn ? (tutorSessions.data ?? []).map((row) => row.record) : [],
          studentId: childId,
        },
      ),
    [lessons.data, subjects.data, teachers.data, tutorSessions.data, tutoringOn, start, childId],
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
      ) : !lessons.data ||
        subjects.isPending ||
        (tutoringOn && tutorSessions.isPending && !tutoringError) ? (
        <ListLoading label="Program yükleniyor…" />
      ) : days.length === 0 ? (
        <Empty title="Bu hafta ders yok" text="Programa ders eklendiğinde burada görünür." />
      ) : (
        days.map((day) => (
          <Section key={day.day} title={day.label}>
            <View style={{ gap: 10 }} accessibilityRole="list">
              {day.lessons.map((lesson) => {
                const tutoring = lesson.tutoring
                return (
                  <ListRow
                    key={`${lesson.kind}-${lesson.id}`}
                    card
                    eyebrow={lesson.time}
                    title={lesson.title}
                    subtitle={lesson.subtitle}
                    {...(tutoring
                      ? {
                          label: `${lesson.title}, ${lesson.time}. Etüt ayrıntısını aç`,
                          badge: <Badge text={TUTORING_LABEL} />,
                          onPress: () => setOpenTutoring({ title: lesson.title, detail: tutoring }),
                        }
                      : {})}
                  />
                )
              })}
            </View>
          </Section>
        ))
      )}
      {tutoringError && (
        <QueryError error={tutoringError} onRetry={() => void tutorSessions.refetch()} />
      )}
      {openTutoring && (
        <TutoringSheet
          title={openTutoring.title}
          detail={openTutoring.detail}
          onClose={() => setOpenTutoring(null)}
        />
      )}
    </>
  )
}
