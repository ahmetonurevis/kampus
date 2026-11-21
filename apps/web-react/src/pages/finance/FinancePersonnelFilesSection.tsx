import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState, type ReactNode } from 'react'
import { useFieldArray, useForm, type FieldValues, type Path } from 'react-hook-form'
import { isApiError } from '@kampus/api-client/errors.ts'
import {
  useCreatePersonnelFile,
  usePersonnelFile,
  usePersonnelFiles,
  usePersonnelNationalIdReveal,
  useUpdatePersonnelFile,
  type PersonnelFileView,
  type UpdatePersonnelFileBody,
} from '@kampus/react-shared/use-finance-personnel-files.ts'
import {
  EDUCATION_LEVELS,
  PERSONNEL_EDUCATION_MAX,
  PERSONNEL_EMERGENCY_MAX,
  PERSONNEL_FILE_GROUP_LABELS,
  PERSONNEL_FILE_GROUPS,
  writablePersonnelFileGroups,
  type PersonnelFileGroup,
} from '@kampus/school-core/lib/finance-personnel-files.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import { roleLabel } from './finance-fixed-asset-assignment-forms.ts'
import {
  bankBody,
  bankDefaults,
  bankFormSchema,
  contactBody,
  contactDefaults,
  contactFormSchema,
  educationBody,
  educationDefaults,
  educationFormSchema,
  educationLevelLabel,
  educationText,
  emergencyBody,
  emergencyDefaults,
  emergencyFormSchema,
  emptyEducationRow,
  emptyEmergencyRow,
  filledGroupsText,
  identityBody,
  identityDefaults,
  identityFormSchema,
  personnelFormField,
  type BankFormValues,
  type ContactFormValues,
  type EducationFormValues,
  type EmergencyFormValues,
  type IdentityFormValues,
} from './finance-personnel-file-forms.ts'

const NO_SORT: readonly string[] = []
const MOBILE = ['name', 'file']
const FILTERS = [
  {
    key: 'status',
    label: 'Personel durumu',
    type: 'select' as const,
    options: [
      { value: 'active', label: 'Etkin' },
      { value: 'passive', label: 'Pasif (ayrılan)' },
    ],
  },
  {
    key: 'file',
    label: 'Özlük kartı',
    type: 'select' as const,
    options: [
      { value: 'with', label: 'Kartı olan' },
      { value: 'without', label: 'Kartı olmayan' },
    ],
  },
]
const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)

type Row = { id: string; name: string; role: string; active: boolean; file: string }

/**
 * Personel özlük kartları (DOM-FIN-140; ON-172): Finans "Özlük kartları" sekmesi, yönetici
 * (muhasebe rolü açılınca o da). Personel listesi kart durumuyla; "Kart" paneli grupları gösterir.
 * Hangi grubun göründüğünü ve düzenlendiğini sunucu belirler (K-475): yanıtta olmayan grup
 * gösterilmez, `access` yazma izni olan grupta düzenleme açılır. T.C. kimlik no ve IBAN maskelidir;
 * tam kimlik no yalnız istenince okunur ve her okuma denetim kaydına düşer (K-476).
 */
