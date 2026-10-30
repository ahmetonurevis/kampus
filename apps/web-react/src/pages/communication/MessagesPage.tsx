import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { accessRemainingMs, useConversations } from '@kampus/react-shared/use-communication.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { EmptyState } from '@/components/EmptyState.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import { useMediaQuery } from '@/hooks/use-media-query.ts'
import { useNow } from '@/hooks/use-now.ts'
import type { NavPage } from '@/lib/navigation.ts'
import {
  canStartConversation,
  conversationLabel,
  type PartyNames,
} from '@kampus/react-shared/conversation-model.ts'
import { ConversationList } from './ConversationList.tsx'
import { ConversationThread } from './ConversationThread.tsx'
import { NewConversationPanel } from './NewConversationPanel.tsx'

const NONE: readonly never[] = []
const NARROW_QUERY = '(max-width: 900px)'
const STUDENT_PARAM = 'ogrenci'

type Grant = { expiresAt: string; openedAt: number }

/**
 * Mesajlar (öğretmen, öğrenci, veli, yönetici): sol listede yazışmalar, sağda seçili yazışmanın
 * akışı (`?yazisma=<id>`). Dar ekranda liste ile akış ayrı görünümdür ("Listeye dön"). Yönetici
 * taraf değildir: önce öğrenciyi seçer (API `studentId` ister), listede yalnız üst veriyi görür
 * ve içeriği gerekçeyle 30 dakikalığına açar; açık erişimler yalnız bellekte durur (sunucu süreyi
 * dışa vermez), sayfa yenilenince gerekçe yeniden istenir.
 * Liste sayfa sayfa gelir: sonunda "Daha fazla yükle" sonraki sayfayı getirir.
 */
