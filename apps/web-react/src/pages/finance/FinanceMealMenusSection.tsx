import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { Controller, useFieldArray, useForm } from 'react-hook-form'
import {
  useArchiveMealMenu,
  useCreateMealMenu,
  useMealMenu,
  useMealMenus,
  useMealMenuSettings,
  usePublishMealMenu,
  useSetMealMenuSettings,
  useUnpublishMealMenu,
  useUpdateMealMenu,
  type MealMenuDay,
  type MealMenuDetail,
  type MealMenuRow,
} from '@kampus/react-shared/use-finance-meal-menus.ts'
import { addDays } from '@kampus/school-core/lib/academic-years.ts'
import {
  ALLERGEN_HINTS,
  ALLERGEN_LABELS,
  ALLERGENS,
  MEAL_KIND_LABELS,
  MEAL_KINDS,
  MEAL_ITEMS_PER_SLOT_MAX,
  mealAllergenMatrix,
  mealWeekStartOf,
  type MealKind,
} from '@kampus/school-core/lib/finance-meal-menus.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { EmptyState } from '@/components/EmptyState.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { LineTabs } from '@/components/LineTabs.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import {
  allergensText,
  branchText,
  correctionReasonError,
  createBody,
  createFormSchema,
  dayHeading,
  emptyItem,
  gridMealKinds,
  isPastPublished,
  mealKindText,
  nutritionText,
  slotBody,
  slotDefaults,
  slotFormField,
  slotFormSchema,
  slotItems,
  statusText,
  totalsText,
  weekText,
  type CreateFormValues,
  type SlotFormValues,
} from './finance-meal-menu-forms.ts'

const NO_SORT: readonly string[] = []
const SOURCE_QUERY = { page: 1, pageSize: 20 } as const

/**
 * Yemek menüsü (DOM-FIN-157; ON-090, ON-149; IST-099): Finans "Yemek menüsü" sekmesi, yönetici ve
 * ön büro (K-527). Liste haftalık menüleri gösterir; menü haftalık ızgarada (gün × öğün) ve
 * alerjen matrisinde açılır. Hücre formu yemekleri sırasıyla, 14 alerjeni ve besin değerini alır;
 * yayımlanmış menünün geçmiş günü yalnız yöneticinin gerekçeli düzeltmesidir. Öğün ayarı
 * yöneticidedir. `meals` modülü kapalıysa sekme yalnız bilgi verir. Veli ve öğrenci ekranı
 * platform kabuğundadır (uç `GET /finance/meal-menus/my`).
 */
export function FinanceMealMenusSection() {
  const { session } = useAuth()
  if (session?.modules.meals !== true)
    return (
      <EmptyState
        icon="Utensils"
        title="Yemek menüsü modülü kapalı"
        description="Menü hazırlamak için kurum ayarlarından Yemek Menüsü modülünü açın."
      />
    )
  return <MealMenus isManager={session.role === 'yonetici'} />
}

function MealMenus({ isManager }: { isManager: boolean }) {
  const panel = useDetailPanel('menu')
  if (panel.selectedId !== '')
    return <MenuView menuId={panel.selectedId} isManager={isManager} onBack={panel.close} />
  return <MenuList isManager={isManager} onOpen={panel.open} />
}

type MenuTableRow = {
  id: string
  week: string
  branch: string
  status: string
  content: string
  row: MealMenuRow
}