export function FinancePersonnelFilesSection() {
  const list = useListState('ozluk-kartlari', { urlPrefix: 'ok_' })
  const search = useDebouncedValue(list.state.query).trim()
  const status = text(list.state.filters.status)
  const file = text(list.state.filters.file)
  const staff = usePersonnelFiles({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.length >= 2 ? { q: search } : {}),
    ...(status === 'active' || status === 'passive' ? { status } : {}),
    ...(file === 'with' || file === 'without' ? { file } : {}),
  })
  const panel = useDetailPanel('ok_personel')
  const openPerson = panel.open
  const rows = useMemo(
    () =>
      staff.data?.data.map((item): Row => ({
        id: item.membershipId,
        name: item.name,
        role: roleLabel(item.role),
        active: item.active,
        file: filledGroupsText(item),
      })),
    [staff.data],
  )
  const columns = useMemo<DataColumn<Row>[]>(
    () => [
      { key: 'name', label: 'Ad' },
      { key: 'role', label: 'Rol' },
      {
        key: 'active',
        label: 'Durum',
        cell: (row) => (
          <StatusBadge
            text={row.active ? 'Etkin' : 'Pasif'}
            tone={row.active ? 'green' : 'amber'}
          />
        ),
      },
      { key: 'file', label: 'Kart' },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row: Row) => (
          <Button
            size="sm"
            variant="secondary"
            aria-label={`${row.name} özlük kartını aç`}
            onClick={() => openPerson(row.id)}
          >
            Kart
          </Button>
        ),
      },
    ],
    [openPerson],
  )
  const selectedName = rows?.find((row) => row.id === panel.selectedId)?.name ?? ''
  return (
    <section
      aria-labelledby="ozluk-kartlari"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading px-6 pt-6 pb-4 max-[650px]:px-4">
        <h2 id="ozluk-kartlari" className="text-lg font-semibold">
          Özlük kartları
        </h2>
        <p className="text-sm text-muted-foreground">
          Personelin kimlik, kişisel iletişim, eğitim, banka ve acil durum bilgileri. Her rol yalnız
          yetkili olduğu grupları görür; kimlik numarası ve IBAN maskelidir.
        </p>
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={staff.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={FILTERS}
        mobileColumns={MOBILE}
        caption="Personel ve özlük kartı durumu"
        empty="Kurumda personel yok."
        emptyFiltered="Bu seçimle eşleşen personel yok."
        loading={staff.isPending}
        fetching={staff.isFetching && !staff.isPending}
        error={
          staff.error ? (
            <QueryError error={staff.error} onRetry={() => void staff.refetch()} />
          ) : undefined
        }
      />
      <SidePanel
        open={panel.selectedId !== ''}
        onOpenChange={(open) => (open ? undefined : panel.close())}
        title="Özlük kartı"
      >
        {panel.selectedId ? (
          <PersonnelFileCard membershipId={panel.selectedId} fallbackName={selectedName} />
        ) : null}
      </SidePanel>
    </section>
  )
}

function PersonnelFileCard({
  membershipId,
  fallbackName,
}: {
  membershipId: string
  fallbackName: string
}) {
  const { session } = useAuth()
  const detail = usePersonnelFile(membershipId)
  const [editing, setEditing] = useState<PersonnelFileGroup | null>(null)
  const missing = isApiError(detail.error) && detail.error.status === 404
  if (detail.error && !missing)
    return <QueryError error={detail.error} onRetry={() => void detail.refetch()} />
  const card = missing ? null : detail.data?.data
  if (card === undefined) return <SummaryLoading />
  // Kart yoksa yazabildiği gruplar boş gösterilir; ilk kayıt kartı açar.
  const groups: PersonnelFileGroup[] =
    card === null
      ? writablePersonnelFileGroups(session?.role ?? '')
      : PERSONNEL_FILE_GROUPS.filter((group) => card.access[group] !== undefined)
  const canWrite = (group: PersonnelFileGroup) =>
    card === null ? groups.includes(group) : card.access[group] === 'write'
  const name = card?.name ?? fallbackName
  return (
    <div className="grid gap-5">
      <div className="grid gap-1">
        {name === '' ? null : <h3 className="text-base font-semibold">{name}</h3>}
        {card ? (
          <p className="text-sm text-muted-foreground">
            {roleLabel(card.role)}
            {card.active ? '' : ' · pasif (ayrılan)'}
          </p>
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            Bu personelin özlük kartı henüz açılmadı.
            {groups.length === 0 ? '' : ' Bir bilgi grubunu kaydedince kart açılır.'}
          </p>
        )}
      </div>
      {groups.map((group) => (
        <GroupBlock
          key={group}
          group={group}
          filled={card !== null && isFilled(card, group)}
          canWrite={canWrite(group)}
          onEdit={() => setEditing(group)}
        >
          {card === null ? null : (
            <GroupContent group={group} card={card} membershipId={membershipId} />
          )}
        </GroupBlock>
      ))}
      <Modal
        open={editing !== null}
        onOpenChange={(open) => (open ? undefined : setEditing(null))}
        title={editing === null ? '' : `${PERSONNEL_FILE_GROUP_LABELS[editing]} bilgileri`}
        description={name === '' ? undefined : `${name} için özlük kartı`}
      >
        {editing === null ? null : (
          <GroupForm
            group={editing}
            membershipId={membershipId}
            card={card}
            onDone={() => setEditing(null)}
          />
        )}
      </Modal>
    </div>
  )
}