export function MessagesPage({ page, heading = true }: { page: NavPage; heading?: boolean }) {
  useDocumentTitle(page.title)
  const { session } = useAuth()
  const role = session?.role ?? 'ogrenci'
  const isAdmin = role === 'yonetici'
  const [params, setParams] = useSearchParams()
  const studentId = isAdmin ? (params.get(STUDENT_PARAM) ?? '') : ''
  const panel = useDetailPanel('yazisma')
  const narrow = useMediaQuery(NARROW_QUERY)
  const [starting, setStarting] = useState(false)
  const [grants, setGrants] = useState<Readonly<Record<string, Grant>>>({})
  const now = useNow(Object.keys(grants).length > 0)

  const conversations = useConversations({
    studentId: studentId || undefined,
    enabled: !isAdmin || studentId !== '',
  })
  const students = useCoreAll('students')
  const teachers = useCoreAll('teachers')
  const parents = useCoreAll('parents', {}, { enabled: role === 'ogretmen' })

  const names = useMemo<PartyNames>(() => {
    const parentsByStudent = new Map<string, string[]>()
    for (const row of parents.data ?? NONE)
      for (const id of row.record.studentIds)
        parentsByStudent.set(id, [...(parentsByStudent.get(id) ?? []), row.record.name])
    return {
      students: new Map((students.data ?? NONE).map((row) => [row.record.id, row.record.name])),
      teachers: new Map((teachers.data ?? NONE).map((row) => [row.record.id, row.record.name])),
      parentsByStudent,
    }
  }, [students.data, teachers.data, parents.data])

  const items = conversations.items
  const selected = items.find((item) => item.id === panel.selectedId)

  // Bağlantıyla açılan yazışma henüz yüklenmemiş bir sayfadaysa, bulunana ya da liste bitene kadar
  // sıradaki sayfa getirilir (dış sistemle eşitleme; "bulunamadı" yanlış gösterilmez).
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = conversations
  const lookingFor = panel.selectedId !== '' && selected === undefined
  useEffect(() => {
    if (lookingFor && hasNextPage && !isFetchingNextPage) void fetchNextPage()
  }, [lookingFor, hasNextPage, isFetchingNextPage, fetchNextPage])
  const grantNow = (id: string) => Math.max(now, grants[id]?.openedAt ?? 0)
  const accessIds = new Set(
    Object.entries(grants)
      .filter(([id, grant]) => accessRemainingMs(grant.expiresAt, grantNow(id)) > 0)
      .map(([id]) => id),
  )
  const studentOptions = useMemo(
    () =>
      (students.data ?? NONE)
        .map((row) => ({ value: row.record.id, label: row.record.name }))
        .sort((a, b) => a.label.localeCompare(b.label, 'tr')),
    [students.data],
  )

  if (!session) return null

  function chooseStudent(next: string) {
    const updated = new URLSearchParams(params)
    if (next) updated.set(STUDENT_PARAM, next)
    else updated.delete(STUDENT_PARAM)
    updated.delete('yazisma')
    setParams(updated, { replace: true })
  }

  const showThread = selected !== undefined
  const showList = !narrow || !showThread
  const waitingForStudent = isAdmin && studentId === ''
  const listError = conversations.error ?? students.error ?? teachers.error

  return (
    <>
      {heading ? (
        <PageHeading
          title={page.title}
          description={page.description}
          actions={
            canStartConversation(role) ? (
              <Button onClick={() => setStarting(true)}>
                <Icon name="Plus" size={16} />
                Yeni yazışma
              </Button>
            ) : null
          }
        />
      ) : null}
      <div className="grid gap-4">
        {!heading && canStartConversation(role) ? (
          <div className="flex justify-end">
            <Button onClick={() => setStarting(true)}>
              <Icon name="Plus" size={16} />
              Yeni yazışma
            </Button>
          </div>
        ) : null}

        {isAdmin ? (
          <div className="max-w-md">
            <FormField id="yazisma-ogrenci-sec" label="Öğrenci">
              {(control) => (
                <NativeSelect
                  {...control}
                  value={studentId}
                  onChange={(event) => chooseStudent(event.target.value)}
                >
                  <NativeSelectOption value="">Öğrenci seçin</NativeSelectOption>
                  {studentOptions.map((option) => (
                    <NativeSelectOption key={option.value} value={option.value}>
                      {option.label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              )}
            </FormField>
          </div>
        ) : null}

        {waitingForStudent ? (
          <EmptyState
            icon="MessagesSquare"
            title="Öğrenci seçin"
            description="Yazışmaların üst verisini görmek için yukarıdan bir öğrenci seçin. Yazışma içeriği gerekçeyle açılır."
          />
        ) : listError ? (
          <div role="alert" className="rounded-card border bg-surface p-8 text-center">
            <QueryError
              error={listError}
              onRetry={() => {
                for (const query of [conversations, students, teachers])
                  if (query.error) void query.refetch()
              }}
            />
          </div>
        ) : conversations.isPending ? (
          <p role="status" className="p-8 text-center text-base text-muted-foreground">
            Yazışmalar yükleniyor…
          </p>
        ) : items.length === 0 ? (
          <EmptyState
            icon="MessagesSquare"
            title="Henüz yazışma yok"
            description={
              canStartConversation(role)
                ? 'Yeni yazışma düğmesiyle ilk mesajı başlatabilirsiniz.'
                : 'Bu öğrenci için yazışma bulunmuyor.'
            }
          />
        ) : (
          <div
            className={
              narrow
                ? 'grid gap-3'
                : 'grid h-[calc(100dvh-18rem)] min-h-[520px] grid-cols-[minmax(280px,360px)_minmax(0,1fr)] gap-4'
            }
          >
            {showList ? (
              <nav
                aria-label="Yazışma listesi"
                className="min-h-0 overflow-y-auto rounded-card border bg-surface p-2"
              >
                <ConversationList
                  items={items}
                  role={role}
                  names={names}
                  selectedId={panel.selectedId}
                  accessIds={accessIds}
                  onSelect={panel.open}
                />
                {conversations.hasNextPage ? (
                  <div className="flex justify-center p-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => void conversations.fetchNextPage()}
                      disabled={conversations.isFetchingNextPage}
                      aria-busy={conversations.isFetchingNextPage}
                    >
                      {conversations.isFetchingNextPage ? 'Yükleniyor…' : 'Daha fazla yükle'}
                    </Button>
                  </div>
                ) : null}
              </nav>
            ) : null}
            {showThread ? (
              <div className="flex min-h-0 flex-col">
                <ConversationThread
                  key={selected.id}
                  conversation={selected}
                  label={conversationLabel(selected, role, names)}
                  role={role}
                  accessExpiresAt={grants[selected.id]?.expiresAt}
                  now={grantNow(selected.id)}
                  onAccessOpened={(expiresAt) =>
                    setGrants((current) => ({
                      ...current,
                      [selected.id]: { expiresAt, openedAt: Date.now() },
                    }))
                  }
                  {...(narrow ? { onBack: panel.close } : {})}
                />
              </div>
            ) : narrow ? null : (
              <div className="grid place-content-center rounded-card border bg-surface p-8 text-center text-sm text-muted-foreground">
                {panel.selectedId
                  ? 'Bu yazışma bulunamadı. Listeden başka bir yazışma seçin.'
                  : 'Okumak için soldan bir yazışma seçin.'}
              </div>
            )}
          </div>
        )}
      </div>

      <NewConversationPanel
        open={starting}
        onClose={() => setStarting(false)}
        onStarted={(id) => {
          setStarting(false)
          panel.open(id)
        }}
      />
    </>
  )
}