function MenuList({ isManager, onOpen }: { isManager: boolean; onOpen: (id: string) => void }) {
  const list = useListState('yemek-menuleri', { urlPrefix: 'menu_' })
  const menus = useMealMenus({ page: list.state.page, pageSize: list.state.pageSize })
  const [dialog, setDialog] = useState<'create' | 'settings' | null>(null)
  const rows = useMemo(
    () =>
      menus.data?.data.map((row): MenuTableRow => ({
        id: row.id,
        week: weekText(row),
        branch: branchText(row),
        status: statusText(row.status),
        content:
          row.itemCount === 0
            ? 'Boş'
            : `${String(row.dayCount)} gün · ${String(row.itemCount)} yemek`,
        row,
      })),
    [menus.data],
  )
  const columns = useMemo<DataColumn<MenuTableRow>[]>(
    () => [
      { key: 'week', label: 'Hafta' },
      { key: 'branch', label: 'Kampüs' },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => (
          <StatusBadge
            text={row.status}
            tone={row.row.status === 'published' ? 'green' : 'amber'}
          />
        ),
      },
      { key: 'content', label: 'İçerik' },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <Button
            className="min-h-11"
            variant="secondary"
            aria-label={`${row.week} ${row.branch} menüsünü aç`}
            onClick={() => onOpen(row.id)}
          >
            Aç
          </Button>
        ),
      },
    ],
    [onOpen],
  )
  return (
    <section
      aria-labelledby="yemek-menuleri"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
        <div className="grid gap-1">
          <h2 id="yemek-menuleri" className="text-lg font-semibold">
            Yemek menüsü
          </h2>
          <p className="text-sm text-muted-foreground">
            Haftalık menü, alerjen işaretleri ve besin değeri; yayımlanan menüyü veli ve öğrenci
            görür.
          </p>
        </div>
        <span className="flex flex-wrap gap-2">
          {isManager ? (
            <Button className="min-h-11" variant="secondary" onClick={() => setDialog('settings')}>
              Öğün ayarı
            </Button>
          ) : null}
          <Button className="min-h-11" onClick={() => setDialog('create')}>
            Menü aç
          </Button>
        </span>
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={menus.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        mobileColumns={['week', ACTIONS_KEY]}
        caption="Haftalık yemek menüleri"
        empty="Henüz menü yok."
        emptyFiltered="Bu süzgeçle eşleşen menü yok."
        loading={menus.isPending}
        fetching={menus.isFetching && !menus.isPending}
        error={
          menus.error ? (
            <QueryError error={menus.error} onRetry={() => void menus.refetch()} />
          ) : undefined
        }
      />
      <Modal
        open={dialog === 'create'}
        onOpenChange={(open) => (open ? undefined : setDialog(null))}
        title="Menü aç"
      >
        {dialog === 'create' ? (
          <CreateMenuForm
            onDone={(id) => {
              setDialog(null)
              if (id !== undefined) onOpen(id)
            }}
          />
        ) : null}
      </Modal>
      <Modal
        open={dialog === 'settings'}
        onOpenChange={(open) => (open ? undefined : setDialog(null))}
        title="Öğün ayarı"
      >
        {dialog === 'settings' ? <SettingsForm onDone={() => setDialog(null)} /> : null}
      </Modal>
    </section>
  )
}

