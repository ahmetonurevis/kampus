import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useFieldArray, useForm, useWatch } from 'react-hook-form'
import {
  useCreateTripPlan,
  useTripPlanOptions,
  useUpdateTripPlan,
  type TripPlanDetail,
} from '@kampus/react-shared/use-finance-trip-plans.ts'
import { PAID_ACTIVITY_KIND_LABELS } from '@kampus/school-core/lib/finance-paid-activities.ts'
import { dateLabel, dayKey } from '@kampus/school-core/lib/format.ts'
import {
  TRIP_CONTACTS_MAX,
  TRIP_RISKS_MAX,
  TRIP_STAFF_MAX,
  TRIP_STAFF_ROLE_LABELS,
  TRIP_STAFF_ROLES,
  TRIP_STOPS_MAX,
  TRIP_TRANSPORT_TYPE_LABELS,
  TRIP_TRANSPORT_TYPES,
  tripStaffRatioMessage,
} from '@kampus/school-core/lib/finance-trip-plans.ts'
import { FileUploadField, type FileUploadItem } from '@/components/FileUploadField.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import {
  tripPlanBody,
  tripPlanChanges,
  tripPlanDefaults,
  tripPlanFormField,
  tripPlanFormSchema,
  type TripPlanFormValues,
} from './finance-trip-plan-forms.ts'

const FORM_ID = 'gezi-plani-formu'
const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })

type ArrayError = { message?: string | undefined } | undefined
const rootMessage = (error: unknown) =>
  (error as { root?: ArrayError; message?: string } | undefined)?.root?.message ??
  (error as { message?: string } | undefined)?.message

/**
 * Gezi planı taslağı ve düzeltmesi (DOM-FIN-111, K-366): ad, amaç, gün ve saatler, öğrenci sayısı,
 * güzergâh, görevliler, ulaşım (belge dosyasıyla), risk değerlendirmesi, acil iletişim ve isteğe
 * bağlı ücretli etkinlik. Görevli oranı yalnız uyarıdır. Onaylanmış ya da onay bekleyen plan
 * düzeltilince taslağa döner (K-367); form bunu önceden söyler.
 */