function isFilled(card: PersonnelFileView, group: PersonnelFileGroup): boolean {
  switch (group) {
    case 'identity':
      return card.identity?.nationalIdMasked != null || card.identity?.birthDate != null
    case 'contact':
      return (
        card.contact?.address != null || card.contact?.phone != null || card.contact?.email != null
      )
    case 'education':
      return (card.education?.length ?? 0) > 0
    case 'bank':
      return card.bank?.ibanMasked != null
    case 'emergencyContacts':
      return (card.emergencyContacts?.length ?? 0) > 0
    default:
      return group satisfies never
  }
}

function GroupBlock({
  group,
  filled,
  canWrite,
  onEdit,
  children,
}: {
  group: PersonnelFileGroup
  filled: boolean
  canWrite: boolean
  onEdit: () => void
  children: ReactNode
}) {
  const label = PERSONNEL_FILE_GROUP_LABELS[group]
  const headingId = `ok-grup-${group}`
  return (
    <section aria-labelledby={headingId} className="grid gap-2 rounded-card border px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 id={headingId} className="font-semibold">
          {label}
        </h4>
        {canWrite ? (
          <Button
            size="sm"
            variant="secondary"
            aria-label={`${label} bilgilerini ${filled ? 'düzenle' : 'ekle'}`}
            onClick={onEdit}
          >
            {filled ? 'Düzenle' : 'Ekle'}
          </Button>
        ) : null}
      </div>
      {filled ? children : <p className="text-sm text-muted-foreground">Bilgi girilmedi.</p>}
    </section>
  )
}

const Pair = ({ term, value }: { term: string; value: string | null | undefined }) => (
  <>
    <dt className="text-muted-foreground">{term}</dt>
    <dd className="[overflow-wrap:anywhere]">{value ?? '—'}</dd>
  </>
)

function GroupContent({
  group,
  card,
  membershipId,
}: {
  group: PersonnelFileGroup
  card: PersonnelFileView
  membershipId: string
}) {
  const list = 'grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm'
  switch (group) {
    case 'identity':
      return (
        <>
          <dl className={list}>
            <dt className="text-muted-foreground">T.C. kimlik no</dt>
            <dd className="font-mono">{card.identity?.nationalIdMasked ?? '—'}</dd>
            <Pair
              term="Doğum günü"
              value={
                card.identity?.birthDate == null
                  ? null
                  : dateLabel(card.identity.birthDate, { year: 'numeric' })
              }
            />
          </dl>
          {card.canRevealNationalId && card.identity?.nationalIdMasked != null ? (
            <NationalIdReveal membershipId={membershipId} />
          ) : null}
        </>
      )
    case 'contact':
      return (
        <dl className={list}>
          <Pair term="Adres" value={card.contact?.address} />
          <Pair term="Telefon" value={card.contact?.phone} />
          <Pair term="E-posta" value={card.contact?.email} />
        </dl>
      )
    case 'education':
      return (
        <>
          <ul aria-label="Eğitim geçmişi" className="grid gap-1 text-sm">
            {(card.education ?? []).map((row, index) => (
              <li key={`${row.school}-${String(index)}`}>{educationText(row)}</li>
            ))}
          </ul>
          {card.certificates ? (
            <p className="text-sm text-muted-foreground">
              {card.certificates.count === 0
                ? 'Özlük belgelerinde sertifika yok.'
                : `Özlük belgelerinde ${String(card.certificates.count)} sertifika${
                    card.certificates.expiredCount > 0
                      ? `, ${String(card.certificates.expiredCount)} süresi geçmiş`
                      : ''
                  }${
                    card.certificates.latestDate === null
                      ? ''
                      : `; en yenisi ${dateLabel(card.certificates.latestDate, { year: 'numeric' })}`
                  }.`}
            </p>
          ) : null}
        </>
      )
    case 'bank':
      return (
        <dl className={list}>
          <dt className="text-muted-foreground">IBAN</dt>
          <dd className="font-mono [overflow-wrap:anywhere]">{card.bank?.ibanMasked ?? '—'}</dd>
          <Pair term="Hesap sahibi" value={card.bank?.accountHolder} />
        </dl>
      )
    case 'emergencyContacts':
      return (
        <ul aria-label="Acil durum kişileri" className="grid gap-1 text-sm">
          {(card.emergencyContacts ?? []).map((row, index) => (
            <li key={`${row.name}-${String(index)}`}>
              {row.name} ({row.relation}) · {row.phone}
            </li>
          ))}
        </ul>
      )
    default:
      return group satisfies never
  }
}