function CreateMenuForm({ onDone }: { onDone: (id?: string) => void }) {
  const create = useCreateMealMenu()
  const branches = useCoreAll('branches')
  const sources = useMealMenus(SOURCE_QUERY)
  const form = useForm<CreateFormValues>({
    resolver: zodResolver(createFormSchema),
    defaultValues: {
      weekDay: mealWeekStartOf(addDays(dayKey(), 7)),
      branchId: '',
      copyFromMenuId: '',
    },
  })
  const errors = form.formState.errors
  const busy = create.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await create.submit(createBody(values), {
      setError: (name, error) => {
        const field =
          name === 'weekStart'
            ? 'weekDay'
            : name === 'branchId' || name === 'copyFromMenuId'
              ? name
              : null
        if (field) form.setError(field, error, { shouldFocus: true })
        else form.setError('root.server', error)
      },
    })
    if (outcome.status !== 'success') return
    notify.success(`${weekText(outcome.data.data)} menüsü açıldı.`)
    onDone(outcome.data.data.id)
  })
  return (
    <form
      noValidate
      aria-label="Menü aç"
      className="grid gap-3"
      onSubmit={(event) => void onSubmit(event)}
    >
      <FormField
        id="menu-hafta"
        label="Hafta"
        description="Seçilen günün haftası pazartesiden pazara açılır."
        error={errors.weekDay}
      >
        {(control) => (
          <Input {...control} type="date" {...form.register('weekDay')} disabled={busy} />
        )}
      </FormField>
      <FormField id="menu-kampus" label="Kampüs" error={errors.branchId}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('branchId')}
            className="w-full"
            disabled={busy}
          >
            <NativeSelectOption value="">Bütün kampüsler</NativeSelectOption>
            {(branches.data ?? []).map((branch) => (
              <NativeSelectOption key={branch.record.id} value={branch.record.id}>
                {branch.record.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField
        id="menu-kopya"
        label="Kopyalanacak menü"
        description="Seçilen menünün yemekleri yeni haftanın aynı günlerine kopyalanır."
        error={errors.copyFromMenuId}
      >
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('copyFromMenuId')}
            className="w-full"
            disabled={busy || sources.isPending}
          >
            <NativeSelectOption value="">Boş menü</NativeSelectOption>
            {(sources.data?.data ?? []).map((menu) => (
              <NativeSelectOption key={menu.id} value={menu.id}>
                {`${weekText(menu)} · ${branchText(menu)}`}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <RootError message={errors.root?.server?.message} />
      <Button type="submit" className="min-h-11" disabled={busy} aria-busy={busy || undefined}>
        Menüyü aç
      </Button>
    </form>
  )
}

function SettingsForm({ onDone }: { onDone: () => void }) {
  const settings = useMealMenuSettings()
  const save = useSetMealMenuSettings()
  const current = settings.data?.data
  const [kinds, setKinds] = useState<MealKind[] | null>(null)
  const [error, setError] = useState<string | undefined>()
  if (settings.error)
    return <QueryError error={settings.error} onRetry={() => void settings.refetch()} />
  if (!current) return <SummaryLoading />
  const selected = kinds ?? current.mealKinds
  const submit = async () => {
    if (selected.length === 0) {
      setError('En az bir öğün seçin.')
      return
    }
    const outcome = await save.submit(
      { version: current.version, body: { mealKinds: selected } },
      { setError: (_name, issue) => setError(issue.message) },
    )
    if (outcome.status !== 'success') return
    notify.success('Öğün ayarı kaydedildi.')
    onDone()
  }
  return (
    <form
      noValidate
      aria-label="Öğün ayarı"
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Kurumun kullandığı öğünler</legend>
        {MEAL_KINDS.map((kind) => (
          <div key={kind} className="flex min-h-11 items-center gap-2">
            <Checkbox
              id={`ogun-${kind}`}
              checked={selected.includes(kind)}
              disabled={save.isPending}
              onCheckedChange={(checked) => {
                setError(undefined)
                setKinds(
                  checked === true
                    ? MEAL_KINDS.filter((item) => item === kind || selected.includes(item))
                    : selected.filter((item) => item !== kind),
                )
              }}
            />
            <Label htmlFor={`ogun-${kind}`}>{MEAL_KIND_LABELS[kind]}</Label>
          </div>
        ))}
      </fieldset>
      <p className="text-sm text-muted-foreground">
        Kapatılan öğünün yazılmış yemekleri görünür kalır; yeni yemek yazılmaz.
      </p>
      <RootError message={error} />
      <Button type="submit" className="min-h-11" disabled={save.isPending}>
        Ayarı kaydet
      </Button>
    </form>
  )
}

// --- Menü görünümü -------------------------------------------------------------------------------

type View = 'izgara' | 'matris'
const VIEW_OPTIONS = [
  { value: 'izgara', label: 'Haftalık menü' },
  { value: 'matris', label: 'Alerjen matrisi' },
] as const satisfies readonly { value: View; label: string }[]

function MenuView({
  menuId,
  isManager,
  onBack,
}: {
  menuId: string
  isManager: boolean
  onBack: () => void
}) {
  const menu = useMealMenu(menuId)
  const settings = useMealMenuSettings()
  const [view, setView] = useState<View>('izgara')
  const back = (
    <Button variant="ghost" className="min-h-11 justify-self-start" onClick={onBack}>
      Menü listesine dön
    </Button>
  )
  if (menu.error)
    return (
      <div className="grid gap-3">
        {back}
        <QueryError error={menu.error} onRetry={() => void menu.refetch()} />
      </div>
    )
  const detail = menu.data?.data
  if (!detail) return <SummaryLoading />
  const enabled = settings.data?.data.mealKinds ?? []
  return (
    <section
      aria-labelledby="yemek-menusu-hafta"
      className="panel grid min-w-0 gap-4 rounded-card border bg-surface p-4 sm:p-6"
    >
      {back}
      <MenuHeader detail={detail} onArchived={onBack} />
      <LineTabs label="Menü görünümü" value={view} options={VIEW_OPTIONS} onChange={setView} />
      {view === 'izgara' ? (
        <WeekGrid
          detail={detail}
          kinds={gridMealKinds(enabled, detail.days)}
          isManager={isManager}
        />
      ) : (
        <AllergenMatrix detail={detail} />
      )}
      {detail.corrections.length > 0 ? (
        <section aria-labelledby="menu-duzeltmeler" className="grid gap-2">
          <h3 id="menu-duzeltmeler" className="font-semibold">
            Geçmiş gün düzeltmeleri
          </h3>
          <ul aria-label="Geçmiş gün düzeltmeleri" className="grid gap-1 text-sm">
            {detail.corrections.map((row) => (
              <li key={row.id}>
                {`${dayHeading(row.menuDate)} · ${mealKindText(row.mealKind)}: ${row.reason}`}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  )
}

function MenuHeader({ detail, onArchived }: { detail: MealMenuDetail; onArchived: () => void }) {
  const publish = usePublishMealMenu()
  const unpublish = useUnpublishMealMenu()
  const archive = useArchiveMealMenu()
  const busy = publish.isPending || unpublish.isPending || archive.isPending
  const today = dayKey()
  const input = { menuId: detail.id, version: detail.version }
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="grid gap-1">
        <h2 id="yemek-menusu-hafta" className="text-lg font-semibold">
          {`Yemek menüsü: ${weekText(detail)}`}
        </h2>
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>{branchText(detail)}</span>
          <StatusBadge
            text={statusText(detail.status)}
            tone={detail.status === 'published' ? 'green' : 'amber'}
          />
        </p>
      </div>
      <span className="flex flex-wrap gap-2">
        {detail.status === 'draft' ? (
          <>
            <Button
              className="min-h-11"
              disabled={busy}
              onClick={() =>
                void publish.submit(input).then((outcome) => {
                  if (outcome.status === 'success')
                    notify.success('Menü yayımlandı; veli ve öğrenci görebilir.')
                })
              }
            >
              Yayımla
            </Button>
            <Button
              className="min-h-11"
              variant="ghost"
              disabled={busy}
              onClick={() =>
                void archive.submit(input).then((outcome) => {
                  if (outcome.status !== 'success') return
                  notify.success('Taslak menü arşivlendi.')
                  onArchived()
                })
              }
            >
              Taslağı arşivle
            </Button>
          </>
        ) : detail.weekStart > today ? (
          <Button
            className="min-h-11"
            variant="secondary"
            disabled={busy}
            onClick={() =>
              void unpublish.submit(input).then((outcome) => {
                if (outcome.status === 'success') notify.success('Menü taslağa döndü.')
              })
            }
          >
            Yayımdan kaldır
          </Button>
        ) : null}
      </span>
    </header>
  )
}

function WeekGrid({
  detail,
  kinds,
  isManager,
}: {
  detail: MealMenuDetail
  kinds: readonly MealKind[]
  isManager: boolean
}) {
  const [editing, setEditing] = useState<{ day: MealMenuDay; kind: MealKind } | null>(null)
  const today = dayKey()
  return (
    <>
      <div className="grid gap-x-4 gap-y-5 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7">
        {detail.days.map((day) => {
          const heading = dayHeading(day.menuDate)
          return (
            <section
              key={day.menuDate}
              aria-label={heading}
              className="grid content-start gap-3 border-t pt-3"
            >
              <h3 className="font-semibold">{heading}</h3>
              {kinds.map((kind) => {
                const items = slotItems(day, kind)
                return (
                  <div key={kind} className="grid gap-1">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="text-sm font-medium">{mealKindText(kind)}</h4>
                      <Button
                        variant="ghost"
                        className="min-h-11"
                        aria-label={`${heading} ${mealKindText(kind)} düzenle`}
                        onClick={() => setEditing({ day, kind })}
                      >
                        Düzenle
                      </Button>
                    </div>
                    {items.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Yemek yok</p>
                    ) : (
                      <ol aria-label={`${heading} ${mealKindText(kind)}`} className="grid gap-2">
                        {items.map((item) => (
                          <li key={item.id} className="grid text-sm">
                            <span className="font-medium">{item.name}</span>
                            <span className="text-muted-foreground">
                              {allergensText(item.allergens)}
                            </span>
                            <span className="text-muted-foreground">{nutritionText(item)}</span>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                )
              })}
              {day.totals.itemCount > 0 ? (
                <p className="text-sm" aria-label={`${heading} günlük toplam`}>
                  {`Günlük toplam: ${totalsText(day.totals)}`}
                </p>
              ) : null}
            </section>
          )
        })}
      </div>
      <Modal
        open={editing !== null}
        onOpenChange={(open) => (open ? undefined : setEditing(null))}
        title="Öğün menüsü"
        size="wide"
      >
        {editing === null ? null : (
          <SlotForm
            detail={detail}
            day={editing.day}
            kind={editing.kind}
            correcting={isPastPublished(detail, editing.day.menuDate, today)}
            isManager={isManager}
            onDone={() => setEditing(null)}
          />
        )}
      </Modal>
    </>
  )
}

function SlotForm({
  detail,
  day,
  kind,
  correcting,
  isManager,
  onDone,
}: {
  detail: MealMenuDetail
  day: MealMenuDay
  kind: MealKind
  correcting: boolean
  isManager: boolean
  onDone: () => void
}) {
  const update = useUpdateMealMenu()
  const form = useForm<SlotFormValues>({
    resolver: zodResolver(slotFormSchema),
    defaultValues: slotDefaults(slotItems(day, kind)),
  })
  const items = useFieldArray({ control: form.control, name: 'items' })
  const errors = form.formState.errors
  const locked = correcting && !isManager
  const busy = update.isPending || form.formState.isSubmitting || locked
  const heading = `${dayHeading(day.menuDate)} · ${mealKindText(kind)}`
  const onSubmit = form.handleSubmit(async (values) => {
    if (correcting) {
      const message = correctionReasonError(values.correctionReason)
      if (message) {
        form.setError('correctionReason', { message }, { shouldFocus: true })
        return
      }
    }
    const outcome = await update.submit(
      {
        menuId: detail.id,
        version: detail.version,
        body: slotBody(day.menuDate, kind, values, correcting),
      },
      {
        setError: (name, error) => {
          const field = slotFormField(name)
          if (field) form.setError(field, error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status !== 'success') return
    notify.success(`${heading} kaydedildi.`)
    onDone()
  })
  return (
    <form
      noValidate
      aria-label="Öğün menüsü"
      className="grid gap-4"
      onSubmit={(event) => void onSubmit(event)}
    >
      <p className="font-medium">{heading}</p>
      {locked ? (
        <p role="status" className="text-sm text-warning">
          Yayımlanmış menünün geçmiş günü yalnız yönetici düzeltmesiyle değişir.
        </p>
      ) : null}
      {items.fields.length === 0 ? (
        <p className="text-sm text-muted-foreground">Bu öğüne yemek yazılmadı.</p>
      ) : null}
      {items.fields.map((field, index) => {
        const label = `${String(index + 1)}. yemek`
        const id = `ogun-yemek-${String(index)}`
        const itemErrors = errors.items?.[index]
        return (
          <fieldset key={field.id} className="grid gap-3 border-t pt-3" aria-label={label}>
            <legend className="sr-only">{label}</legend>
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-0 flex-1">
                <FormField id={`${id}-ad`} label={`${label} adı`} error={itemErrors?.name}>
                  {(control) => (
                    <Input {...control} {...form.register(`items.${index}.name`)} disabled={busy} />
                  )}
                </FormField>
              </div>
              <Button
                type="button"
                variant="ghost"
                className="min-h-11"
                aria-label={`${label} yukarı taşı`}
                disabled={busy || index === 0}
                onClick={() => items.move(index, index - 1)}
              >
                Yukarı
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="min-h-11"
                aria-label={`${label} kaldır`}
                disabled={busy}
                onClick={() => items.remove(index)}
              >
                Kaldır
              </Button>
            </div>
            <Controller
              control={form.control}
              name={`items.${index}.allergens`}
              render={({ field: allergens }) => (
                <fieldset
                  className="grid grid-cols-2 gap-x-3 sm:grid-cols-3 lg:grid-cols-4"
                  aria-label={`${label} alerjenleri`}
                >
                  <legend className="col-span-full mb-1 text-sm font-medium">Alerjenler</legend>
                  {ALLERGENS.map((allergen) => (
                    <div key={allergen} className="flex min-h-11 items-center gap-2">
                      <Checkbox
                        id={`${id}-${allergen}`}
                        checked={allergens.value.includes(allergen)}
                        disabled={busy}
                        aria-describedby={`${id}-${allergen}-ipucu`}
                        onCheckedChange={(checked) =>
                          allergens.onChange(
                            checked === true
                              ? ALLERGENS.filter(
                                  (item) => item === allergen || allergens.value.includes(item),
                                )
                              : allergens.value.filter((item) => item !== allergen),
                          )
                        }
                      />
                      <Label htmlFor={`${id}-${allergen}`}>{ALLERGEN_LABELS[allergen]}</Label>
                      <span id={`${id}-${allergen}-ipucu`} className="sr-only">
                        {ALLERGEN_HINTS[allergen]}
                      </span>
                    </div>
                  ))}
                </fieldset>
              )}
            />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <FormField id={`${id}-enerji`} label="Enerji (kcal)" error={itemErrors?.energyKcal}>
                {(control) => (
                  <Input
                    {...control}
                    inputMode="numeric"
                    {...form.register(`items.${index}.energyKcal`)}
                    disabled={busy}
                  />
                )}
              </FormField>
              <FormField id={`${id}-protein`} label="Protein (g)" error={itemErrors?.proteinG}>
                {(control) => (
                  <Input
                    {...control}
                    inputMode="decimal"
                    {...form.register(`items.${index}.proteinG`)}
                    disabled={busy}
                  />
                )}
              </FormField>
              <FormField id={`${id}-yag`} label="Yağ (g)" error={itemErrors?.fatG}>
                {(control) => (
                  <Input
                    {...control}
                    inputMode="decimal"
                    {...form.register(`items.${index}.fatG`)}
                    disabled={busy}
                  />
                )}
              </FormField>
              <FormField
                id={`${id}-karbonhidrat`}
                label="Karbonhidrat (g)"
                error={itemErrors?.carbohydrateG}
              >
                {(control) => (
                  <Input
                    {...control}
                    inputMode="decimal"
                    {...form.register(`items.${index}.carbohydrateG`)}
                    disabled={busy}
                  />
                )}
              </FormField>
              <FormField id={`${id}-lif`} label="Lif (g)" error={itemErrors?.fiberG}>
                {(control) => (
                  <Input
                    {...control}
                    inputMode="decimal"
                    {...form.register(`items.${index}.fiberG`)}
                    disabled={busy}
                  />
                )}
              </FormField>
              <FormField id={`${id}-tuz`} label="Tuz (g)" error={itemErrors?.saltG}>
                {(control) => (
                  <Input
                    {...control}
                    inputMode="decimal"
                    {...form.register(`items.${index}.saltG`)}
                    disabled={busy}
                  />
                )}
              </FormField>
            </div>
          </fieldset>
        )
      })}
      <div>
        <Button
          type="button"
          variant="secondary"
          className="min-h-11"
          disabled={busy || items.fields.length >= MEAL_ITEMS_PER_SLOT_MAX}
          onClick={() => items.append(emptyItem())}
        >
          Yemek ekle
        </Button>
      </div>
      {correcting && isManager ? (
        <FormField
          id="ogun-duzeltme-gerekcesi"
          label="Düzeltme gerekçesi"
          description="Yayımlanmış menünün geçmiş günü değişiyor; önceki yemekler kayıtta kalır."
          error={errors.correctionReason}
        >
          {(control) => (
            <Textarea
              {...control}
              rows={3}
              {...form.register('correctionReason')}
              disabled={update.isPending}
            />
          )}
        </FormField>
      ) : null}
      <RootError message={errors.root?.server?.message ?? errors.items?.message} />
      <Button type="submit" className="min-h-11" disabled={busy} aria-busy={busy || undefined}>
        Öğünü kaydet
      </Button>
    </form>
  )
}

function AllergenMatrix({ detail }: { detail: MealMenuDetail }) {
  const { rows, dayAllergens } = useMemo(
    () =>
      mealAllergenMatrix(
        detail.days.flatMap((day) =>
          day.meals.flatMap((meal) =>
            meal.items.map((item) => ({
              menuDate: day.menuDate,
              mealKind: meal.mealKind,
              position: item.position,
              name: item.name,
              allergens: item.allergens,
            })),
          ),
        ),
      ),
    [detail.days],
  )
  if (rows.length === 0)
    return <p className="text-sm text-muted-foreground">Menüde yemek yok; matris boş.</p>
  return (
    <div className="grid min-w-0 gap-4">
      <div
        role="region"
        aria-label="Alerjen matrisi tablosu"
        tabIndex={0}
        className="relative overflow-x-auto rounded-card border"
      >
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <caption className="sr-only">Alerjen matrisi: gün, yemek ve 14 alerjen</caption>
          <thead>
            <tr className="border-b bg-surface-soft text-left">
              <th scope="col" className="px-3 py-2">
                Gün
              </th>
              <th scope="col" className="px-3 py-2">
                Yemek
              </th>
              {ALLERGENS.map((allergen) => (
                <th
                  key={allergen}
                  scope="col"
                  title={ALLERGEN_HINTS[allergen]}
                  className="px-2 py-2 text-center text-xs font-medium"
                >
                  {ALLERGEN_LABELS[allergen]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={`${row.menuDate}-${row.mealKind}-${String(row.position)}`}
                className="border-b"
              >
                <td className="px-3 py-2 whitespace-nowrap">{dayHeading(row.menuDate)}</td>
                <th scope="row" className="px-3 py-2 text-left font-medium">
                  {`${row.name} (${mealKindText(row.mealKind)})`}
                </th>
                {row.marks.map((mark, index) => (
                  <td key={ALLERGENS[index]} className="px-2 py-2 text-center">
                    {mark ? (
                      <>
                        <Icon name="Check" size={16} aria-hidden="true" />
                        <span className="sr-only">İçerir</span>
                      </>
                    ) : null}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section aria-labelledby="gunluk-alerjenler" className="grid gap-2">
        <h3 id="gunluk-alerjenler" className="font-semibold">
          Günün alerjenleri
        </h3>
        <ul aria-label="Günün alerjenleri" className="grid gap-1 text-sm">
          {[...dayAllergens.entries()].map(([day, allergens]) => (
            <li key={day}>{`${dayHeading(day)}: ${allergensText(allergens)}`}</li>
          ))}
        </ul>
      </section>
    </div>
  )
}
