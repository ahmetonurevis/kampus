import { useEffect, useRef, useState } from 'react'
import { Controller, useFieldArray, useWatch } from 'react-hook-form'
import { useResourceList } from '@kampus/react-shared/use-resources.ts'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { notify } from '@/lib/notify.ts'
import { fieldError, type DraftForm } from './ContentDraftFields.tsx'
import { LinkedContentPicker } from './LinkedContentPicker.tsx'
import { ListeningRecordingField } from './ListeningRecordingField.tsx'
import { glossaryFocusAfterRemove } from './content-pool-model.ts'
import {
  appendItems,
  ITEM_POINTS,
  itemPointsId,
  ITEMS_MAX,
  LINKED_DETAIL_LOADING,
  LINKED_DETAIL_UNKNOWN,
  moveTarget,
  overflowMessage,
  questionSelection,
  summariesFrom,
  type LinkedHints,
  type LinkedKind,
  type LinkedSummary,
} from './reading-activity-model.ts'

type Props = {
  form: DraftForm
  busy: boolean
  languageSchool: boolean
  /** Kayıtlı sürümün bağlı içerik uyarıları (sunucunun yayım sorunları). */
  hints?: LinkedHints
}

const NO_HINTS: LinkedHints = { passage: null, listening: null, items: new Map() }
/** Düzenlemede kayıtlı bağların özetleri için okunan liste boyu (sunucu sınırı). */
const LOOKUP_PAGE_SIZE = 100

/**
 * Kayıtlı bağların gösterim özetleri: türün ilk sayfası (başlığa göre) okunur, sürüm kimliği
 * eşlenir. Seçicide seçilenler kendi özetiyle gelir; listede bulunmayan kimlik (eski sürüm ya da ilk
 * sayfanın dışında kalan kaynak) tarafsız metinle görünür. TODO(okuma-etkinligi-ozet): sürüm
 * kimliğiyle özet okuyan uç gelince bu tarama kalkar; eski sürüme bağlı sorunun kaynağı da bilinir.
 */
function useLinkedLookup(kind: LinkedKind, enabled: boolean) {
  const list = useResourceList(
    { page: 1, pageSize: LOOKUP_PAGE_SIZE, contentType: kind, sort: 'title' },
    { enabled },
  )
  return { map: summariesFrom(list.data?.data ?? []), loading: enabled && list.isPending }
}

/**
 * Quiz ve alıştırma seti içeriği (OG-984, OG-052; IST-042, IST-045, DOM-BEC-005, DOM-BEC-006,
 * DOM-KYN-013): bağlı okuma parçası (isteğe bağlı; seçilince set okuma-anlama etkinliği olur), bağlı
 * dinleme kaydı (isteğe bağlı; `ListeningRecordingField`), sıralı soru listesi ve süre/karıştırma
 * ayarı. Parça ve sorular bağlı içerik seçicisiyle (`LinkedContentPicker`) yayındaki sürümden
 * seçilir; sıra düğmelerle değişir (sürükle-bırak yok), satırda alt beceri etiketi görünür.
 */
