import { zodResolver } from '@hookform/resolvers/zod'
import { useCallback, useState, type ReactNode } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import {
  HEALTH_ACCESS_REASON_CODES,
  HEALTH_ACCESS_REASON_LABELS,
  type HealthAccessReason,
} from '@kampus/school-core/lib/finance-health-access.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { FormField } from '@/components/FormField.tsx'
import { Modal } from '@/components/Modal.tsx'
import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import {
  HEALTH_NOTE_HINT,
  healthAccessScope,
  healthReasonDefaults,
  healthReasonFormSchema,
  recallHealthReason,
  rememberHealthReason,
  type HealthReasonFormValues,
} from './finance-health-access.ts'

/**
 * Sağlık verisi erişim gerekçesi (DOM-FIN-156; ON-164; K-523…K-525). Sağlık ayrıntısı açan ekran
 * `HealthAccessGate` ile sarılır: gerekçe yoksa diyalog (`FinanceHealthAccessReasonDialog`) sorar,
 * seçilen gerekçe aynı kapsam (kayıt ya da görünüm) için 15 dakika bellekte kalır (K-525). Gerekçe
 * kancaya verilir; sunucu her okumayı gerekçesiyle kaydeder.
 */

function useScopeKey(scope: string) {
  const { session } = useAuth()
  return healthAccessScope(session?.institution.id ?? null, session?.membershipId ?? null, scope)
}

/** Kapsamın geçerli gerekçesi; kapsam değişirse bileşen `key` ile yeniden kurulmalıdır. */
export function useHealthAccessReason(scope: string) {
  const key = useScopeKey(scope)
  const [reason, setReason] = useState(() => recallHealthReason(key, Date.now()))
  const choose = useCallback(
    (next: HealthAccessReason) => {
      rememberHealthReason(key, next, Date.now())
      setReason(next)
    },
    [key],
  )
  return { reason, choose }
}

/**
 * Kullanıcının amacı eylemden belli olduğunda (yeni tutanak ya da ziyaret açan kişi) gerekçe
 * önceden kaydedilir; ayrıntı açılınca yeniden sorulmaz (K-525).
 */
export function useRememberHealthReason() {
  const { session } = useAuth()
  const institutionId = session?.institution.id ?? null
  const membershipId = session?.membershipId ?? null
  return useCallback(
    (scope: string, reason: HealthAccessReason) =>
      rememberHealthReason(
        healthAccessScope(institutionId, membershipId, scope),
        reason,
        Date.now(),
      ),
    [institutionId, membershipId],
  )
}

export function FinanceHealthAccessReasonDialog({
  open,
  onOpenChange,
  subject,
  suggested,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Açılan bilgi (ör. "kaza tutanağının sağlık bilgisi"). */
  subject: string
  /** Ekranın amacından belli önerilen gerekçe; diyalogda ön seçilidir. */
  suggested?: HealthAccessReason | undefined
  onConfirm: (reason: HealthAccessReason) => void
}) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Sağlık bilgisine erişim gerekçesi"
      description={`Sağlık bilgisi özel niteliklidir. ${subject} açılışı gerekçesiyle kayda geçer; seçtiğiniz gerekçe 15 dakika geçerli kalır.`}
    >
      {open ? (
        <ReasonForm
          suggested={suggested}
          onCancel={() => onOpenChange(false)}
          onConfirm={onConfirm}
        />
      ) : null}
    </Modal>
  )
}

function ReasonForm({
  suggested,
  onCancel,
  onConfirm,
}: {
  suggested: HealthAccessReason | undefined
  onCancel: () => void
  onConfirm: (reason: HealthAccessReason) => void
}) {
  const form = useForm<HealthReasonFormValues, unknown, HealthAccessReason>({
    resolver: zodResolver(healthReasonFormSchema),
    defaultValues: healthReasonDefaults(suggested),
  })
  const code = useWatch({ control: form.control, name: 'code' })
  const errors = form.formState.errors
  const onSubmit = form.handleSubmit((reason) => onConfirm(reason))
  return (
    <form
      noValidate
      aria-label="Erişim gerekçesi"
      className="grid gap-4"
      onSubmit={(event) => void onSubmit(event)}
    >
      <FormField id="saglik-erisim-gerekce" label="Erişim gerekçesi" error={errors.code}>
        {(control) => (
          <NativeSelect {...control} {...form.register('code')} className="w-full">
            <NativeSelectOption value="">Seçin</NativeSelectOption>
            {HEALTH_ACCESS_REASON_CODES.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {HEALTH_ACCESS_REASON_LABELS[value]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      {code === 'other' ? (
        <FormField
          id="saglik-erisim-aciklama"
          label="Açıklama"
          description={HEALTH_NOTE_HINT}
          error={errors.note}
        >
          {(control) => <Textarea {...control} {...form.register('note')} rows={3} />}
        </FormField>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" className="min-h-11">
          Bilgiyi aç
        </Button>
        <Button type="button" variant="outline" className="min-h-11" onClick={onCancel}>
          Vazgeç
        </Button>
      </div>
    </form>
  )
}

/**
 * Gerekçe istemi: kısa açıklama, "Gerekçe seç" düğmesi ve diyalog. `askOnOpen`: kayıt ayrıntısında
 * diyalog hemen açılır; görünümde (liste) kullanıcı düğmeyle açar.
 */
export function HealthAccessPrompt({
  subject,
  askOnOpen,
  suggested,
  onConfirm,
}: {
  subject: string
  askOnOpen: boolean
  suggested?: HealthAccessReason | undefined
  onConfirm: (reason: HealthAccessReason) => void
}) {
  const [asking, setAsking] = useState(askOnOpen)
  return (
    <div className="grid gap-3 rounded-card border p-4">
      <p className="text-sm text-muted-foreground">
        {`${subject} sağlık bilgisi içerir. Görmek için erişim gerekçesini seçin; açılış kayda geçer.`}
      </p>
      <Button
        variant="outline"
        className="min-h-11 justify-self-start"
        onClick={() => setAsking(true)}
      >
        Gerekçe seç
      </Button>
      <FinanceHealthAccessReasonDialog
        open={asking}
        onOpenChange={setAsking}
        subject={subject}
        suggested={suggested}
        onConfirm={(next) => {
          setAsking(false)
          onConfirm(next)
        }}
      />
    </div>
  )
}

/** Gerekçe kapısı: gerekçe varsa içeriği gerekçeyle çizer, yoksa `HealthAccessPrompt`. */
export function HealthAccessGate({
  scope,
  subject,
  askOnOpen,
  suggested,
  children,
}: {
  scope: string
  subject: string
  askOnOpen: boolean
  /** Önerilen gerekçe (diyalogda ön seçili; kullanıcı onaylar). */
  suggested?: HealthAccessReason | undefined
  children: (reason: HealthAccessReason) => ReactNode
}) {
  const { reason, choose } = useHealthAccessReason(scope)
  if (reason !== null) return children(reason)
  return (
    <HealthAccessPrompt
      subject={subject}
      askOnOpen={askOnOpen}
      suggested={suggested}
      onConfirm={choose}
    />
  )
}
