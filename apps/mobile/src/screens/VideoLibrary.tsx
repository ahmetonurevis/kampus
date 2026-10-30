import { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useActiveSchool } from '../store/SchoolProvider.tsx'
import { context, rowsFor } from '../model/school.ts'
import { contentTitle } from '../model/presentation.ts'
import type { ScreenProps } from '../route-types.ts'
import {
  Badge,
  Button,
  Card,
  Icon,
  SearchField,
  Select,
  Sheet,
  T,
  styles,
  useColors,
} from '../ui/components.tsx'
import { EmptyResults, Pagination, Screen, TextAction } from '../ui/SchoolLayout.tsx'

export default function VideoLibrary({ navigation }: ScreenProps<'Module'>) {
  const { data, session } = useActiveSchool(),
    scope = context(data, session),
    c = useColors()
  const [query, setQuery] = useState(''),
    [subject, setSubject] = useState(''),
    [status, setStatus] = useState(''),
    [filters, setFilters] = useState(false),
    [page, setPage] = useState(0)
  const rows = useMemo(
    () => rowsFor(data, session, 'videolar'),
    [data, session.role, session.childId],
  )
  const progress = (id: string) =>
    data.videoProgress.find((p) => p.videoId === id && p.studentId === scope.student.id)
      ?.progress || 0
  const filtered = rows.filter(
    (r) =>
      (!subject || r.subject === subject) &&
      (!status ||
        (status === 'done'
          ? progress(r.id) >= 95
          : status === 'started'
            ? progress(r.id) > 0 && progress(r.id) < 95
            : !progress(r.id))) &&
      `${r.title} ${r.subject} ${r.body}`
        .toLocaleLowerCase('tr')
        .includes(query.trim().toLocaleLowerCase('tr')),
  )
  const current = Math.min(page, Math.max(0, Math.ceil(filtered.length / 8) - 1))
  function clear() {
    setQuery('')
    setSubject('')
    setStatus('')
    setPage(0)
  }
  return (
    <>
      <Screen>
        <T muted size={14}>
          {scope.student.name} · {scope.classroom.name}
        </T>
        <View style={{ gap: 8 }}>
          <SearchField
            value={query}
            onChange={(value) => {
              setQuery(value)
              setPage(0)
            }}
            placeholder="Konu veya ders ara"
          />
          <View style={styles.between}>
            <T muted size={13}>
              {filtered.length} video · Çevrimdışı izlenebilir
            </T>
            <TextAction onPress={() => setFilters(true)}>
              Filtrele{subject || status ? ' (aktif)' : ''} ⌄
            </TextAction>
          </View>
        </View>
        {filtered.slice(current * 8, current * 8 + 8).map((row) => (
          <Card
            key={row.id}
            onPress={() => navigation.navigate('Video', { row })}
            label={`${row.title} videosunu ${progress(row.id) ? 'izlemeye devam et' : 'izle'}`}
            style={{ padding: 18, gap: 16 }}
          >
            <View style={styles.between}>
              <T bold size={13} style={{ color: c.primary }}>
                {row.subject}
              </T>
              <Icon name="Play" color={c.primary} size={24} />
            </View>
            <View style={{ gap: 6 }}>
              <T bold size={18}>
                {contentTitle(row.title, row.subject)}
              </T>
              <T muted size={13}>
                {row.source.level} · {row.source.duration} dk
              </T>
              <T muted size={14} numberOfLines={2}>
                {row.body}
              </T>
            </View>
            <View style={{ gap: 8 }}>
              <View
                style={{ height: 4, borderRadius: 2, backgroundColor: c.soft, overflow: 'hidden' }}
              >
                <View
                  style={{
                    width: `${Math.min(100, progress(row.id))}%`,
                    height: 4,
                    backgroundColor: c.primary,
                  }}
                />
              </View>
              <View style={[styles.between, { flexWrap: 'wrap' }]}>
                <Badge text={row.status} />
                <T bold size={14} style={{ color: c.primary }}>
                  {progress(row.id) > 0 && progress(row.id) < 95
                    ? 'Devam et'
                    : progress(row.id) >= 95
                      ? 'Tekrar izle'
                      : 'İzle'}{' '}
                  ›
                </T>
              </View>
            </View>
          </Card>
        ))}
        {!filtered.length && <EmptyResults noun="video" onClear={clear} />}
        <Pagination count={filtered.length} index={current} pageSize={8} onChange={setPage} />
      </Screen>
      {filters && (
        <Sheet
          visible
          compact
          title="Video filtreleri"
          onClose={() => setFilters(false)}
          footer={
            <Button primary onPress={() => setFilters(false)}>
              Videoları göster
            </Button>
          }
        >
          <Select
            label="Ders"
            value={subject}
            options={[...new Set(rows.map((r) => r.subject))].map((value) => ({
              value,
              label: value,
            }))}
            onChange={(value) => {
              setSubject(value)
              setPage(0)
            }}
          />
          <Select
            label="İzleme durumu"
            value={status}
            options={[
              { value: 'started', label: 'Yarım kalanlar' },
              { value: 'done', label: 'Tamamlananlar' },
              { value: 'new', label: 'Başlanmayanlar' },
            ]}
            onChange={(value) => {
              setStatus(value)
              setPage(0)
            }}
          />
          <TextAction onPress={clear}>Filtreleri temizle</TextAction>
        </Sheet>
      )}
    </>
  )
}
