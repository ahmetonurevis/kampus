import { useMemo, useState } from 'react'
import { Pressable, View } from 'react-native'
import type { State } from '@kampus/school-core/data/seed.ts'
import { useCollectionAll, useCollectionList } from '@kampus/react-shared/use-collection.ts'
import type { CollectionRow } from '@kampus/react-shared/collections.ts'
import {
  Avatar,
  Badge,
  Button,
  Empty,
  Icon,
  SearchField,
  Sheet,
  T,
  useColors,
} from '../../ui/components.tsx'
import { EmptyResults, ListRow, Pagination, Screen } from '../../ui/SchoolLayout.tsx'
import { useApiSession } from '../auth.tsx'
import { API_PAGE_SIZE, clampPageIndex } from '../list-state.ts'
import { canOpenScreen } from '../pages.ts'
import { gradeView } from '../presentation.ts'
import { ListLoading, QueryError } from '../QueryState.tsx'
import { resolveChild } from '../session-state.ts'
import { useDebouncedValue } from '../use-debounced-value.ts'
import { useListMemory, useSelectedChild } from '../view-memory.tsx'

type StudentRecord = State['students'][number]
type ClassRecord = State['classes'][number]
type GradeRecord = State['grades'][number]

type ChildOption = { id: string; name: string; className: string | undefined }

function ChildPicker({
  options,
  value,
  onChange,
}: {
  options: readonly ChildOption[]
  value: string
  onChange: (id: string) => void
}) {
  const c = useColors()
  const [open, setOpen] = useState(false)
  const selected = options.find((option) => option.id === value)
  if (!selected) return null
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Çocuk değiştir: ${selected.name}`}
        disabled={options.length < 2}
        onPress={() => setOpen(true)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          minHeight: 64,
          padding: 14,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: c.border,
          backgroundColor: c.surface,
        }}
      >
        <Avatar name={selected.name} size={36} />
        <View style={{ flex: 1, gap: 4 }}>
          <T bold size={16}>
            {selected.name}
          </T>
          <T muted size={13}>
            {[selected.className, options.length > 1 ? 'Çocuk değiştir' : undefined]
              .filter(Boolean)
              .join(' · ')}
          </T>
        </View>
        {options.length > 1 && <Icon name="ChevronDown" size={18} color={c.primary} />}
      </Pressable>
      {open && (
        <Sheet
          compact
          visible
          title="Çocuk seç"
          onClose={() => setOpen(false)}
          footer={<Button onPress={() => setOpen(false)}>Vazgeç</Button>}
        >
          <View accessibilityRole="radiogroup" accessibilityLabel="Çocuk" style={{ gap: 4 }}>
            {options.map((option) => (
              <Pressable
                key={option.id}
                accessibilityRole="radio"
                accessibilityLabel={`${option.name} seç`}
                accessibilityState={{ checked: option.id === value }}
                aria-checked={option.id === value}
                onPress={() => {
                  onChange(option.id)
                  setOpen(false)
                }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 16,
                  minHeight: 72,
                  paddingBottom: 16,
                  borderBottomWidth: 1,
                  borderColor: c.border,
                }}
              >
                <Avatar name={option.name} />
                <View style={{ flex: 1, gap: 4 }}>
                  <T bold size={17}>
                    {option.name}
                  </T>
                  <T muted size={14}>
                    {[option.className, option.id === value ? 'Seçili' : undefined]
                      .filter(Boolean)
                      .join(' · ')}
                  </T>
                </View>
                <Icon name={option.id === value ? 'Check' : 'Circle'} color={c.primary} />
              </Pressable>
            ))}
          </View>
        </Sheet>
      )}
    </>
  )
}

function GradeList({ childId }: { childId: string }) {
  // Arama ve sayfa çocuk bazında ayrı tutulur.
  const { state, setSearch, setIndex } = useListMemory(`veli/akademik-takip/${childId}`)
  const search = useDebouncedValue(state.search)
  const grades = useCollectionList<GradeRecord>('grades', {
    page: state.index + 1,
    pageSize: API_PAGE_SIZE,
    q: search,
    sort: ['-date'],
    filters: { studentId: childId },
  })
  const total = grades.data?.total
  const index = clampPageIndex(state.index, total)
  if (index !== state.index) setIndex(index)
  return (
    <>
      <SearchField value={state.search} onChange={setSearch} placeholder="Ders, konu veya sınav" />
      {grades.error ? (
        <QueryError error={grades.error} onRetry={() => void grades.refetch()} />
      ) : !grades.data ? (
        <ListLoading label="Notlar yükleniyor…" />
      ) : grades.data.rows.length === 0 ? (
        search ? (
          <EmptyResults noun="not" onClear={() => setSearch('')} />
        ) : (
          <Empty title="Henüz not girilmedi" text="Öğretmenler not girdiğinde burada görünür." />
        )
      ) : (
        <View style={{ gap: 10 }} accessibilityRole="list">
          {grades.data.rows.map(({ id, record }) => {
            const view = gradeView(record)
            return (
              <ListRow
                key={id}
                card
                title={view.title}
                subtitle={view.subtitle}
                eyebrow={view.score}
                badge={<Badge text={view.status} />}
              />
            )
          })}
        </View>
      )}
      {total !== undefined && (
        <Pagination count={total} index={index} pageSize={API_PAGE_SIZE} onChange={setIndex} />
      )}
    </>
  )
}

function childOptions(
  students: readonly CollectionRow<StudentRecord>[],
  classes: readonly CollectionRow<ClassRecord>[],
): ChildOption[] {
  const classNames = new Map(classes.map((row) => [row.id, row.record.name]))
  return students.map((row) => ({
    id: row.id,
    name: row.record.name,
    className: row.record.classId ? classNames.get(row.record.classId) : undefined,
  }))
}

/**
 * Veli: çocuk seçici ve seçili çocuğun notları (demo `akademik-takip` not listesi). Çocuklar
 * sunucunun veli kapsamından gelir (yalnız bağlı çocuklar); notlar `studentId` ile istenir,
 * sunucu yine yalnız bu velinin çocuklarının kayıtlarını döndürür.
 */
export default function ParentGrades() {
  const session = useApiSession()
  const open = canOpenScreen(session, 'ParentGrades')
  const [selected, setSelected] = useSelectedChild()
  const students = useCollectionAll<StudentRecord>('students', {}, { enabled: open })
  const classes = useCollectionAll<ClassRecord>('classes', {}, { enabled: open })
  const options = useMemo(
    () => childOptions(students.data ?? [], classes.data ?? []),
    [students.data, classes.data],
  )
  const childId = resolveChild(
    options.map((option) => option.id),
    selected,
  )

  if (!open)
    return (
      <Screen>
        <Empty title="Modül kullanıma kapalı" text="Yönetici modül tercihlerini değiştirebilir." />
      </Screen>
    )
  return (
    <Screen>
      <T muted>Notlar, dersler ve değerlendirmeler tek bir yerde.</T>
      {students.error ? (
        <QueryError error={students.error} onRetry={() => void students.refetch()} />
      ) : !students.data ? (
        <ListLoading label="Çocuklarınız yükleniyor…" />
      ) : !childId ? (
        <Empty title="Bağlı öğrenci yok" text="Hesabınıza bağlı öğrenci kaydı bulunamadı." />
      ) : (
        <>
          <ChildPicker options={options} value={childId} onChange={setSelected} />
          <GradeList key={childId} childId={childId} />
        </>
      )}
    </Screen>
  )
}
