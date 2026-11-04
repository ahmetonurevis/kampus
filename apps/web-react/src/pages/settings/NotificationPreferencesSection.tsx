import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import {
  clearChildOverrides,
  hasChildOverrides,
  isDirty,
  notificationPreferencesFormSchema,
  setChannel,
  toForm,
  toPatch,
  type NotificationChannel,
  type NotificationPreferencesForm,
  type NotificationTopic,
} from '@kampus/react-shared/notification-preferences-model.ts'
import {
  useNotificationPreferences,
  usePatchNotificationPreferences,
} from '@kampus/react-shared/use-notification-preferences.ts'
import { defaultNotificationPreferences } from '@kampus/school-core/lib/notification-preferences.ts'
import type { Session } from '@/auth/auth-port.ts'
import { QueryError } from '@/components/QueryError.tsx'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { withChildNames } from '@/lib/child-selection.ts'
import { notify } from '@/lib/notify.ts'
import {
  CHANNEL_COLUMNS,
  DELIVERY_NOTE,
  GENERAL_SCOPE,
  QUIET_HOURS_NOTE,
  preferenceRows,
  scopeOptions,
} from './notification-preference-rows.ts'

const NO_STUDENTS: ReadonlyArray<{ id: string; name: string }> = []

/**
 * Bildirim tercihleri (OG-107; DOM-ILT-020, -021): konu × kanal tablosu ve sessiz saat. Uygulama içi
 * kanal her konuda, zorunlu konularda (devamsızlık, etkinlik onayı) anlık bildirim de kapatılamaz
 * ve kilitli gösterilir. Veli çocuğa göre tercih ayırabilir. Kural ve kurum sınırı sunucudadır;
 * sürüm çakışmasında güncel tercih yüklenir.
 */
export function NotificationPreferencesSection({ session }: { session: Session }) {
  const parent = session.role === 'veli'
  const query = useNotificationPreferences()
  const students = useCoreAll('students', {}, { enabled: parent })
  const children = withChildNames(
    session.children,
    students.data?.map((row) => row.record) ?? NO_STUDENTS,
  )
  const [scope, setScope] = useState(GENERAL_SCOPE)
  const record = query.data?.data

  const form = useForm<NotificationPreferencesForm>({
    resolver: zodResolver(notificationPreferencesFormSchema),
    defaultValues: defaultNotificationPreferences(),
    ...(record ? { values: toForm(record) } : {}),
  })
  const save = usePatchNotificationPreferences({
    onSuccess: () => notify.success('Bildirim tercihleriniz kaydedildi.'),
  })

  const value = useWatch({ control: form.control }) as NotificationPreferencesForm
  const childId = parent && scope !== GENERAL_SCOPE ? scope : null
  const rows = record ? preferenceRows(value, childId) : []
  const dirty = record ? isDirty(value, record, parent) : false
  const errors = form.formState.errors
  const quiet = value.quietHours

  function update(next: NotificationPreferencesForm) {
    form.setValue('topics', next.topics, { shouldDirty: true })
    form.setValue('children', next.children, { shouldDirty: true })
  }

  function onToggle(topic: NotificationTopic, channel: NotificationChannel, on: boolean) {
    update(setChannel(value, topic, channel, on, childId))
  }

  const onSubmit = form.handleSubmit(async (values) => {
    if (!record) return
    await save.submit(toPatch(values, record, parent), { setError: form.setError })
  })

  return (
    <section
      aria-labelledby="bildirim-baslik"
      className="panel rounded-card border bg-surface p-6"
      aria-busy={save.isPending}
    >
      <h2 id="bildirim-baslik" className="text-lg font-semibold">
        Bildirimler
      </h2>
      <p className="mt-1 mb-4 text-sm text-muted-foreground">{DELIVERY_NOTE}</p>
      {query.isPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          Bildirim tercihleri yükleniyor…
        </p>
      ) : query.isError ? (
        <QueryError error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <form onSubmit={onSubmit} className="grid gap-6" noValidate>
          {parent && children.some((child) => child.name) ? (
            <div className="grid max-w-sm gap-1.5">
              <Label htmlFor="bildirim-kapsam">Tercih kapsamı</Label>
              <NativeSelect
                id="bildirim-kapsam"
                className="w-full"
                value={scope}
                onChange={(event) => setScope(event.target.value)}
              >
                {scopeOptions(children).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </NativeSelect>
              {childId ? (
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <span>Seçmediğiniz konular genel tercihi izler.</span>
                  {hasChildOverrides(value, childId) ? (
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      onClick={() => update(clearChildOverrides(value, childId))}
                    >
                      Genel tercihe dön
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Konu</TableHead>
                  {CHANNEL_COLUMNS.map((column) => (
                    <TableHead key={column.channel} scope="col" className="text-center">
                      {column.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.topic}>
                    <TableHead scope="row" className="font-medium">
                      {row.label}
                      {row.note ? (
                        <span className="block text-xs font-normal text-muted-foreground">
                          {row.note}
                        </span>
                      ) : null}
                    </TableHead>
                    {row.cells.map((cell) => (
                      <TableCell key={cell.channel} className="text-center">
                        <Checkbox
                          aria-label={cell.label}
                          checked={cell.checked}
                          disabled={cell.locked}
                          onCheckedChange={(next) =>
                            onToggle(cell.topic, cell.channel, next === true)
                          }
                        />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <fieldset className="grid gap-3">
            <legend className="text-base font-semibold">Sessiz saatler</legend>
            <div className="flex items-center gap-3">
              <Switch
                id="sessiz-saat-acik"
                checked={quiet.enabled}
                onCheckedChange={(next) =>
                  form.setValue('quietHours.enabled', next, { shouldDirty: true })
                }
              />
              <Label htmlFor="sessiz-saat-acik">Sessiz saatleri kullan</Label>
            </div>
            <div className="flex flex-wrap gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="sessiz-baslangic">Başlangıç</Label>
                <Input
                  id="sessiz-baslangic"
                  type="time"
                  disabled={!quiet.enabled}
                  className="w-32"
                  {...form.register('quietHours.start')}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="sessiz-bitis">Bitiş</Label>
                <Input
                  id="sessiz-bitis"
                  type="time"
                  disabled={!quiet.enabled}
                  className="w-32"
                  aria-invalid={errors.quietHours?.end ? true : undefined}
                  aria-describedby={errors.quietHours?.end ? 'sessiz-bitis-hata' : undefined}
                  {...form.register('quietHours.end')}
                />
              </div>
            </div>
            {errors.quietHours?.end || errors.quietHours?.start ? (
              <p id="sessiz-bitis-hata" role="alert" className="text-sm text-destructive">
                {errors.quietHours?.end?.message ?? errors.quietHours?.start?.message}
              </p>
            ) : null}
            <p className="text-sm text-muted-foreground">{QUIET_HOURS_NOTE}</p>
          </fieldset>

          <div>
            <Button type="submit" disabled={!dirty || save.isPending}>
              {save.isPending ? 'Kaydediliyor…' : 'Tercihleri kaydet'}
            </Button>
          </div>
        </form>
      )}
    </section>
  )
}
