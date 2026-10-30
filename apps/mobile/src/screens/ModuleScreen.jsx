import Timetable from './Timetable.tsx'
import VideoLibrary from './VideoLibrary.tsx'
import Conversations from './Conversations.tsx'
import { FormScrollView } from '../ui/KeyboardLayout.tsx'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { View, Switch } from 'react-native'
import { useSchool } from '../store/SchoolProvider.tsx'
import {
  availablePages,
  context,
  rowsFor,
  analysis,
  moduleNames,
  roles,
  nameOf,
  teacherId,
  gradeAverage,
  absentCount,
} from '../model/school.ts'
import { createActions } from '../model/operations.ts'
import { dateLabel, average } from '@kampus/school-core/lib/format.ts'
import Attendance from './Attendance.tsx'
import SchoolList from './SchoolLists.tsx'
import WorkflowScreen from './WorkflowScreen.tsx'
import OpticalScreen from './OpticalScreen.jsx'
import TutoringScreen from './TutoringScreen.jsx'
import { workflowPage } from '@kampus/school-core/modules/school-workflows.ts'
import { ThemePreference } from '../ui/SchoolLayout.tsx'
import {
  Avatar,
  Badge,
  Button,
  Card,
  Empty,
  SearchField,
  Heading,
  IconButton,
  Select,
  T,
  styles,
  useColors,
} from '../ui/components.tsx'
import OperationForm from '../ui/OperationForm.tsx'
import { useMinute } from '../ui/use-minute.ts'
import RecordCard from '../ui/RecordCard.tsx'
import appConfig from '../../app.json'