/** Tam kimlik no (K-476): yalnız istenince okunur, "Gizle" ile bellekten atılır. */
function NationalIdReveal({ membershipId }: { membershipId: string }) {
  const reveal = usePersonnelNationalIdReveal(membershipId)
  const value = reveal.query.data?.data.nationalId
  return (
    <div className="grid gap-1">
      <div>
        {reveal.revealed ? (
          <Button type="button" variant="ghost" size="sm" onClick={reveal.hide}>
            <Icon name="EyeOff" size={15} aria-hidden="true" />
            Gizle
          </Button>
        ) : (
          <Button type="button" variant="outline" size="sm" onClick={reveal.show}>
            <Icon name="Eye" size={15} aria-hidden="true" />
            Kimlik numarasını göster
          </Button>
        )}
      </div>
      {!reveal.revealed ? (
        <p className="text-sm text-muted-foreground">Her görüntüleme denetim kaydına yazılır.</p>
      ) : reveal.query.error ? (
        <QueryError error={reveal.query.error} onRetry={() => void reveal.query.refetch()} />
      ) : value === undefined ? (
        <p role="status" className="text-sm text-muted-foreground">
          Kimlik numarası yükleniyor…
        </p>
      ) : (
        <p className="text-sm">
          <span className="text-muted-foreground">Tam numara: </span>
          <span className="font-mono">{value ?? '—'}</span>
        </p>
      )}
    </div>
  )
}

// --- Grup formları -------------------------------------------------------------------------------

/** Grubun gövdesini yazar: kart yoksa açar (`POST`), varsa düzeltir (`PATCH`, sürümle). */
function useSaveGroup(membershipId: string, card: PersonnelFileView | null) {
  const create = useCreatePersonnelFile()
  const update = useUpdatePersonnelFile()
  return {
    busy: create.isPending || update.isPending,
    save: <T extends FieldValues>(
      group: PersonnelFileGroup,
      body: UpdatePersonnelFileBody,
      setError: (name: Path<T> | 'root.server', error: { type: string; message: string }) => void,
    ) => {
      const options = {
        setError: (name: string, error: { type: string; message: string }) => {
          const field = personnelFormField(group, name)
          setError(field === null ? 'root.server' : (field as Path<T>), error)
        },
      }
      return card === null
        ? create.submit({ membershipId, ...body }, options)
        : update.submit({ membershipId, version: card.version, body }, options)
    },
  }
}

function GroupForm({
  group,
  membershipId,
  card,
  onDone,
}: {
  group: PersonnelFileGroup
  membershipId: string
  card: PersonnelFileView | null
  onDone: () => void
}) {
  const props = { membershipId, card, onDone }
  switch (group) {
    case 'identity':
      return <IdentityForm {...props} />
    case 'contact':
      return <ContactForm {...props} />
    case 'education':
      return <EducationForm {...props} />
    case 'bank':
      return <BankForm {...props} />
    case 'emergencyContacts':
      return <EmergencyForm {...props} />
    default:
      return group satisfies never
  }
}

type FormProps = { membershipId: string; card: PersonnelFileView | null; onDone: () => void }

