import { contentTitle } from '../model/presentation.js'
import React, { useMemo } from 'react'
import { View } from 'react-native'
import { useSchool } from '../store/SchoolProvider.jsx'
import {
  availablePages,
  context,
  rowsFor,
  roles,
  nameOf,
  absentCount,
  teacherId,
} from '../model/school.js'
import { homeworkRows, paymentSummary } from '../model/experience.js'
import { Badge, Button, Card, T, useColors } from '../ui/components.jsx'
import { ChildSelector, ListRow, Screen, Section } from '../ui/SchoolLayout.jsx'
import ModuleHub from '../ui/ModuleHub.jsx'
import { useMinute } from '../ui/use-minute.js'
import { dateLabel, dayKey, money, timeLabel } from '@kampus/school-core/lib/format.js'

export default function RoleHome({ navigation }) {
  const { data, session } = useSchool(),
    c = useColors(),
    now = useMinute()
  const scope = context(data, session),
    role = session.role
  const allowed = new Set(availablePages(data, role).map((p) => p.path))
  const go = (page, params = {}) => navigation.navigate('Module', { page, ...params })
  const detail = (row) => navigation.navigate('Detail', { row })
  const lessons = useMemo(
    () => rowsFor(data, session, 'ders-programi'),
    [data, session.role, session.childId],
  )
  const pending = useMemo(
    () => homeworkRows(data, session).filter((r) => !r.submission),
    [data, session.role, session.childId],
  )
  const finances = useMemo(
    () => paymentSummary(data, session),
    [data, session.role, session.childId],
  )
  const today = lessons.filter((r) => dayKey(r.source.date) === dayKey())
  const nextLesson = lessons.find(
    (r) => +new Date(r.source.date) + r.source.duration * 60000 > now * 60000,
  )
  const questions = data.questions.filter((q) => q.teacherId === teacherId && !q.answeredAt)
  const waitingSubmissions = useMemo(() => {
    const ownHomework = new Set(
      data.homework.filter((h) => h.teacherId === teacherId).map((h) => h.id),
    )
    return data.submissions.filter((s) => s.score == null && ownHomework.has(s.homeworkId))
  }, [data.homework, data.submissions])
  const announcement = rowsFor(data, session, 'duyurular')[0]
  const timeRange = (lesson) =>
    `${timeLabel(lesson.date)}–${timeLabel(new Date(+new Date(lesson.date) + lesson.duration * 60000))}`
  const date = dateLabel(new Date(), { weekday: 'long' })
  const person = roles[role].name
  return (
    <Screen>
      <View style={{ gap: 6 }}>
        <T bold size={24}>
          Merhaba, {person.split(' ')[0]}
        </T>
        <T muted size={13}>
          Akademi Özel Okulları
          {role === 'ogrenci'
            ? ` · ${scope.classroom.name}`
            : role === 'ogretmen'
              ? ' · Matematik'
              : ''}
        </T>
        <T muted size={13}>
          {date}
        </T>
      </View>
      <ModuleHub navigation={navigation} />
      {role === 'veli' ? (
        <>
          <ChildSelector />
          <Section
            panel
            title={`${scope.student.name.split(' ')[0]}'${/[aeıioöuü]$/i.test(scope.student.name.split(' ')[0]) ? 'n' : ''}in gündemi`}
          >
            <View>
              {allowed.has('akademik-takip') && (
                <>
                  {data.modules.learning && (
                    <ListRow
                      title="Ödev durumu"
                      subtitle={
                        pending.length
                          ? `${pending.length} ödev teslim bekliyor`
                          : 'Bekleyen ödev yok'
                      }
                      onPress={() => go('akademik-takip')}
                    />
                  )}
                  <ListRow
                    title="Devamsızlık"
                    subtitle={`Bu dönem ${absentCount(data, scope.student.id)} gün`}
                    onPress={() => go('devamsizlik')}
                  />
                </>
              )}
              {allowed.has('ogretmen-degerlendirmeleri') && (
                <ListRow
                  title="Öğretmen görüşü"
                  subtitle="Dersler ve öğretmen değerlendirmeleri"
                  onPress={() => go('ogretmen-degerlendirmeleri')}
                />
              )}
            </View>
          </Section>
          {allowed.has('finans') && (
            <Section
              panel
              title={finances.next?.status === 'Gecikmiş' ? 'Ödeme bekliyor' : 'Yaklaşan ödeme'}
            >
              {finances.next ? (
                <View style={{ gap: 8, paddingVertical: 8 }}>
                  <T muted size={13}>
                    Eğitim taksiti
                  </T>
                  <T bold size={25}>
                    {money(finances.next.source.amount)}
                  </T>
                  <T muted size={13}>
                    Son ödeme: {dateLabel(finances.next.source.dueDate, { year: 'numeric' })}
                  </T>
                  {finances.next.status === 'Gecikmiş' && <Badge text="Gecikmiş" />}
                </View>
              ) : (
                <T muted>Ödenmemiş taksit bulunmuyor.</T>
              )}
              <Button accent onPress={() => go('finans')}>
                Ödeme planını gör
              </Button>
            </Section>
          )}
        </>
      ) : role === 'ogretmen' ? (
        <>
          {allowed.has('ders-programi') && (
            <Section
              panel
              title="Bugünkü dersler"
              action="Programı gör ›"
              onPress={() => go('ders-programi')}
            >
              <View>
                {today.length ? (
                  today
                    .slice(0, 2)
                    .map((row) => (
                      <ListRow
                        key={row.id}
                        title={`${timeRange(row.source)} · ${nameOf(data, 'classes', row.source.classId)}`}
                        subtitle={contentTitle(row.title, row.source.subject)}
                        onPress={() => detail(row)}
                      />
                    ))
                ) : (
                  <T muted>
                    Bugün planlanmış dersin yok. Diğer günleri ders programında görebilirsin.
                  </T>
                )}
              </View>
            </Section>
          )}
          <Section panel title="Bekleyen işler">
            <View>
              {allowed.has('yoklama') && (
                <ListRow
                  title={`Yoklama${today[0] ? ' · ' + nameOf(data, 'classes', today[0].source.classId) : ''}`}
                  subtitle="Sınıfın günlük devam durumunu kaydet"
                  onPress={() => go('yoklama', { classId: today[0]?.source.classId })}
                />
              )}
              {allowed.has('odevler') && (
                <ListRow
                  title="Ödev değerlendirme"
                  subtitle={`${waitingSubmissions.length} teslim değerlendirme bekliyor`}
                  onPress={() => go('odevler')}
                />
              )}
            </View>
            {allowed.has('sorular') && (
              <View style={{ gap: 12, paddingTop: 4 }}>
                <T muted size={14}>
                  {questions.length} öğrenci sorusu yanıt bekliyor.
                </T>
                <Button accent onPress={() => go('sorular')}>
                  Soru kuyruğunu aç
                </Button>
              </View>
            )}
          </Section>
        </>
      ) : (
        <>
          {allowed.has('ders-programi') &&
            (nextLesson ? (
              <Card
                soft
                onPress={() => detail(nextLesson)}
                label="Sıradaki dersin ayrıntıları"
                style={{ gap: 8, padding: 20, backgroundColor: c.hero }}
              >
                <T bold size={12} style={{ color: c.heroMuted }}>
                  Sıradaki ders
                  {dayKey(nextLesson.source.date) !== dayKey()
                    ? ` · ${dateLabel(nextLesson.source.date)}`
                    : ''}
                </T>
                <T bold size={20} style={{ color: c.heroText }}>
                  {nextLesson.title}
                </T>
                <T bold size={16} style={{ color: c.accent }}>
                  {timeRange(nextLesson.source)}
                </T>
                <T size={14} style={{ color: c.heroMuted }}>
                  {nameOf(data, 'teachers', nextLesson.source.teacherId)}
                </T>
              </Card>
            ) : (
              <T muted>
                Yaklaşan ders bulunmuyor. Güncel programını ders programı ekranından takip
                edebilirsin.
              </T>
            ))}
          {allowed.has('odevler') && (
            <Section panel title="Ödevlerin" action="Tümünü gör ›" onPress={() => go('odevler')}>
              <View>
                {pending.length ? (
                  pending
                    .slice(0, 2)
                    .map((row) => (
                      <ListRow
                        key={row.id}
                        title={contentTitle(row.title, row.source.subject)}
                        subtitle={`${row.source.subject} · ${dateLabel(row.source.dueDate, { hour: '2-digit', minute: '2-digit' })}`}
                        badge={
                          row.status === 'Gecikmiş' ? (
                            <Badge text="Teslim süresi geçti" />
                          ) : undefined
                        }
                        onPress={() => detail(row)}
                      />
                    ))
                ) : (
                  <T muted>Bekleyen ödevin yok. Teslimlerini ödevler ekranında görebilirsin.</T>
                )}
              </View>
            </Section>
          )}
          {allowed.has('duyurular') && announcement && (
            <Section panel title="Okuldan haberler">
              <ListRow
                title={announcement.title}
                subtitle={announcement.subtitle}
                onPress={() => detail(announcement)}
              />
            </Section>
          )}
        </>
      )}
    </Screen>
  )
}