export function ItemSetFields({ form, busy, languageSchool, hints = NO_HINTS }: Props) {
  const items = useFieldArray({ control: form.control, name: 'content.items' })
  const watchedItems = useWatch({ control: form.control, name: 'content.items' }) ?? []
  const passageVersionId = useWatch({ control: form.control, name: 'content.passageVersionId' })
  // Tür kapanışta korunur: pencere kapanırken başlığı değişmesin.
  const [pickerKind, setPickerKind] = useState<LinkedKind>('question')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [picked, setPicked] = useState<ReadonlyMap<string, LinkedSummary>>(() => new Map())
  const addButton = useRef<HTMLButtonElement>(null)
  const pendingFocus = useRef<string | null>(null)

  const itemIds = watchedItems.map((item) => item.questionVersionId)
  const unresolved = (ids: readonly string[]) => ids.some((id) => id !== '' && !picked.has(id))
  const passages = useLinkedLookup(
    'reading_passage',
    passageVersionId != null && unresolved([passageVersionId]),
  )
  const questions = useLinkedLookup('question', unresolved(itemIds))
  const summaryOf = (id: string) => picked.get(id) ?? passages.map.get(id) ?? questions.map.get(id)
  const unknownText = (kind: LinkedKind, loading: boolean) =>
    loading ? LINKED_DETAIL_LOADING : LINKED_DETAIL_UNKNOWN[kind]

  // Satır taşınınca ya da silinince odak düşmesin (WCAG 2.4.3): çizimden sonra hedefe taşınır.
  useEffect(() => {
    const target = pendingFocus.current
    if (!target) return
    pendingFocus.current = null
    if (target === 'add') addButton.current?.focus()
    else document.getElementById(target)?.focus()
  }, [items.fields])

  function openPicker(kind: LinkedKind) {
    setPickerKind(kind)
    setPickerOpen(true)
  }

  function remember(list: readonly LinkedSummary[]) {
    setPicked((previous) => {
      const next = new Map(previous)
      for (const summary of list) next.set(summary.versionId, summary)
      return next
    })
  }

  function pickPassage([summary]: LinkedSummary[]) {
    if (!summary) return
    remember([summary])
    form.clearErrors('content.passageVersionId')
    form.setValue('content.passageVersionId', summary.versionId, { shouldDirty: true })
  }

  function pickQuestions(list: LinkedSummary[]) {
    remember(list)
    form.clearErrors('content.items')
    const next = appendItems(
      form.getValues('content.items') ?? [],
      list.map((summary) => summary.versionId),
    )
    if (next.added > 0) items.append(next.items.slice(next.items.length - next.added))
    const overflow = overflowMessage(next.overflow)
    if (overflow) notify.warning(overflow, 'icerik-soru-siniri')
  }

  function move(index: number, delta: -1 | 1) {
    const target = moveTarget(index, delta, items.fields.length)
    if (target === null) return
    // Sınıra varan satırda aynı yöndeki düğme kapanır; odak karşı yön düğmesine geçer.
    const edge = moveTarget(target, delta, items.fields.length) === null
    const direction = delta === -1 ? (edge ? 'asagi' : 'yukari') : edge ? 'yukari' : 'asagi'
    pendingFocus.current = `icerik-soru-${direction}-${target}`
    items.move(index, target)
  }

  function remove(index: number) {
    const next = glossaryFocusAfterRemove(index, items.fields.length)
    pendingFocus.current = next.kind === 'add' ? 'add' : itemPointsId(next.index)
    items.remove(index)
  }

  const passage = passageVersionId ? summaryOf(passageVersionId) : undefined
  const passageError = fieldError(form, 'content.passageVersionId')
  const passageHint =
    hints.passage && hints.passage.versionId === passageVersionId ? hints.passage.message : null
  const listError = fieldError(form, 'content.items')

  return (
    <div className="grid gap-6">
      <fieldset className="grid gap-3" aria-describedby="icerik-parca-ipucu">
        <legend className="mb-1 text-sm font-medium">Okuma parçası</legend>
        <p id="icerik-parca-ipucu" className="text-xs text-muted-foreground">
          Parça seçilirse set okuma-anlama etkinliği olur: öğrenci metni soruların yanında okur.
          Yalnız yayındaki parça bağlanır; parçanın yeni sürümü etkinliği değiştirmez.
        </p>
        {passageVersionId ? (
          <section
            aria-label="Seçili okuma parçası"
            className="flex flex-wrap items-center gap-3 rounded-card border bg-surface p-3"
          >
            <Icon name="BookOpen" size={18} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium [overflow-wrap:anywhere]">
                {passage?.title ?? 'Bağlı okuma parçası'}
              </p>
              <p className="text-xs text-muted-foreground">
                {passage
                  ? passage.note || passage.meta || 'Etiket yok'
                  : unknownText('reading_passage', passages.loading)}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                form.clearErrors('content.passageVersionId')
                form.setValue('content.passageVersionId', null, { shouldDirty: true })
              }}
              disabled={busy}
            >
              <Icon name="X" size={15} aria-hidden="true" />
              Parçayı kaldır
            </Button>
          </section>
        ) : (
          <p className="text-sm text-muted-foreground">Parça seçilmedi.</p>
        )}
        {passageError ? (
          <p id="icerik-parca-hata" role="alert" className="text-sm text-destructive">
            {passageError.message}
          </p>
        ) : passageHint ? (
          <p className="rounded-card bg-warning-soft px-3 py-2 text-sm">{passageHint}</p>
        ) : null}
        <div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => openPicker('reading_passage')}
            disabled={busy}
            aria-describedby={passageError ? 'icerik-parca-hata' : undefined}
          >
            <Icon name={passageVersionId ? 'RefreshCw' : 'Plus'} size={15} aria-hidden="true" />
            {passageVersionId ? 'Parçayı değiştir' : 'Okuma parçası seç'}
          </Button>
        </div>
      </fieldset>

      <ListeningRecordingField
        form={form}
        busy={busy}
        languageSchool={languageSchool}
        hint={hints.listening}
      />

      <fieldset className="grid gap-3" aria-describedby="icerik-sorular-ipucu">
        <legend className="mb-1 text-sm font-medium">Sorular</legend>
        <p id="icerik-sorular-ipucu" className="text-xs text-muted-foreground">
          Yayındaki soruları ekleyin ve sıralayın; okuma-anlama sorularında sonuç alt beceriye göre
          dökülür. En çok {ITEMS_MAX} soru.
        </p>
        {items.fields.length > 0 ? (
          <ol aria-label="Seçili sorular" className="grid gap-2">
            {items.fields.map((field, index) => {
              const id = watchedItems[index]?.questionVersionId ?? ''
              const summary = summaryOf(id)
              const position = index + 1
              const itemError = fieldError(form, `content.items.${index}.questionVersionId`)
              const hint = hints.items.get(id)
              return (
                <li
                  key={field.id}
                  className="grid gap-3 rounded-card border bg-surface p-3 sm:grid-cols-[1fr_auto]"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium [overflow-wrap:anywhere]">
                      {position}. {summary?.title ?? 'Soru'}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {!summary ? (
                        <span>{unknownText('question', questions.loading)}</span>
                      ) : summary.note ? (
                        <span>{summary.note}</span>
                      ) : (
                        <>
                          {summary.subskill ? (
                            <StatusBadge text={summary.subskill} tone="purple" />
                          ) : (
                            <span>Alt beceri yok</span>
                          )}
                          {summary.meta ? <span>{summary.meta}</span> : null}
                        </>
                      )}
                    </div>
                    {itemError ? (
                      <p role="alert" className="mt-2 text-sm text-destructive">
                        {itemError.message}
                      </p>
                    ) : hint ? (
                      <p className="mt-2 rounded-card bg-warning-soft px-3 py-2 text-sm">{hint}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="w-24">
                      <FormField
                        id={itemPointsId(index)}
                        label={`${position}. sorunun puanı`}
                        error={fieldError(form, `content.items.${index}.points`)}
                      >
                        {(control) => (
                          <Input
                            {...control}
                            {...form.register(`content.items.${index}.points`, {
                              valueAsNumber: true,
                            })}
                            type="number"
                            inputMode="numeric"
                            min={ITEM_POINTS.min}
                            max={ITEM_POINTS.max}
                            disabled={busy}
                          />
                        )}
                      </FormField>
                    </div>
                    <Button
                      id={`icerik-soru-yukari-${index}`}
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label={`${position}. soruyu yukarı taşı`}
                      onClick={() => move(index, -1)}
                      disabled={busy || index === 0}
                    >
                      <Icon name="ArrowUp" size={16} aria-hidden="true" />
                    </Button>
                    <Button
                      id={`icerik-soru-asagi-${index}`}
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label={`${position}. soruyu aşağı taşı`}
                      onClick={() => move(index, 1)}
                      disabled={busy || index === items.fields.length - 1}
                    >
                      <Icon name="ArrowDown" size={16} aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label={`${position}. soruyu çıkar`}
                      onClick={() => remove(index)}
                      disabled={busy}
                    >
                      <Icon name="Trash2" size={16} aria-hidden="true" />
                    </Button>
                  </div>
                </li>
              )
            })}
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground">Henüz soru eklenmedi.</p>
        )}
        {listError ? (
          <p role="alert" className="text-sm text-destructive">
            {listError.message}
          </p>
        ) : null}
        <div>
          <Button
            ref={addButton}
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => openPicker('question')}
            disabled={busy || items.fields.length >= ITEMS_MAX}
          >
            <Icon name="Plus" size={15} aria-hidden="true" />
            Soru ekle
          </Button>
        </div>
      </fieldset>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField
          id="icerik-sure"
          label="Süre sınırı (dakika, isteğe bağlı)"
          error={fieldError(form, 'content.timeLimitMinutes')}
        >
          {(control) => (
            <Input
              {...control}
              {...form.register('content.timeLimitMinutes', {
                setValueAs: (value: unknown) =>
                  value === '' || value == null ? null : Number(value),
              })}
              type="number"
              inputMode="numeric"
              min={1}
              max={300}
              disabled={busy}
            />
          )}
        </FormField>
        <Controller
          control={form.control}
          name="content.shuffleItems"
          render={({ field }) => (
            <Label htmlFor="icerik-karistir" className="items-center gap-2.5 self-end font-normal">
              <Checkbox
                id="icerik-karistir"
                checked={field.value === true}
                onCheckedChange={(checked) => field.onChange(checked === true)}
                disabled={busy}
              />
              <span className="text-sm">Soruların sırasını karıştır</span>
            </Label>
          )}
        />
      </div>

      <LinkedContentPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        kind={pickerKind}
        multiple={pickerKind === 'question'}
        selected={
          pickerKind === 'question'
            ? questionSelection(itemIds, summaryOf)
            : {
                versionIds: new Set(passageVersionId ? [passageVersionId] : []),
                resourceIds: new Set<string>(),
              }
        }
        languageSchool={languageSchool}
        onPick={pickerKind === 'question' ? pickQuestions : pickPassage}
      />
    </div>
  )
}
