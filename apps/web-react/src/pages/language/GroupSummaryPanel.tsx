import { useMemo } from 'react'
import { GROUP_AGE_BAND_LABELS } from '@kampus/school-core/lib/language-groups.ts'
import type { LanguageGroup } from '@kampus/react-shared/language-groups.ts'
import { useLanguageGroup, useOpenLanguageGroup } from '@kampus/react-shared/use-language-groups.ts'
import { QueryError } from '@/components/QueryError.tsx'
import { Icon } from '@/components/Icon.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { Button } from '@/components/ui/button'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { notify } from '@/lib/notify.ts'
import {
  SummaryHeader,
  SummaryIcon,
  SummaryList,
  SummaryLoading,
  SummaryMetrics,
  SummarySection,
} from '../management/SummaryParts.tsx'
import {
  DELIVERY_LABELS,
  groupActions,
  groupRow,
  groupStatusTone,
  slotLines,
  type TeacherNames,
} from './group-rows.ts'
import { useLanguageAccess } from './use-language-access.ts'

type Props = {
  /** `''` kapalı. */
  groupId: string
  names: TeacherNames | null
  onClose: () => void
  onEdit: (id: string) => void
  onCancel: (group: LanguageGroup) => void
  onMerge: (group: LanguageGroup) => void
}

/**
 * Grup özeti (sağ panel, `?grup=`): takvim, öğretmen, derslik, doluluk ve kursiyerler. Kursiyer
 * listesi yalnız tek grup okumasında ve personele döner; ad öğrenci kayıtlarından eşlenir, kapsam
 * dışı kayıt adsız "Kursiyer" olarak kalır. İşlemler (aç, düzenle, birleştir, iptal) yönetici ve
 * seviyenin koordinatörü öğretmendedir.
 */
export function GroupSummaryPanel({ groupId, names, onClose, onEdit, onCancel, onMerge }: Props) {
  const access = useLanguageAccess()
  const item = useLanguageGroup(groupId)
  const group = item.data?.data
  const actions = group ? groupActions(group, access.role, access.levels) : null
  const open = useOpenLanguageGroup()

  async function openGroup() {
    if (!group) return
    const outcome = await open.submit({ groupId: group.id, version: group.rowVersion ?? 0 })
    if (outcome.status === 'success') notify.success(`${group.name} açıldı.`)
  }

  const footer =
    group && actions && (actions.open || actions.edit || actions.merge || actions.cancel) ? (
      <div className="flex w-full flex-wrap gap-2">
        {actions.open ? (
          <Button
            onClick={() => void openGroup()}
            disabled={open.isPending}
            aria-busy={open.isPending || undefined}
          >
            <Icon name="Play" size={17} aria-hidden="true" />
            Grubu aç
          </Button>
        ) : null}
        {actions.edit ? (
          <Button variant="secondary" onClick={() => onEdit(group.id)}>
            <Icon name="Pencil" size={17} aria-hidden="true" />
            Düzenle
          </Button>
        ) : null}
        {actions.merge ? (
          <Button variant="secondary" aria-haspopup="dialog" onClick={() => onMerge(group)}>
            <Icon name="UsersRound" size={17} aria-hidden="true" />
            Birleştir
          </Button>
        ) : null}
        {actions.cancel ? (
          <Button variant="ghost" aria-haspopup="dialog" onClick={() => onCancel(group)}>
            <Icon name="X" size={17} aria-hidden="true" />
            İptal et
          </Button>
        ) : null}
      </div>
    ) : undefined

  return (
    <SidePanel
      open={groupId !== ''}
      onOpenChange={(next) => (next ? undefined : onClose())}
      title="Grup özeti"
      {...(footer ? { footer } : {})}
    >
      {item.error ? (
        <QueryError error={item.error} onRetry={() => void item.refetch()} />
      ) : !group ? (
        <SummaryLoading />
      ) : (
        <GroupSummary group={group} names={names} membershipId={access.membershipId} />
      )}
    </SidePanel>
  )
}

function GroupSummary({
  group,
  names,
  membershipId,
}: {
  group: LanguageGroup
  names: TeacherNames | null
  membershipId: string | undefined
}) {
  const row = groupRow(group, names, membershipId)
  const members = group.members ?? []
  const students = useCoreAll('students', {}, { enabled: members.length > 0 })
  const studentNames = useMemo(
    () => new Map((students.data ?? []).map(({ record }) => [record.id, record.name])),
    [students.data],
  )
  return (
    <>
      <SummaryHeader
        icon={<SummaryIcon name="UsersRound" />}
        title={group.name}
        subtitle={`${group.courseName} · ${row.level} · ${GROUP_AGE_BAND_LABELS[group.ageBand]}`}
        status={row.status}
        tone={groupStatusTone(group.status)}
      />
      <SummaryMetrics
        items={[
          { label: 'Doluluk', value: row.occupancy },
          { label: 'Boş yer', value: group.freeSeats ?? '—' },
          { label: 'Öğretmen', value: row.teacher },
          {
            label: 'Derslik',
            value: group.delivery === 'online' ? DELIVERY_LABELS.online : (group.room ?? '—'),
          },
        ]}
      />
      <SummarySection title="Takvim">
        <p className="mb-3 text-sm text-muted-foreground">{row.period}</p>
        <ul aria-label="Haftalık program" className="grid gap-2">
          {slotLines(group.schedule, group.sessionMinutes).map((line) => (
            <li key={line} className="rounded-xl border px-3.5 py-2.5 text-sm">
              {line}
            </li>
          ))}
        </ul>
      </SummarySection>
      {group.status === 'cancelled' && group.cancelReason ? (
        <SummarySection title="İptal gerekçesi">
          <p className="text-sm [overflow-wrap:anywhere]">{group.cancelReason}</p>
        </SummarySection>
      ) : null}
      {group.members ? (
        <SummarySection title="Kursiyerler">
          <SummaryList
            empty="Bu grupta henüz kursiyer yok."
            items={members.map((member) => ({
              key: member.studentId,
              label: studentNames.get(member.studentId) ?? 'Kursiyer',
              value: member.status === 'frozen' ? 'Donduruldu' : 'Etkin',
            }))}
          />
          {(group.frozenLearners ?? 0) > 0 || (group.openOffers ?? 0) > 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Dondurulan kursiyer: {group.frozenLearners ?? 0} · Açık teklif:{' '}
              {group.openOffers ?? 0}
            </p>
          ) : null}
        </SummarySection>
      ) : null}
    </>
  )
}
