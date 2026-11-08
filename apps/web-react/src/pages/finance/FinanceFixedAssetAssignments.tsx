import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import type { FixedAssetDetail } from '@kampus/react-shared/use-finance-fixed-assets.ts'
import {
  useAssignFixedAsset,
  useFixedAssetAssignees,
  useFixedAssetAssignments,
  useReturnFixedAsset,
  type FixedAssetAssignment,
} from '@kampus/react-shared/use-finance-fixed-asset-assignments.ts'
import {
  FIXED_ASSET_ASSIGNEE_TYPE_LABELS,
  FIXED_ASSET_ASSIGNEE_TYPES,
  FIXED_ASSET_RETURN_CONDITION_LABELS,
  FIXED_ASSET_RETURN_CONDITIONS,
  fixedAssetHolderLabel,
} from '@kampus/school-core/lib/finance-fixed-asset-assignments.ts'
import { dateLabel, dayKey } from '@kampus/school-core/lib/format.ts'
import { FormField } from '@/components/FormField.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useFixedAssetAssignmentPdf } from '@/hooks/use-finance-fixed-asset-assignment-pdf.ts'
import { FIXED_ASSET_ASSIGNMENT_TITLE } from '@/lib/pdf/templates/finance-fixed-asset-assignment.ts'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import { PdfDialogButton } from './CorporateParts.tsx'
import {
  assignBody,
  assignDefaults,
  assigneeOptionLabel,
  assignFormField,
  assignFormSchema,
  returnBody,
  returnFormSchema,
  type AssignFormValues,
  type ReturnFormValues,
} from './finance-fixed-asset-assignment-forms.ts'

const HISTORY_PAGE = { page: 1, pageSize: 20 } as const
const OPTION_PAGE_SIZE = 100
const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })

export const holderText = (assignment: Parameters<typeof fixedAssetHolderLabel>[0]) =>
  fixedAssetHolderLabel(assignment)

/**
 * Demirbaş ayrıntısındaki zimmet bölümü (DOM-FIN-086). Açık zimmet varsa teslim alan, tutanak PDF'i
 * ve iade formu; yoksa (hurdaya ayrılmamışsa) zimmet formu. Altında demirbaşın zimmet geçmişi;
 * geçmiş silinmez (K-212).
 */
export function FixedAssetAssignmentSection({ asset }: { asset: FixedAssetDetail }) {
  const history = useFixedAssetAssignments({ assetId: asset.id, ...HISTORY_PAGE })
  if (history.error)
    return <QueryError error={history.error} onRetry={() => void history.refetch()} />
  const items = history.data?.data
  if (!items) return <SummaryLoading />
  const open = asset.assignment ? items.find((item) => item.id === asset.assignment?.id) : undefined
  const scrapped = asset.status === 'scrapped'
  return (
    <section aria-labelledby="demirbas-zimmet" className="grid gap-3 border-t pt-4">
      <h3 id="demirbas-zimmet" className="text-base font-semibold">
        Zimmet
      </h3>
      {open ? (
        <OpenAssignment assignment={open} />
      ) : scrapped ? (
        <p className="text-sm text-muted-foreground">Hurdaya ayrılmış demirbaşa zimmet verilmez.</p>
      ) : (
        <AssignForm asset={asset} />
      )}
      <AssignmentHistory items={items} total={history.data?.meta.total ?? items.length} />
    </section>
  )
}

function OpenAssignment({ assignment }: { assignment: FixedAssetAssignment }) {
  return (
    <div className="grid gap-3">
      <p className="text-sm">
        <span className="text-muted-foreground">Zimmetli: </span>
        <span className="font-medium">{holderText(assignment)}</span>
        {' · '}
        {dayText(assignment.assignedDate)}
        {assignment.staffActive === false ? ' · personel pasif, iade alınmalı' : ''}
      </p>
      <div>
        <PdfDialogButton
          label="Zimmet tutanağı PDF"
          title={FIXED_ASSET_ASSIGNMENT_TITLE}
          id={assignment.id}
          usePdf={useFixedAssetAssignmentPdf}
        />
      </div>
      <ReturnForm assignment={assignment} />
    </div>
  )
}