function SubmitRow({ busy, children }: { busy: boolean; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
        Kaydet
      </Button>
      {children}
    </div>
  )
}

function IdentityForm({ membershipId, card, onDone }: FormProps) {
  const saver = useSaveGroup(membershipId, card)
  const form = useForm<IdentityFormValues>({
    resolver: zodResolver(identityFormSchema),
    defaultValues: identityDefaults(card?.identity),
  })
  const errors = form.formState.errors
  const busy = saver.busy || form.formState.isSubmitting
  const hasNationalId = card?.identity?.nationalIdMasked != null
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await saver.save<IdentityFormValues>(
      'identity',
      identityBody(values),
      (name, error) => form.setError(name, error, { shouldFocus: true }),
    )
    if (outcome.status !== 'success') return
    notify.success('Kimlik bilgileri kaydedildi.')
    onDone()
  })
  return (
    <form
      noValidate
      aria-label="Kimlik bilgileri"
      className="grid gap-3"
      onSubmit={(event) => void onSubmit(event)}
    >
      <FormField
        id="ok-tckn"
        label="T.C. kimlik no"
        error={errors.nationalId}
        description={
          hasNationalId
            ? `Kayıtlı: ${card?.identity?.nationalIdMasked ?? ''}. Değiştirmek için yeni numarayı yazın; boş bırakılırsa değişmez.`
            : undefined
        }
      >
        {(control) => (
          <Input
            {...control}
            inputMode="numeric"
            autoComplete="off"
            {...form.register('nationalId')}
            disabled={busy}
          />
        )}
      </FormField>
      {hasNationalId ? (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" {...form.register('removeNationalId')} disabled={busy} />
          Kimlik numarasını karttan sil
        </label>
      ) : null}
      <FormField id="ok-dogum" label="Doğum günü" error={errors.birthDate}>
        {(control) => (
          <Input {...control} type="date" {...form.register('birthDate')} disabled={busy} />
        )}
      </FormField>
      <RootError message={errors.root?.server?.message} />
      <SubmitRow busy={busy} />
    </form>
  )
}

function ContactForm({ membershipId, card, onDone }: FormProps) {
  const saver = useSaveGroup(membershipId, card)
  const form = useForm<ContactFormValues>({
    resolver: zodResolver(contactFormSchema),
    defaultValues: contactDefaults(card?.contact),
  })
  const errors = form.formState.errors
  const busy = saver.busy || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await saver.save<ContactFormValues>(
      'contact',
      contactBody(values),
      (name, error) => form.setError(name, error, { shouldFocus: true }),
    )
    if (outcome.status !== 'success') return
    notify.success('İletişim bilgileri kaydedildi.')
    onDone()
  })
  return (
    <form
      noValidate
      aria-label="İletişim bilgileri"
      className="grid gap-3"
      onSubmit={(event) => void onSubmit(event)}
    >
      <FormField id="ok-adres" label="Adres" error={errors.address}>
        {(control) => (
          <Textarea {...control} rows={3} {...form.register('address')} disabled={busy} />
        )}
      </FormField>
      <FormField id="ok-telefon" label="Kişisel telefon" error={errors.phone}>
        {(control) => (
          <Input
            {...control}
            type="tel"
            autoComplete="off"
            {...form.register('phone')}
            disabled={busy}
          />
        )}
      </FormField>
      <FormField id="ok-eposta" label="Kişisel e-posta" error={errors.email}>
        {(control) => (
          <Input
            {...control}
            type="email"
            autoComplete="off"
            {...form.register('email')}
            disabled={busy}
          />
        )}
      </FormField>
      <RootError message={errors.root?.server?.message} />
      <SubmitRow busy={busy} />
    </form>
  )
}