function Settings() {
  const { data, session, commit, reset } = useSchool(),
    c = useColors(),
    [confirm, setConfirm] = useState(false)
  const prefs = data.preferences[session.role] || {}
  return (
    <View style={styles.stack}>
      <T muted size={14}>
        Görünüm ve bildirim tercihleri
      </T>
      <Card>
        <T bold>Görünüm</T>
        <ThemePreference />
      </Card>
      <Card>
        <T bold>Bildirim kanalları</T>
        {['SMS', 'E-posta', 'Uygulama içi'].map((channel) => (
          <View style={styles.between} key={channel}>
            <T>{channel}</T>
            <Switch
              accessibilityLabel={channel}
              value={prefs[channel] !== false}
              onValueChange={(value) =>
                commit((s) => {
                  s.preferences[session.role] = { ...s.preferences[session.role], [channel]: value }
                }, 'Bildirim tercihi kaydedildi.')
              }
              trackColor={{ true: c.primary }}
            />
          </View>
        ))}
        <T muted size={12}>
          Demo tercihleri bu cihazda saklanır; dışarıya bildirim gönderilmez.
        </T>
      </Card>
      {session.role === 'yonetici' && (
        <>
          <Card>
            <T bold>Aktif modüller</T>
            {Object.entries(moduleNames).map(([key, label]) => (
              <View style={styles.between} key={key}>
                <T>{label}</T>
                <Switch
                  accessibilityLabel={`${label} modülü`}
                  value={data.modules[key]}
                  onValueChange={(value) =>
                    commit(
                      (s) => {
                        s.modules[key] = value
                      },
                      `${label} modülü ${value ? 'açıldı' : 'kapatıldı'}.`,
                    )
                  }
                  trackColor={{ true: c.primary }}
                />
              </View>
            ))}
          </Card>
          <Card>
            <T bold>Kullanıcılar ve roller</T>
            {Object.values(roles).map((role) => (
              <View key={role.label} style={styles.row}>
                <Avatar name={role.name} />
                <View style={{ flex: 1 }}>
                  <T bold>{role.name}</T>
                  <T muted size={13}>
                    {role.label}
                  </T>
                </View>
              </View>
            ))}
          </Card>
          <Card>
            <T bold>Son işlemler</T>
            {data.audit.slice(0, 8).map((item) => (
              <View key={item.id}>
                <T size={13}>{item.action}</T>
                <T muted size={12}>
                  {dateLabel(item.date, { hour: '2-digit', minute: '2-digit' })}
                </T>
              </View>
            ))}
            {!data.audit.length && <T muted>Yeni işlemler burada görünecek.</T>}
          </Card>
        </>
      )}
      <Card>
        <T bold>Kampüs · {appConfig.expo.version}</T>
        <T muted>
          Veriler bu telefonda saklanır. Uygulamanın verilerini silmek veya uygulamayı kaldırmak
          kayıtları siler.
        </T>
        {confirm ? (
          <>
            <T>Bu cihazdaki değişiklikler sıfırlansın mı?</T>
            <Button danger onPress={reset}>
              Evet, demoyu sıfırla
            </Button>
            <Button onPress={() => setConfirm(false)}>Vazgeç</Button>
          </>
        ) : (
          <Button onPress={() => setConfirm(true)}>Demo verilerini sıfırla</Button>
        )}
      </Card>
    </View>
  )
}
function ChildPicker() {
  const { data, preference, session } = useSchool()
  return (
    <View style={styles.stack}>
      <Heading title="Çocuklarım" subtitle="Takip etmek istediğiniz öğrenciyi seçin." />
      {data.parents[0].studentIds.map((id) => {
        const student = data.students.find((s) => s.id === id)
        return (
          <Card key={id} onPress={() => preference({ childId: id })}>
            <View style={styles.row}>
              <Avatar name={student.name} size={54} />
              <View style={{ flex: 1 }}>
                <T bold size={18}>
                  {student.name}
                </T>
                <T muted>
                  {nameOf(data, 'classes', student.classId)} · No: {student.number}
                </T>
              </View>
            </View>
            <Badge text={session.childId === id ? 'Seçili öğrenci' : 'Profili aç'} />
          </Card>
        )
      })}
    </View>
  )
}
function Analysis({ page }) {
  const { data, session } = useSchool(),
    c = useColors(),
    scope = context(data, session),
    [classId, setClassId] = useState(scope.teacherClasses[0]?.id || scope.classroom.id),
    [subject, setSubject] = useState('')
  const scores = analysis(data, session, classId, subject),
    averageScore = average(scores.map((i) => i.score))
  const subjects = [
    ...new Set(
      data.grades
        .filter((g) =>
          scope.teacher
            ? data.students.some((s) => s.id === g.studentId && s.classId === classId)
            : g.studentId === scope.student.id,
        )
        .map((g) => g.subjectId),
    ),
  ].map((id) => ({ value: id, label: data.subjects.find((s) => s.id === id)?.name || id }))
  return (
    <View style={styles.stack}>
      <Heading
        title={page === 'seviye-takibi' ? 'Akademik gelişim' : 'Sınav ve konu analizi'}
        subtitle={scope.teacher ? nameOf(data, 'classes', classId) : scope.student.name}
      />
      {scope.teacher && (
        <Select
          label="Sınıf"
          required
          options={scope.teacherClasses.map((i) => ({ value: i.id, label: i.name }))}
          value={classId}
          onChange={setClassId}
        />
      )}
      <Select label="Ders" options={subjects} value={subject} onChange={setSubject} />
      <Card style={{ backgroundColor: c.primarySoft, borderColor: c.primarySoft }}>
        <T muted>Seçili sonuçların ortalaması</T>
        <T bold size={34}>
          {averageScore} <T muted>/ 100</T>
        </T>
        <T muted>70 altındaki kazanımlara öncelik verebilirsiniz.</T>
      </Card>
      {scores.map((item) => (
        <Card key={item.title}>
          <View style={styles.between}>
            <T bold style={{ flex: 1 }}>
              {item.title}
            </T>
            <T bold>{item.score}</T>
          </View>
          <View style={{ height: 8, backgroundColor: c.soft, borderRadius: 4, overflow: 'hidden' }}>
            <View
              style={{
                width: `${item.score}%`,
                height: 8,
                backgroundColor: c.primary,
                borderRadius: 4,
              }}
            />
          </View>
          <T muted size={12}>
            {item.score >= 85
              ? 'Güçlü kazanım'
              : item.score >= 70
                ? 'Gelişim sürüyor'
                : 'Tekrar ve etüt önerilir'}
          </T>
        </Card>
      ))}
    </View>
  )
}
function AcademicOverview({ navigation }) {
  const { data, session } = useSchool(),
    scope = context(data, session)
  return (
    <View style={styles.stack}>
      <Heading
        title="Akademik takip"
        subtitle={`${scope.student.name} · ${scope.classroom.name}`}
      />
      <Card>
        <T bold size={24}>
          {gradeAverage(data, scope.student.id)} / 100
        </T>
        <T muted>Not ortalaması · {absentCount(data, scope.student.id)} gün devamsızlık</T>
      </Card>
      {[
        ['notlarim', 'Son notlar'],
        ['devamsizlik', 'Devamsızlık'],
        ['ders-programi', 'Ders programı'],
        ['odevler', 'Ödevler'],
      ]
        .filter(([key]) => key !== 'odevler' || data.modules.learning)
        .map(([key, title]) => (
          <View key={key} style={styles.stack}>
            <T bold size={19}>
              {title}
            </T>
            {rowsFor(data, session, key)
              .slice(0, 3)
              .map((row) => (
                <RecordCard
                  key={row.id}
                  row={row}
                  onPress={() => navigation.push('Detail', { row })}
                />
              ))}
          </View>
        ))}
    </View>
  )
}
export default function ModuleScreen(props) {
  const { data, session } = useSchool()
  const page = props.route.params.page
  if (
    page === 'mesajlar' &&
    data.modules.communication &&
    ['ogrenci', 'veli', 'ogretmen'].includes(session.role)
  )
    return <Conversations {...props} />
  if (availablePages(data, session.role).some((p) => p.path === page)) {
    if (page === 'optik-degerlendirme') return <OpticalScreen {...props} />
    if (page === 'otomatik-etut') return <TutoringScreen {...props} />
    if (workflowPage(page)) return <WorkflowScreen {...props} />
    if (page === 'ders-programi') return <Timetable {...props} />
    if (page === 'videolar') return <VideoLibrary {...props} />
    if (session.role === 'ogrenci' && page === 'odevler')
      return <SchoolList key={page} kind="homework" {...props} />
    if (session.role === 'veli' && page === 'finans')
      return <SchoolList key={page} kind="payment" {...props} />
    if (session.role === 'ogretmen' && page === 'sorular')
      return <SchoolList key={page} kind="question" {...props} />
    if (session.role === 'ogretmen' && page === 'yoklama') return <Attendance {...props} />
  }
  return <GeneralModuleScreen {...props} />
}
function GeneralModuleScreen({ route, navigation }) {
  const now = useMinute()
  const { data, session } = useSchool(),
    scope = context(data, session),
    listRef = useRef(null),
    [filtersOpen, setFiltersOpen] = useState(false),
    [query, setQuery] = useState(''),
    [filter, setFilter] = useState(''),
    [subject, setSubject] = useState(''),
    [index, setIndex] = useState(0),
    [form, setForm] = useState(null),
    [order, setOrder] = useState('default')
  const page = route.params.page
  const definition = availablePages(data, session.role).find((p) => p.path === page)
  const internalModule = {
    classes: 'academic',
    students: 'academic',
    mesajlar: 'communication',
    notlarim: 'academic',
    devamsizlik: 'academic',
  }[page]
  const allowed =
    !!definition ||
    (!!internalModule &&
      data.modules[internalModule] &&
      ((['classes', 'students'].includes(page) &&
        ['yonetici', 'ogretmen'].includes(session.role)) ||
        (['mesajlar', 'notlarim', 'devamsizlik'].includes(page) &&
          ['ogretmen', 'veli'].includes(session.role))))
  const rows = useMemo(
    () =>
      rowsFor(data, session, page).filter(
        (row) =>
          (!route.params.classId || row.source.classId === route.params.classId) &&
          (!route.params.branchId || row.source.branchId === route.params.branchId),
      ),
    [data, session.role, session.childId, page, route.params.classId, route.params.branchId, now],
  )
  const filtered = useMemo(() => {
    const search = query.toLocaleLowerCase('tr')
    const list = rows.filter(
      (row) =>
        (!filter || row.status === filter) &&
        (!subject || row.subject === subject) &&
        (!search ||
          `${row.title} ${row.subtitle} ${row.body}`.toLocaleLowerCase('tr').includes(search)),
    )
    if (order === 'name') list.sort((a, b) => a.title.localeCompare(b.title, 'tr'))
    if (order === 'date')
      list.sort((a, b) =>
        (b.source.date || b.source.createdAt || b.source.dueDate || '').localeCompare(
          a.source.date || a.source.createdAt || a.source.dueDate || '',
        ),
      )
    return list
  }, [rows, query, filter, subject, order])
  useEffect(() => setIndex(0), [query, filter, subject, order, page, session.childId])
  const maxIndex = Math.max(0, Math.ceil(filtered.length / 12) - 1),
    current = Math.min(index, maxIndex),
    visible = filtered.slice(current * 12, current * 12 + 12)
  const action =
    page === 'odevler' && scope.teacher
      ? ['Ödev ata', 'homework']
      : page === 'mesajlar' && scope.teacher
        ? null
        : createActions[page]
  if (!allowed)
    return (
      <FormScrollView contentContainerStyle={styles.page}>
        <Empty title="Modül kullanıma kapalı" text="Yönetici modül tercihlerini değiştirebilir." />
      </FormScrollView>
    )
  let special =
    page === 'ayarlar' ? (
      <Settings />
    ) : page === 'cocuk-secici' ? (
      <ChildPicker />
    ) : ['sinav-analizi', 'seviye-takibi', 'sinif-analizi'].includes(page) ? (
      <Analysis page={page} />
    ) : page === 'akademik-takip' ? (
      <AcademicOverview navigation={navigation} />
    ) : null
  return (
    <>
      <FormScrollView
        ref={listRef}
        key={`${page}-${session.childId}`}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.page}
      >
        {special || (
          <>
            {!!definition?.description && <T muted>{definition.description}</T>}
            {action && (
              <Button
                primary
                icon="Plus"
                style={{ alignSelf: 'flex-start', borderRadius: 26 }}
                onPress={() => setForm({ kind: action[1] })}
              >
                {action[0]}
              </Button>
            )}
            {page === 'subeler' && (
              <Button icon="School" onPress={() => navigation.push('Module', { page: 'classes' })}>
                Sınıfları yönet
              </Button>
            )}
            {['randevular', 'randevu-mesaj'].includes(page) && (
              <Button
                icon="MessagesSquare"
                onPress={() => navigation.push('Module', { page: 'mesajlar' })}
              >
                Mesajlar
              </Button>
            )}
            {page === 'randevular' && (
              <Card>
                <T bold>Tanımlı müsaitlikler</T>
                {data.availability
                  .filter((a) => a.teacherId === teacherId && +new Date(a.date) > Date.now())
                  .map((a) => (
                    <T key={a.id} muted>
                      {dateLabel(a.date, { hour: '2-digit', minute: '2-digit' })} · {a.duration} dk
                    </T>
                  ))}
              </Card>
            )}
            {page === 'kayit-islemleri' ? (
              <Card>
                <T bold>Yeni öğrenci kaydı</T>
                <T>
                  Bir aday seçerek sınıf ataması, sözleşme ve taksit planını birlikte oluşturun.
                  Kayıt tamamlandığında öğrenci bütün rollerde görünür.
                </T>
                <T muted>Son kayıtlar</T>
                {data.prospects
                  .filter((p) => p.studentId)
                  .slice(-6)
                  .map((p) => (
                    <T key={p.id}>{p.name} · Kayıt oldu</T>
                  ))}
              </Card>
            ) : (
              <>
                <View style={styles.row}>
                  <SearchField value={query} onChange={setQuery} style={{ flex: 1 }} />
                  <IconButton
                    filled
                    selected={filtersOpen || !!filter || !!subject || order !== 'default'}
                    name="Filter"
                    label={filtersOpen ? 'Filtreleri kapat' : 'Filtreler'}
                    onPress={() => setFiltersOpen(!filtersOpen)}
                  />
                </View>
                <View style={styles.between}>
                  <T muted size={12}>
                    {filtered.length} kayıt{filter ? ` · ${filter}` : ''}
                    {subject ? ` · ${subject}` : ''}
                  </T>
                  {(!!query || !!filter || !!subject) && (
                    <Button
                      small
                      onPress={() => {
                        setQuery('')
                        setFilter('')
                        setSubject('')
                      }}
                    >
                      Temizle
                    </Button>
                  )}
                </View>
                {filtersOpen && (
                  <Card>
                    <View style={styles.wrap}>
                      {rows.some((r) => r.status) && (
                        <View style={{ flex: 1, minWidth: 130 }}>
                          <Select
                            label="Durum"
                            value={filter}
                            options={[...new Set(rows.map((r) => r.status).filter(Boolean))].map(
                              (v) => ({ value: v, label: v }),
                            )}
                            onChange={setFilter}
                          />
                        </View>
                      )}
                      {rows.some((r) => r.subject) && (
                        <View style={{ flex: 1, minWidth: 130 }}>
                          <Select
                            label="Ders"
                            value={subject}
                            options={[...new Set(rows.map((r) => r.subject).filter(Boolean))].map(
                              (v) => ({ value: v, label: v }),
                            )}
                            onChange={setSubject}
                          />
                        </View>
                      )}
                    </View>
                    <Select
                      label="Sıralama"
                      required
                      options={[
                        { value: 'default', label: 'Varsayılan' },
                        { value: 'name', label: 'Ada göre A–Z' },
                        { value: 'date', label: 'En yeni tarih' },
                      ]}
                      value={order}
                      onChange={setOrder}
                    />
                    <Button
                      onPress={() => {
                        setFilter('')
                        setSubject('')
                        setOrder('default')
                      }}
                    >
                      Filtreleri temizle
                    </Button>
                  </Card>
                )}
                {visible.length ? (
                  visible.map((row) => (
                    <RecordCard
                      key={row.id}
                      row={row}
                      onPress={() =>
                        navigation.push(
                          row.kind === 'video'
                            ? 'Video'
                            : row.kind === 'quiz' && session.role === 'ogrenci'
                              ? 'Quiz'
                              : 'Detail',
                          { row },
                        )
                      }
                    />
                  ))
                ) : (
                  <Empty
                    text={
                      page === 'devamsizlik-bildirimi'
                        ? 'Henüz mazeret bildirimi yok. Yeni bir bildirim oluşturabilirsiniz.'
                        : 'Arama ve filtreleri temizleyerek yeniden deneyin.'
                    }
                    action={
                      query || filter || subject ? (
                        <Button
                          onPress={() => {
                            setQuery('')
                            setFilter('')
                            setSubject('')
                          }}
                        >
                          Filtreleri temizle
                        </Button>
                      ) : null
                    }
                  />
                )}
                <View style={styles.between}>
                  <T muted size={13}>
                    {filtered.length ? current * 12 + 1 : 0}–
                    {Math.min((current + 1) * 12, filtered.length)} / {filtered.length} kayıt
                  </T>
                  <View style={styles.row}>
                    <IconButton
                      name="ChevronLeft"
                      label="Önceki sayfa"
                      disabled={current === 0}
                      onPress={() => {
                        setIndex(current - 1)
                        listRef.current?.scrollTo({ y: 0, animated: false })
                      }}
                    />
                    <IconButton
                      name="ChevronRight"
                      label="Sonraki sayfa"
                      disabled={current >= maxIndex}
                      onPress={() => {
                        setIndex(current + 1)
                        listRef.current?.scrollTo({ y: 0, animated: false })
                      }}
                    />
                  </View>
                </View>
              </>
            )}
          </>
        )}
      </FormScrollView>
      {form && <OperationForm key={form.kind} descriptor={form} onClose={() => setForm(null)} />}
    </>
  )
}