export function TripPlanFormModal({
  plan,
  onClose,
  onSaved,
}: {
  plan?: TripPlanDetail
  onClose: () => void
  onSaved: (id: string) => void
}) {
  const create = useCreateTripPlan()
  const update = useUpdateTripPlan()
  const options = useTripPlanOptions()
  const form = useForm<TripPlanFormValues>({
    resolver: zodResolver(tripPlanFormSchema),
    defaultValues: tripPlanDefaults(dayKey(), plan),
  })
  const stops = useFieldArray({ control: form.control, name: 'stops' })
  const staff = useFieldArray({ control: form.control, name: 'staff' })
  const risks = useFieldArray({ control: form.control, name: 'risks' })
  const contacts = useFieldArray({ control: form.control, name: 'contacts' })
  const [files, setFiles] = useState<readonly FileUploadItem[]>(
    plan?.transport.documentFile
      ? [{ id: plan.transport.documentFile.id, name: plan.transport.documentFile.name }]
      : [],
  )
  const [uploading, setUploading] = useState(false)
  const [scanBlocked, setScanBlocked] = useState(false)
  const saving = create.isPending || update.isPending || form.formState.isSubmitting
  const busy = saving || uploading
  const errors = form.formState.errors
  const watchedCount = useWatch({ control: form.control, name: 'expectedStudentCount' })
  const watchedStaff = useWatch({ control: form.control, name: 'staff' })
  const count = Number(watchedCount)
  const ratio =
    Number.isInteger(count) && count > 0 ? tripStaffRatioMessage(count, watchedStaff.length) : null
  const fileId = files[0]?.id ?? null
  const fields = {
    setError: (name: string, error: { type: string; message: string }) => {
      const field = tripPlanFormField(name)
      if (field) form.setError(field as keyof TripPlanFormValues, error, { shouldFocus: true })
      else form.setError('root.server', error)
    },
  }
  const onSubmit = form.handleSubmit(async (values) => {
    if (plan) {
      const body = tripPlanChanges(values, fileId, plan)
      if (Object.keys(body).length === 0) {
        onClose()
        return
      }
      const outcome = await update.submit({ planId: plan.id, version: plan.version, body }, fields)
      if (outcome.status === 'success') {
        notify.success(
          outcome.data.data.status === 'draft' && plan.status !== 'draft'
            ? 'Plan güncellendi; yeniden onaya gönderilmesi gerekiyor.'
            : 'Plan güncellendi.',
        )
        onSaved(plan.id)
      } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onClose()
      return
    }
    const outcome = await create.submit(tripPlanBody(values, fileId), fields)
    if (outcome.status === 'success') {
      notify.success(`${outcome.data.data.number} numaralı gezi planı taslak olarak açıldı.`)
      onSaved(outcome.data.data.id)
    }
  })
  const title = plan ? `${plan.number} planını düzenle` : 'Yeni gezi planı'
  const activities = options.data?.data.activities ?? []
  const teacherOptions = options.data?.data.staff ?? []
  return (
    <Modal
      open
      size="wide"
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={title}
      description={
        plan && plan.status !== 'draft'
          ? 'Bu plan düzeltilince taslağa döner; onay ve bildirim işareti düşer, yeniden onaya gönderilir.'
          : 'Plan taslak olarak kaydedilir; onay için okul müdürüne gönderilir.'
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Vazgeç
          </Button>
          <Button
            type="submit"
            form={FORM_ID}
            disabled={busy || scanBlocked}
            aria-busy={saving || undefined}
          >
            Kaydet
          </Button>
        </>
      }
    >
      <form
        id={FORM_ID}
        noValidate
        aria-label={title}
        onSubmit={(event) => void onSubmit(event)}
        className="grid grid-cols-2 gap-4 max-[650px]:grid-cols-1"
      >
        <div className="col-span-full">
          <FormField id="gezi-ad" label="Gezinin adı" error={errors.name}>
            {(control) => <Input {...control} {...form.register('name')} disabled={saving} />}
          </FormField>
        </div>
        <div className="col-span-full">
          <FormField
            id="gezi-amac"
            label="Amaç ve kazanım"
            error={errors.purpose}
            description="Gezinin hangi ders ya da kazanımla ilişkili olduğunu yazın."
          >
            {(control) => (
              <Textarea {...control} {...form.register('purpose')} rows={3} disabled={saving} />
            )}
          </FormField>
        </div>
        <FormField id="gezi-cikis" label="Çıkış (gün ve saat)" error={errors.departureAt}>
          {(control) => (
            <Input
              {...control}
              type="datetime-local"
              {...form.register('departureAt')}
              disabled={saving}
            />
          )}
        </FormField>
        <FormField id="gezi-donus" label="Dönüş (gün ve saat)" error={errors.returnAt}>
          {(control) => (
            <Input
              {...control}
              type="datetime-local"
              {...form.register('returnAt')}
              disabled={saving}
            />
          )}
        </FormField>
        <FormField
          id="gezi-ogrenci"
          label="Beklenen öğrenci sayısı"
          error={errors.expectedStudentCount}
        >
          {(control) => (
            <Input
              {...control}
              inputMode="numeric"
              {...form.register('expectedStudentCount')}
              disabled={saving}
            />
          )}
        </FormField>
        <FormField
          id="gezi-etkinlik"
          label="Ücretli etkinlik (isteğe bağlı)"
          error={errors.paidActivityId}
          description="Ücret alınan gezide katılım ücretinin etkinliği; ücretsiz gezide boş bırakın."
        >
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('paidActivityId')}
              className="w-full"
              disabled={saving}
            >
              <NativeSelectOption value="">Ücretsiz gezi</NativeSelectOption>
              {plan?.paidActivity &&
              !activities.some((activity) => activity.id === plan.paidActivity?.id) ? (
                <NativeSelectOption value={plan.paidActivity.id}>
                  {plan.paidActivity.name}
                </NativeSelectOption>
              ) : null}
              {activities.map((activity) => (
                <NativeSelectOption
                  key={activity.id}
                  value={activity.id}
                  disabled={activity.linkedPlanId !== null && activity.linkedPlanId !== plan?.id}
                >
                  {`${activity.name} · ${PAID_ACTIVITY_KIND_LABELS[activity.kind]} · ${dayText(activity.activityDate)}`}
                  {activity.linkedPlanId !== null && activity.linkedPlanId !== plan?.id
                    ? ' (başka plana bağlı)'
                    : ''}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>

        <fieldset className="col-span-full grid gap-3 border-t pt-4">
          <legend className="text-sm font-semibold">Güzergâh</legend>
          {stops.fields.map((field, index) => (
            <div
              key={field.id}
              className="grid grid-cols-[1fr_1.4fr_auto] items-start gap-2 max-[650px]:grid-cols-1"
            >
              <FormField
                id={`gezi-durak-${String(index)}`}
                label={`${String(index + 1)}. durak`}
                error={errors.stops?.[index]?.place}
              >
                {(control) => (
                  <Input
                    {...control}
                    {...form.register(`stops.${index}.place`)}
                    disabled={saving}
                  />
                )}
              </FormField>
              <FormField
                id={`gezi-durak-not-${String(index)}`}
                label="Not (isteğe bağlı)"
                error={errors.stops?.[index]?.note}
              >
                {(control) => (
                  <Input {...control} {...form.register(`stops.${index}.note`)} disabled={saving} />
                )}
              </FormField>
              <Button
                type="button"
                variant="ghost"
                className="mt-6 max-[650px]:mt-0"
                aria-label={`${String(index + 1)}. durağı kaldır`}
                disabled={saving || stops.fields.length === 1}
                onClick={() => stops.remove(index)}
              >
                <Icon name="Trash2" size={16} aria-hidden="true" />
              </Button>
            </div>
          ))}
          <RootError message={rootMessage(errors.stops)} />
          <div>
            <Button
              type="button"
              variant="secondary"
              disabled={saving || stops.fields.length >= TRIP_STOPS_MAX}
              onClick={() => stops.append({ place: '', note: '' })}
            >
              Durak ekle
            </Button>
          </div>
        </fieldset>

        <fieldset className="col-span-full grid gap-3 border-t pt-4">
          <legend className="text-sm font-semibold">Görevli öğretmenler</legend>
          {staff.fields.map((field, index) => (
            <div
              key={field.id}
              className="grid grid-cols-[1.4fr_1fr_auto] items-start gap-2 max-[650px]:grid-cols-1"
            >
              <FormField
                id={`gezi-gorevli-${String(index)}`}
                label={`${String(index + 1)}. görevli`}
                error={errors.staff?.[index]?.membershipId}
              >
                {(control) => (
                  <NativeSelect
                    {...control}
                    {...form.register(`staff.${index}.membershipId`)}
                    className="w-full"
                    disabled={saving}
                  >
                    <NativeSelectOption value="">
                      {options.isPending ? 'Öğretmenler yükleniyor…' : 'Öğretmen seçin'}
                    </NativeSelectOption>
                    {plan?.staff
                      .filter(
                        (member) =>
                          !teacherOptions.some(
                            (option) => option.membershipId === member.membershipId,
                          ),
                      )
                      .map((member) => (
                        <NativeSelectOption key={member.membershipId} value={member.membershipId}>
                          {member.name ?? 'Görevli'}
                        </NativeSelectOption>
                      ))}
                    {teacherOptions.map((option) => (
                      <NativeSelectOption key={option.membershipId} value={option.membershipId}>
                        {option.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                )}
              </FormField>
              <FormField
                id={`gezi-gorev-${String(index)}`}
                label="Görev"
                error={errors.staff?.[index]?.role}
              >
                {(control) => (
                  <NativeSelect
                    {...control}
                    {...form.register(`staff.${index}.role`)}
                    className="w-full"
                    disabled={saving}
                  >
                    {TRIP_STAFF_ROLES.map((value) => (
                      <NativeSelectOption key={value} value={value}>
                        {TRIP_STAFF_ROLE_LABELS[value]}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                )}
              </FormField>
              <Button
                type="button"
                variant="ghost"
                className="mt-6 max-[650px]:mt-0"
                aria-label={`${String(index + 1)}. görevliyi kaldır`}
                disabled={saving || staff.fields.length === 1}
                onClick={() => staff.remove(index)}
              >
                <Icon name="Trash2" size={16} aria-hidden="true" />
              </Button>
            </div>
          ))}
          <RootError message={rootMessage(errors.staff)} />
          {ratio ? (
            <p role="status" className="text-sm text-muted-foreground">
              {ratio}
            </p>
          ) : null}
          <div>
            <Button
              type="button"
              variant="secondary"
              disabled={saving || staff.fields.length >= TRIP_STAFF_MAX}
              onClick={() => staff.append({ membershipId: '', role: 'assistant' })}
            >
              Görevli ekle
            </Button>
          </div>
        </fieldset>

        <fieldset className="col-span-full grid grid-cols-2 gap-4 border-t pt-4 max-[650px]:grid-cols-1">
          <legend className="text-sm font-semibold">Ulaşım</legend>
          <FormField id="gezi-arac" label="Araç türü" error={errors.transportType}>
            {(control) => (
              <NativeSelect
                {...control}
                {...form.register('transportType')}
                className="w-full"
                disabled={saving}
              >
                {TRIP_TRANSPORT_TYPES.map((value) => (
                  <NativeSelectOption key={value} value={value}>
                    {TRIP_TRANSPORT_TYPE_LABELS[value]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <FormField id="gezi-firma" label="Firma (isteğe bağlı)" error={errors.company}>
            {(control) => <Input {...control} {...form.register('company')} disabled={saving} />}
          </FormField>
          <FormField
            id="gezi-plaka"
            label="Plaka (isteğe bağlı)"
            error={errors.plate}
            description="Otobüs ve minibüste onaya göndermeden önce firma, plaka ve sürücü gerekir."
          >
            {(control) => (
              <Input
                {...control}
                {...form.register('plate')}
                autoCapitalize="characters"
                disabled={saving}
              />
            )}
          </FormField>
          <FormField id="gezi-surucu" label="Sürücü (isteğe bağlı)" error={errors.driverName}>
            {(control) => <Input {...control} {...form.register('driverName')} disabled={saving} />}
          </FormField>
          <FormField
            id="gezi-surucu-tel"
            label="Sürücü telefonu (isteğe bağlı)"
            error={errors.driverPhone}
          >
            {(control) => (
              <Input
                {...control}
                type="tel"
                inputMode="tel"
                {...form.register('driverPhone')}
                disabled={saving}
              />
            )}
          </FormField>
          <div className="col-span-full">
            <FileUploadField
              id="gezi-belge"
              label="Ulaşım belgesi (isteğe bağlı)"
              purpose="document"
              description="Araç ruhsatı, taşıma sözleşmesi ya da sigorta poliçesi; PDF, en çok 20 MB."
              listLabel="Ulaşım belgesi"
              items={files}
              disabled={saving}
              onUploaded={(item) => setFiles([item])}
              onRemoved={() => setFiles([])}
              onBusyChange={setUploading}
              onBlockedChange={setScanBlocked}
            />
          </div>
        </fieldset>

        <fieldset className="col-span-full grid gap-3 border-t pt-4">
          <legend className="text-sm font-semibold">Risk değerlendirmesi</legend>
          {risks.fields.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Onaya göndermeden önce en az bir risk ve önlemi ekleyin.
            </p>
          ) : null}
          {risks.fields.map((field, index) => (
            <div
              key={field.id}
              className="grid grid-cols-[1fr_1.4fr_auto] items-start gap-2 max-[650px]:grid-cols-1"
            >
              <FormField
                id={`gezi-risk-${String(index)}`}
                label={`${String(index + 1)}. risk`}
                error={errors.risks?.[index]?.risk}
              >
                {(control) => (
                  <Input {...control} {...form.register(`risks.${index}.risk`)} disabled={saving} />
                )}
              </FormField>
              <FormField
                id={`gezi-onlem-${String(index)}`}
                label="Önlem"
                error={errors.risks?.[index]?.measure}
              >
                {(control) => (
                  <Input
                    {...control}
                    {...form.register(`risks.${index}.measure`)}
                    disabled={saving}
                  />
                )}
              </FormField>
              <Button
                type="button"
                variant="ghost"
                className="mt-6 max-[650px]:mt-0"
                aria-label={`${String(index + 1)}. riski kaldır`}
                disabled={saving}
                onClick={() => risks.remove(index)}
              >
                <Icon name="Trash2" size={16} aria-hidden="true" />
              </Button>
            </div>
          ))}
          <RootError message={rootMessage(errors.risks)} />
          <div>
            <Button
              type="button"
              variant="secondary"
              disabled={saving || risks.fields.length >= TRIP_RISKS_MAX}
              onClick={() => risks.append({ risk: '', measure: '' })}
            >
              Risk ekle
            </Button>
          </div>
        </fieldset>

        <fieldset className="col-span-full grid gap-3 border-t pt-4">
          <legend className="text-sm font-semibold">Acil iletişim</legend>
          {contacts.fields.map((field, index) => (
            <div
              key={field.id}
              className="grid grid-cols-[1.2fr_1fr_1fr_auto] items-start gap-2 max-[650px]:grid-cols-1"
            >
              <FormField
                id={`gezi-acil-ad-${String(index)}`}
                label={`${String(index + 1)}. kişi`}
                error={errors.contacts?.[index]?.name}
              >
                {(control) => (
                  <Input
                    {...control}
                    {...form.register(`contacts.${index}.name`)}
                    disabled={saving}
                  />
                )}
              </FormField>
              <FormField
                id={`gezi-acil-tel-${String(index)}`}
                label="Telefon"
                error={errors.contacts?.[index]?.phone}
              >
                {(control) => (
                  <Input
                    {...control}
                    type="tel"
                    inputMode="tel"
                    {...form.register(`contacts.${index}.phone`)}
                    disabled={saving}
                  />
                )}
              </FormField>
              <FormField
                id={`gezi-acil-gorev-${String(index)}`}
                label="Görevi (isteğe bağlı)"
                error={errors.contacts?.[index]?.relation}
              >
                {(control) => (
                  <Input
                    {...control}
                    {...form.register(`contacts.${index}.relation`)}
                    disabled={saving}
                  />
                )}
              </FormField>
              <Button
                type="button"
                variant="ghost"
                className="mt-6 max-[650px]:mt-0"
                aria-label={`${String(index + 1)}. kişiyi kaldır`}
                disabled={saving}
                onClick={() => contacts.remove(index)}
              >
                <Icon name="Trash2" size={16} aria-hidden="true" />
              </Button>
            </div>
          ))}
          <RootError message={rootMessage(errors.contacts)} />
          <div>
            <Button
              type="button"
              variant="secondary"
              disabled={saving || contacts.fields.length >= TRIP_CONTACTS_MAX}
              onClick={() => contacts.append({ name: '', phone: '', relation: '' })}
            >
              Kişi ekle
            </Button>
          </div>
        </fieldset>
        <div className="col-span-full empty:hidden">
          <RootError message={errors.root?.server?.message} />
        </div>
      </form>
    </Modal>
  )
}