function BankForm({ membershipId, card, onDone }: FormProps) {
  const saver = useSaveGroup(membershipId, card)
  const hasIban = card?.bank?.ibanMasked != null
  const form = useForm<BankFormValues>({
    resolver: zodResolver(bankFormSchema(hasIban)),
    defaultValues: bankDefaults(card?.bank),
  })
  const errors = form.formState.errors
  const busy = saver.busy || form.formState.isSubmitting
  const send = async (body: UpdatePersonnelFileBody, message: string) => {
    const outcome = await saver.save<BankFormValues>('bank', body, (name, error) =>
      form.setError(name, error, { shouldFocus: true }),
    )
    if (outcome.status !== 'success') return
    notify.success(message)
    onDone()
  }
  const onSubmit = form.handleSubmit((values) =>
    send(bankBody(values), 'Banka bilgileri kaydedildi.'),
  )
  return (
    <form
      noValidate
      aria-label="Banka bilgileri"
      className="grid gap-3"
      onSubmit={(event) => void onSubmit(event)}
    >
      <FormField
        id="ok-iban"
        label="IBAN"
        error={errors.iban}
        description={
          hasIban
            ? `Kayıtlı: ${card?.bank?.ibanMasked ?? ''}. Değiştirmek için yeni IBAN'ı yazın; boş bırakılırsa değişmez.`
            : 'TR ile başlayan 26 karakter.'
        }
      >
        {(control) => (
          <Input {...control} autoComplete="off" {...form.register('iban')} disabled={busy} />
        )}
      </FormField>
      <FormField id="ok-hesap-sahibi" label="Hesap sahibi" error={errors.accountHolder}>
        {(control) => (
          <Input
            {...control}
            autoComplete="off"
            {...form.register('accountHolder')}
            disabled={busy}
          />
        )}
      </FormField>
      <RootError message={errors.root?.server?.message} />
      <SubmitRow busy={busy}>
        {hasIban ? (
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => void send({ bank: null }, 'Banka bilgileri silindi.')}
          >
            Banka bilgisini sil
          </Button>
        ) : null}
      </SubmitRow>
    </form>
  )
}

