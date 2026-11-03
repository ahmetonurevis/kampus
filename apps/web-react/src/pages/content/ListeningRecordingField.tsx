import { useState } from 'react'
import { useWatch } from 'react-hook-form'
import { useResourceList, useResourceVersion } from '@kampus/react-shared/use-resources.ts'
import { Icon } from '@/components/Icon.tsx'
import { Button } from '@/components/ui/button'
import { fieldError, type DraftForm } from './ContentDraftFields.tsx'
import { LinkedContentPicker } from './LinkedContentPicker.tsx'
import {
  LINKED_DETAIL_LOADING,
  LINKED_DETAIL_UNKNOWN,
  recordingFacts,
  recordingIssue,
  recordingLine,
  summariesFrom,
  type LinkedHints,
  type LinkedSummary,
} from './reading-activity-model.ts'

type Props = {
  form: DraftForm
  busy: boolean
  languageSchool: boolean
  /** Kayıtlı sürümün dinleme kaydı uyarısı (sunucunun yayım sorunu). */
  hint: LinkedHints['listening']
}

/** Düzenlemede kayıtlı kaydın kaynağını bulmak için okunan liste boyu (sunucu sınırı). */
const LOOKUP_PAGE_SIZE = 100
const ERROR_ID = 'icerik-dinleme-hata'

/**
 * Dinleme kaydı alanı (OG-052; IST-045, DOM-BEC-005): quiz/alıştırma seti yayındaki, birincil
 * becerisi dinleme olan ses sürümüne bağlanır; kayıt bağlı içerik seçicisiyle seçilir, değiştirilir
 * ya da kaldırılır. Okuma parçasıyla birlikte de bağlanabilir. Özet bağlanan sürümden okunur
 * (başlık, CEFR, döküm var/yok); dökümsüz kayıt seçilince sunucunun yayım iletisi hemen alanın
 * altına yazılır. Sunucu alan hatası (`listening_*`, yol `content.listeningVersionId`) önce gelir.
 * TODO(okuma-etkinligi-ozet): sürüm kimliğiyle özet okuyan uç gelince kayıtlı kaydın kaynağı liste
 * taramasıyla bulunmaz.
 */
export function ListeningRecordingField({ form, busy, languageSchool, hint }: Props) {
  const versionId = useWatch({ control: form.control, name: 'content.listeningVersionId' }) ?? null
  const [pickerOpen, setPickerOpen] = useState(false)
  const [picked, setPicked] = useState<LinkedSummary | null>(null)

  const known = picked !== null && picked.versionId === versionId ? picked : null
  // Kayıtlı bağın kaynağı: ses kayıtlarının ilk sayfası taranır (beceri süzgeci yok; becerisi
  // dinleme olmayan kayıtlı bağ da adıyla görünür, sorunu sunucu uyarısındadır).
  const lookup = useResourceList(
    { page: 1, pageSize: LOOKUP_PAGE_SIZE, contentType: 'audio', sort: 'title' },
    { enabled: versionId !== null && known === null },
  )
  const summary =
    known ?? (versionId ? summariesFrom(lookup.data?.data ?? []).get(versionId) : null)
  const version = useResourceVersion(summary?.resourceId ?? '', versionId ?? '')
  const data = version.data?.data
  const facts = data?.view === 'staff' ? recordingFacts(data.version) : null
  const loading =
    (versionId !== null && known === null && lookup.isPending) ||
    (summary != null && version.isPending)

  const error = fieldError(form, 'content.listeningVersionId')
  const selectionIssue = recordingIssue(facts)
  const savedHint = hint && hint.versionId === versionId ? hint.message : null

  function pick([chosen]: LinkedSummary[]) {
    if (!chosen) return
    setPicked(chosen)
    form.clearErrors('content.listeningVersionId')
    form.setValue('content.listeningVersionId', chosen.versionId, { shouldDirty: true })
  }

  function clear() {
    form.clearErrors('content.listeningVersionId')
    form.setValue('content.listeningVersionId', null, { shouldDirty: true })
  }

  const alert = error?.message ?? selectionIssue
  return (
    <fieldset className="grid gap-3" aria-describedby="icerik-dinleme-ipucu">
      <legend className="mb-1 text-sm font-medium">Dinleme kaydı</legend>
      <p id="icerik-dinleme-ipucu" className="text-xs text-muted-foreground">
        Kayıt seçilirse set dinleme etkinliği olur: öğrenci kaydı soruların yanında dinler. Yalnız
        yayındaki, dinleme becerili ve dökümlü ses kaydı bağlanır; kaydın yeni sürümü etkinliği
        değiştirmez.
      </p>
      {versionId ? (
        <section
          aria-label="Seçili dinleme kaydı"
          className="flex flex-wrap items-center gap-3 rounded-card border bg-surface p-3"
        >
          <Icon name="Music" size={18} aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium [overflow-wrap:anywhere]">
              {facts?.title ?? summary?.title ?? 'Bağlı dinleme kaydı'}
            </p>
            <p className="text-xs text-muted-foreground">
              {facts
                ? recordingLine(facts)
                : loading
                  ? LINKED_DETAIL_LOADING
                  : LINKED_DETAIL_UNKNOWN.audio}
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={clear} disabled={busy}>
            <Icon name="X" size={15} aria-hidden="true" />
            Kaydı kaldır
          </Button>
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">Dinleme kaydı seçilmedi.</p>
      )}
      {versionId && alert ? (
        <p id={ERROR_ID} role="alert" className="text-sm text-destructive">
          {alert}
        </p>
      ) : versionId && savedHint ? (
        <p className="rounded-card bg-warning-soft px-3 py-2 text-sm">{savedHint}</p>
      ) : null}
      <div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setPickerOpen(true)}
          disabled={busy}
          aria-describedby={versionId && alert ? ERROR_ID : undefined}
        >
          <Icon name={versionId ? 'RefreshCw' : 'Plus'} size={15} aria-hidden="true" />
          {versionId ? 'Kaydı değiştir' : 'Dinleme kaydı seç'}
        </Button>
      </div>

      <LinkedContentPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        kind="audio"
        multiple={false}
        selected={{
          versionIds: new Set(versionId ? [versionId] : []),
          resourceIds: new Set<string>(),
        }}
        languageSchool={languageSchool}
        onPick={pick}
      />
    </fieldset>
  )
}