function AssignmentHistory({
  items,
  total,
}: {
  items: readonly FixedAssetAssignment[]
  total: number
}) {
  if (items.length === 0)
    return <p className="text-sm text-muted-foreground">Bu demirbaş henüz zimmetlenmedi.</p>
  return (
    <div className="grid gap-2">
      <h4 className="text-sm font-semibold">Zimmet geçmişi</h4>
      <ul aria-label="Zimmet geçmişi" className="grid gap-2 text-sm">
        {items.map((item) => (
          <li key={item.id} className="grid gap-1 rounded-sm border px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium [overflow-wrap:anywhere]">{holderText(item)}</span>
              {item.returnDate === null ? (
                <StatusBadge text="Açık" tone="green" />
              ) : (
                <StatusBadge
                  text={
                    item.returnCondition
                      ? FIXED_ASSET_RETURN_CONDITION_LABELS[item.returnCondition]
                      : 'İade'
                  }
                  tone={item.returnCondition === 'damaged' ? 'amber' : 'gray'}
                />
              )}
            </div>
            <span className="text-muted-foreground">
              {dayText(item.assignedDate)}
              {item.returnDate === null ? ' – (iade edilmedi)' : ` – ${dayText(item.returnDate)}`}
            </span>
            {item.returnNote ? (
              <span className="[overflow-wrap:anywhere]">İade notu: {item.returnNote}</span>
            ) : null}
          </li>
        ))}
      </ul>
      {total > items.length ? (
        <p className="text-sm text-muted-foreground">
          Son {String(items.length)} zimmet gösteriliyor (toplam {String(total)}).
        </p>
      ) : null}
    </div>
  )
}