function EducationForm({ membershipId, card, onDone }: FormProps) {
  const saver = useSaveGroup(membershipId, card)
  const form = useForm<EducationFormValues>({
    resolver: zodResolver(educationFormSchema),
    defaultValues: educationDefaults(card?.education),
  })
  const rows = useFieldArray({ control: form.control, name: 'rows' })
  const errors = form.formState.errors
  const busy = saver.busy || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await saver.save<EducationFormValues>(
      'education',
      educationBody(values),
      (name, error) => form.setError(name, error, { shouldFocus: true }),
    )
    if (outcome.status !== 'success') return
    notify.success('Eğitim bilgileri kaydedildi.')
    onDone()
  })
  return (
    <form
      noValidate
      aria-label="Eğitim bilgileri"
      className="grid gap-3"
      onSubmit={(event) => void onSubmit(event)}
    >
      {rows.fields.length === 0 ? (
        <p className="text-sm text-muted-foreground">Eğitim satırı yok.</p>
      ) : null}
      {rows.fields.map((field, index) => {
        const ordinal = String(index + 1)
        const rowErrors = errors.rows?.[index]
        return (
          <fieldset key={field.id} className="grid gap-2 rounded-sm border px-3 py-2">
            <legend className="px-1 text-sm font-medium">{`${ordinal}. eğitim`}</legend>
            <FormField id={`ok-duzey-${ordinal}`} label="Düzey" error={rowErrors?.level}>
              {(control) => (
                <NativeSelect
                  {...control}
                  {...form.register(`rows.${index}.level`)}
                  className="w-full"
                  disabled={busy}
                >
                  {EDUCATION_LEVELS.map((level) => (
                    <NativeSelectOption key={level} value={level}>
                      {educationLevelLabel(level)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              )}
            </FormField>
            <FormField id={`ok-okul-${ordinal}`} label="Okul" error={rowErrors?.school}>
              {(control) => (
                <Input {...control} {...form.register(`rows.${index}.school`)} disabled={busy} />
              )}
            </FormField>
            <FormField id={`ok-bolum-${ordinal}`} label="Bölüm" error={rowErrors?.department}>
              {(control) => (
                <Input
                  {...control}
                  {...form.register(`rows.${index}.department`)}
                  disabled={busy}
                />
              )}
            </FormField>
            <FormField
              id={`ok-mezuniyet-${ordinal}`}
              label="Mezuniyet yılı"
              error={rowErrors?.graduationYear}
              description="Öğrenim sürüyorsa boş bırakın."
            >
              {(control) => (
                <Input
                  {...control}
                  inputMode="numeric"
                  {...form.register(`rows.${index}.graduationYear`)}
                  disabled={busy}
                />
              )}
            </FormField>
            <div>
              <Button
                type="button"
                variant="ghost"
                aria-label={`${ordinal}. eğitimi çıkar`}
                disabled={busy}
                onClick={() => rows.remove(index)}
              >
                Çıkar
              </Button>
            </div>
          </fieldset>
        )
      })}
      <div>
        <Button
          type="button"
          variant="secondary"
          disabled={busy || rows.fields.length >= PERSONNEL_EDUCATION_MAX}
          onClick={() => rows.append(emptyEducationRow())}
        >
          Eğitim ekle
        </Button>
      </div>
      <RootError message={errors.root?.server?.message ?? errors.rows?.message} />
      <SubmitRow busy={busy} />
    </form>
  )
}

function EmergencyForm({ membershipId, card, onDone }: FormProps) {
  const saver = useSaveGroup(membershipId, card)
  const form = useForm<EmergencyFormValues>({
    resolver: zodResolver(emergencyFormSchema),
    defaultValues: emergencyDefaults(card?.emergencyContacts),
  })
  const rows = useFieldArray({ control: form.control, name: 'rows' })
  const errors = form.formState.errors
  const busy = saver.busy || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await saver.save<EmergencyFormValues>(
      'emergencyContacts',
      emergencyBody(values),
      (name, error) => form.setError(name, error, { shouldFocus: true }),
    )
    if (outcome.status !== 'success') return
    notify.success('Acil durum kişileri kaydedildi.')
    onDone()
  })
  return (
    <form
      noValidate
      aria-label="Acil durum kişileri"
      className="grid gap-3"
      onSubmit={(event) => void onSubmit(event)}
    >
      {rows.fields.length === 0 ? (
        <p className="text-sm text-muted-foreground">Acil durum kişisi yok.</p>
      ) : null}
      {rows.fields.map((field, index) => {
        const ordinal = String(index + 1)
        const rowErrors = errors.rows?.[index]
        return (
          <fieldset key={field.id} className="grid gap-2 rounded-sm border px-3 py-2">
            <legend className="px-1 text-sm font-medium">{`${ordinal}. kişi`}</legend>
            <FormField id={`ok-acil-ad-${ordinal}`} label="Ad soyad" error={rowErrors?.name}>
              {(control) => (
                <Input {...control} {...form.register(`rows.${index}.name`)} disabled={busy} />
              )}
            </FormField>
            <FormField
              id={`ok-acil-yakinlik-${ordinal}`}
              label="Yakınlık"
              error={rowErrors?.relation}
            >
              {(control) => (
                <Input {...control} {...form.register(`rows.${index}.relation`)} disabled={busy} />
              )}
            </FormField>
            <FormField id={`ok-acil-telefon-${ordinal}`} label="Telefon" error={rowErrors?.phone}>
              {(control) => (
                <Input
                  {...control}
                  type="tel"
                  {...form.register(`rows.${index}.phone`)}
                  disabled={busy}
                />
              )}
            </FormField>
            <div>
              <Button
                type="button"
                variant="ghost"
                aria-label={`${ordinal}. kişiyi çıkar`}
                disabled={busy}
                onClick={() => rows.remove(index)}
              >
                Çıkar
              </Button>
            </div>
          </fieldset>
        )
      })}
      <div>
        <Button
          type="button"
          variant="secondary"
          disabled={busy || rows.fields.length >= PERSONNEL_EMERGENCY_MAX}
          onClick={() => rows.append(emptyEmergencyRow())}
        >
          Kişi ekle
        </Button>
      </div>
      <RootError message={errors.root?.server?.message ?? errors.rows?.message} />
      <SubmitRow busy={busy} />
    </form>
  )
}
