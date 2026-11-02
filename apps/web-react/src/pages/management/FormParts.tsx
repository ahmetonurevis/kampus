// Kampüs, sınıf ve kadro formlarının ortak parçaları: sürüm çakışması uyarısı, eylem düğmeleri
// ve gönderim hatasını alana bağlayan yardımcılar.
import { useEffect, useRef, useState } from 'react'
import type { FieldValues, Path, UseFormReturn } from 'react-hook-form'
import { isApiError, type ApiError } from '@kampus/api-client/errors.ts'
import { RECORD_CHANGED_MESSAGE } from '@kampus/react-shared/use-management-commands.ts'
import { Icon } from '@/components/Icon.tsx'
import { Button } from '@/components/ui/button'

export type Reloaded<TValues> = { version: number; values: TValues } | null

/**
 * Düzenleme formunun sürüm durumu. `If-Match` formun açıldığı (ya da yenilendiği) andaki
 * sürümdür; çakışmadan sonra kullanıcı güncel kaydı yükleyene kadar kayıt gönderilmez, böylece
 * başkasının değişikliği sessizce ezilmez.
 */
export function useEditConflict<TValues>({
  initialVersion,
  reload,
  apply,
}: {
  initialVersion: number
  /** Güncel kaydı çeker; kayıt artık okunamıyorsa `null`. */
  reload: () => Promise<Reloaded<TValues>>
  /** Formu güncel değerlerle yeniden doldurur. */
  apply: (values: TValues) => void
}) {
  const [version, setVersion] = useState(initialVersion)
  const [conflicted, setConflicted] = useState(false)
  const [reloading, setReloading] = useState(false)

  async function reloadRecord() {
    setReloading(true)
    try {
      const fresh = await reload()
      if (!fresh) return
      apply(fresh.values)
      setVersion(fresh.version)
      setConflicted(false)
    } finally {
      setReloading(false)
    }
  }
  return { version, conflicted, reloading, markConflict: () => setConflicted(true), reloadRecord }
}

/** 409 `version_conflict`: başka biri kaydı değiştirdi. */
export const isVersionConflict = (error: unknown) =>
  isApiError(error) && error.status === 409 && error.code === 'version_conflict'

/**
 * Hata tek yerde görünür (`routeCommandErrors`): alana bağlanan hata yalnız alanın altında,
 * sürüm çakışması yalnız form içi uyarıda, geri kalanı yalnız toast'ta. `byPath`: çekirdek kuralı
 * hata yolunu taşıyorsa (`subjectTeachers.<ders>`) alan o yoldur.
 */
export function errorRoutes(fields: Readonly<Record<string, string>>, byPath = false) {
  return {
    fieldFor: (error: ApiError): string | undefined =>
      fields[error.code] ??
      (byPath ? error.issues.find((issue) => issue.path.length > 0)?.path.join('.') : undefined),
    silent: isVersionConflict,
  }
}

/**
 * Sunucu reddinden sonra odağı hatalı alana verir. Gönderim sürerken alanlar kilitlidir (`disabled`)
 * ve kilitli alan odak almaz; bu yüzden hata alanı tutulur, gönderim bitip alanlar açılınca
 * (`busy` false) odak verilir. Dönen işlev `fieldFor` sonucunu alır; alan yoksa hiçbir şey yapmaz.
 */
export function useFocusAfterSubmit<TValues extends FieldValues>(
  form: Pick<UseFormReturn<TValues>, 'setFocus'>,
  busy: boolean,
) {
  const [request, setRequest] = useState<{ field: string } | null>(null)
  const served = useRef<object | null>(null)
  useEffect(() => {
    if (request === null || busy || served.current === request) return
    served.current = request
    form.setFocus(request.field as Path<TValues>)
  }, [request, busy, form])
  return (next: string | undefined) => {
    if (next) setRequest({ field: next })
  }
}

/** Çakışma bildirimi ve "Güncel kaydı yükle" seçeneği (sessiz üzerine yazma yok). */
export function ConflictNotice({
  onReload,
  reloading,
}: {
  onReload: () => void
  reloading: boolean
}) {
  return (
    <div role="alert" className="grid gap-3 rounded-card border bg-warning-soft p-4">
      <p className="text-sm font-medium">{RECORD_CHANGED_MESSAGE}</p>
      <div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onReload}
          disabled={reloading}
          aria-busy={reloading || undefined}
        >
          <Icon name="RefreshCw" size={15} aria-hidden="true" />
          Güncel kaydı yükle
        </Button>
      </div>
    </div>
  )
}

/** Form altı: ikincil "Vazgeç" ve ana "Kaydet" (gönderim sürerken kilitli). */
export function FormActions({
  busy,
  disabled = false,
  onCancel,
  submitLabel = 'Kaydet',
  icon = 'Check',
}: {
  busy: boolean
  disabled?: boolean
  onCancel: () => void
  submitLabel?: string
  icon?: 'Check' | 'ArrowRight'
}) {
  return (
    <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
      <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
        Vazgeç
      </Button>
      <Button type="submit" disabled={busy || disabled} aria-busy={busy || undefined}>
        <Icon name={icon} size={17} aria-hidden="true" />
        {submitLabel}
      </Button>
    </div>
  )
}

/** Form düzeyi (alana bağlanamayan) sunucu hatası. */
export function RootError({ message }: { message: string | undefined }) {
  return message ? (
    <p role="alert" className="text-sm text-danger">
      {message}
    </p>
  ) : null
}