/** Zimmet ver (K-210, K-211): personel ya da konum; konum demirbaşın kayıtlı yerini önerir. */
function AssignForm({ asset }: { asset: FixedAssetDetail }) {
  const assign = useAssignFixedAsset()
  const branches = useCoreAll('branches')
  const [search, setSearch] = useState('')
  const query = useDebouncedValue(search).trim()
  const assignees = useFixedAssetAssignees({
    page: 1,
    pageSize: OPTION_PAGE_SIZE,
    status: 'active',
    ...(query.length >= 2 ? { q: query } : {}),
  })
  const form = useForm<AssignFormValues>({
    resolver: zodResolver(assignFormSchema),
    defaultValues: assignDefaults(asset, dayKey()),
  })
  const errors = form.formState.errors
  const busy = assign.isPending || form.formState.isSubmitting
  const type = useWatch({ control: form.control, name: 'assigneeType' })
  const options = assignees.data?.data ?? []
  const many = (assignees.data?.meta.total ?? 0) > OPTION_PAGE_SIZE || query !== ''
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await assign.submit(
      { assetId: asset.id, body: assignBody(values) },
      {
        setError: (name, error) => {
          const field = assignFormField(name)
          if (field) form.setError(field, error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status === 'success')
      notify.success(`${asset.tagNumber} ${holderText(outcome.data.data)} adına zimmetlendi.`)
  })
  return (
    <form
      noValidate
      aria-label="Zimmet ver"
      className="grid gap-3"
      onSubmit={(event) => void onSubmit(event)}
    >
      <FormField id="zimmet-alan" label="Zimmet alanı" error={errors.assigneeType}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('assigneeType')}
            className="w-full"
            disabled={busy}
          >
            {FIXED_ASSET_ASSIGNEE_TYPES.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {FIXED_ASSET_ASSIGNEE_TYPE_LABELS[value]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      {type === 'staff' ? (
        <>
          {many ? (
            <FormField
              id="zimmet-personel-ara"
              label="Personel ara"
              description="Listede yalnız ilk 100 kişi var; adla daraltın."
            >
              {(control) => (
                <Input
                  {...control}
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  disabled={busy}
                />
              )}
            </FormField>
          ) : null}
          <FormField id="zimmet-personel" label="Personel" error={errors.membershipId}>
            {(control) => (
              <NativeSelect
                {...control}
                {...form.register('membershipId')}
                className="w-full"
                disabled={busy}
              >
                <NativeSelectOption value="">
                  {assignees.isPending ? 'Personel yükleniyor…' : 'Personel seçin'}
                </NativeSelectOption>
                {options.map((item) => (
                  <NativeSelectOption key={item.membershipId} value={item.membershipId}>
                    {assigneeOptionLabel(item)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
        </>
      ) : (
        <>
          <FormField id="zimmet-kampus" label="Kampüs (isteğe bağlı)" error={errors.campusId}>
            {(control) => (
              <NativeSelect
                {...control}
                {...form.register('campusId')}
                className="w-full"
                disabled={busy}
              >
                <NativeSelectOption value="">Kampüs seçilmedi</NativeSelectOption>
                {(branches.data ?? []).map((item) => (
                  <NativeSelectOption key={item.record.id} value={item.record.id}>
                    {item.record.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <FormField
            id="zimmet-konum"
            label="Oda ya da yer"
            error={errors.location}
            description="Ör. 2. kat fen laboratuvarı."
          >
            {(control) => <Input {...control} {...form.register('location')} disabled={busy} />}
          </FormField>
        </>
      )}
      <FormField id="zimmet-gun" label="Zimmet günü" error={errors.assignedDate}>
        {(control) => (
          <Input {...control} type="date" {...form.register('assignedDate')} disabled={busy} />
        )}
      </FormField>
      <FormField id="zimmet-not" label="Not (isteğe bağlı)" error={errors.note}>
        {(control) => <Textarea {...control} {...form.register('note')} rows={2} disabled={busy} />}
      </FormField>
      <RootError message={errors.root?.server?.message} />
      <div>
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          Zimmet ver
        </Button>
      </div>
    </form>
  )
}

/** İade (K-212): gün, sağlam/hasarlı ve not; hasarlıda not zorunlu. Demirbaş durumu değişmez. */
function ReturnForm({ assignment }: { assignment: FixedAssetAssignment }) {
  const giveBack = useReturnFixedAsset()
  const form = useForm<ReturnFormValues>({
    resolver: zodResolver(returnFormSchema),
    defaultValues: { returnDate: dayKey(), condition: 'intact', note: '' },
  })
  const errors = form.formState.errors
  const busy = giveBack.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await giveBack.submit(
      { assignmentId: assignment.id, version: assignment.version, body: returnBody(values) },
      {
        setError: (name, error) => {
          if (name === 'returnDate' || name === 'condition' || name === 'note')
            form.setError(name, error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status === 'success') notify.success(`${assignment.assetTagNumber} iade alındı.`)
  })
  return (
    <form
      noValidate
      aria-label="Zimmet iadesi"
      className="grid gap-3"
      onSubmit={(event) => void onSubmit(event)}
    >
      <FormField id="iade-gun" label="İade günü" error={errors.returnDate}>
        {(control) => (
          <Input {...control} type="date" {...form.register('returnDate')} disabled={busy} />
        )}
      </FormField>
      <FormField id="iade-durum" label="İade durumu" error={errors.condition}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('condition')}
            className="w-full"
            disabled={busy}
          >
            {FIXED_ASSET_RETURN_CONDITIONS.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {FIXED_ASSET_RETURN_CONDITION_LABELS[value]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField
        id="iade-not"
        label="Durum notu"
        error={errors.note}
        description="Hasarlı iadede zorunlu."
      >
        {(control) => <Textarea {...control} {...form.register('note')} rows={2} disabled={busy} />}
      </FormField>
      <RootError message={errors.root?.server?.message} />
      <div>
        <Button type="submit" variant="secondary" disabled={busy} aria-busy={busy || undefined}>
          İade al
        </Button>
      </div>
    </form>
  )
}
