import { useState } from 'react'
import { View } from 'react-native'
import type { CollectionRow } from '@kampus/react-shared/collections.ts'
import {
  isOpenStage,
  stageBody,
  type ProspectRecord,
  type StageInput,
} from '@kampus/react-shared/prospect-model.ts'
import { useCollectionAll, useCollectionItem } from '@kampus/react-shared/use-collection.ts'
import {
  useAddProspectNote,
  useChangeProspectStage,
} from '@kampus/react-shared/use-prospect-commands.ts'
import {
  OPEN_PROSPECT_STAGES,
  PROSPECT_LOST_INSTITUTION_MAX,
  PROSPECT_NOTE_MAX_LENGTH,
  PROSPECT_NOTE_NOTICE,
  prospectStageLabel,
} from '@kampus/school-core/lib/prospects.ts'
import { Badge, Button, Field, Select, Sheet, T } from '../../ui/components.tsx'
import { DetailPair, Notice, Section } from '../../ui/SchoolLayout.tsx'
import { createFieldCollector, type FieldErrors } from '../command-failure.ts'
import {
  checkNote,
  LOST_REASON_OPTIONS,
  prospectFacts,
  prospectFailure,
  prospectHistory,
  prospectPlans,
  stageChoices,
  stageTone,
} from '../prospect-mobile.ts'
import { ListLoading, QueryError, useApiSession } from '../shell.ts'
import { useNotify } from '../toast.tsx'
import { FieldError } from './finance-form-parts.tsx'

type Named = { id: string; name: string }
type Mode = 'card' | 'stage' | 'note'

/**
 * Aday kartı (web `ProspectDetailPage` eşi, ON-122): tek kayıt ucundan tazelenir; kapsam dışı ya da
 * olmayan aday 404 ile "Kayıt bulunamadı" görünür. Aşama değiştirme ve görüşme notu aynı pencerede
 * forma geçer; ikisi de kartın okunan sürümünü `If-Match` olarak taşır. Bilgi düzeltme, görüşme ve
 * deneme dersi planlama, onay ve kesin kayıt web'dedir. Değerler yalnız bellekte durur.
 */
export function ProspectSheet({
  prospectId,
  initial,
  onClose,
}: {
  prospectId: string
  initial?: CollectionRow<ProspectRecord> | undefined
  onClose: () => void
}) {
  const session = useApiSession()
  const type = session.institution.type
  const item = useCollectionItem<ProspectRecord>('prospects', prospectId, { placeholder: initial })
  const prospect = item.data?.record
  const branches = useCollectionAll<Named>('branches')
  const hasTrial = prospect?.trialLesson !== undefined
  const classes = useCollectionAll<Named>(
    'classes',
    { filters: { branchId: prospect?.branchId ?? '' } },
    { enabled: type === 'language_school' && hasTrial },
  )
  const [mode, setMode] = useState<Mode>('card')
  const ready = item.data !== undefined && !item.isPlaceholderData

  if (item.data && mode === 'stage')
    return (
      <StageSheet row={item.data} ready={ready} onBack={() => setMode('card')} onClose={onClose} />
    )
  if (item.data && mode === 'note')
    return (
      <NoteSheet row={item.data} ready={ready} onBack={() => setMode('card')} onClose={onClose} />
    )

  const branch = branches.data?.find((entry) => entry.record.id === prospect?.branchId)?.record.name
  const group = classes.data?.find((entry) => entry.record.id === prospect?.trialLesson?.classId)
    ?.record.name
  const open = isOpenStage(prospect?.stage)
  const enrolled = prospect?.stage === 'Kayıt oldu'

  return (
    <Sheet
      visible
      title={prospect?.name ?? 'Aday'}
      onClose={onClose}
      footer={
        <View style={{ gap: 10 }}>
          {prospect && !enrolled && (
            <Button
              primary
              icon="ArrowUpDown"
              disabled={!ready}
              label={`${prospect.name} aşamasını değiştir`}
              onPress={() => setMode('stage')}
            >
              Aşamayı değiştir
            </Button>
          )}
          {prospect && open && (
            <Button
              icon="NotebookPen"
              disabled={!ready}
              label={`${prospect.name} için görüşme notu ekle`}
              onPress={() => setMode('note')}
            >
              Görüşme notu ekle
            </Button>
          )}
          <Button onPress={onClose}>Kapat</Button>
        </View>
      }
    >
      {item.error ? (
        <QueryError error={item.error} onRetry={() => void item.refetch()} />
      ) : !prospect ? (
        <ListLoading label="Aday yükleniyor…" />
      ) : (
        <>
          <Badge text={prospectStageLabel(prospect.stage, type)} tone={stageTone(prospect.stage)} />
          <View style={{ gap: 12 }}>
            {prospectFacts(prospect, type, { branch }).map(([label, value]) => (
              <DetailPair key={label} label={label} value={value} />
            ))}
          </View>
          {prospectPlans(prospect, { branch, group }).map(([label, value]) => (
            <Notice key={label} title={`${label} planlandı`} text={value} />
          ))}
          {enrolled ? (
            <T muted size={14}>
              Kesin kayıt tamamlandı; aşama artık değişmez. Öğrenci kaydı Kayıt İşlemleri ve öğrenci
              listelerinde görünür.
            </T>
          ) : !open ? (
            <T muted size={14}>
              Kapalı adaya not eklenmez. Vazgeçen adayla yeni temas için önce adayı yeniden açın.
            </T>
          ) : (
            <T muted size={14}>
              Görüşme planlama, bilgi düzeltme ve kesin kayıt web uygulamasından yapılır.
            </T>
          )}
          <Section title={`İletişim geçmişi (${String(prospect.notes.length)} not)`}>
            <View style={{ gap: 14 }} accessibilityRole="list">
              {prospectHistory(prospect).map((note) => (
                <View key={note.id} style={{ gap: 4 }}>
                  <T muted size={13}>
                    {note.meta}
                  </T>
                  <T>{note.text}</T>
                </View>
              ))}
            </View>
          </Section>
        </>
      )}
    </Sheet>
  )
}

type FormProps = {
  row: CollectionRow<ProspectRecord>
  /** Kart tek kayıt ucundan okundu (liste satırı yer tutucusu değil); gönderim buna bağlıdır. */
  ready: boolean
  onBack: () => void
  onClose: () => void
}

const EMPTY_STAGE: StageInput = {
  stage: '',
  lostReason: '',
  lostToInstitution: '',
  siblingOfId: '',
}

/**
 * Aşama değiştirme (DOM-KAY-005, DOM-KAY-030; web `ProspectStageForm`): yalnız geçerli hedefler
 * sunulur. `Vazgeçti` nedenle girilir; vazgeçen aday `İletişime geçildi` ile yeniden açılır ve
 * iletişimi başka adayda kayıtlıysa (`prospect_contact_shared`) kardeşi seçtirilir. Kart bu arada
 * değişirse (409) seçenekler güncel karttan yeniden kurulur, girilen değerler korunur.
 */
function StageSheet({ row, ready, onBack, onClose }: FormProps) {
  const session = useApiSession()
  const type = session.institution.type
  const notify = useNotify()
  const change = useChangeProspectStage()
  const prospect = row.record
  const choices = stageChoices(prospect.stage, type)
  const [values, setValues] = useState<StageInput>(EMPTY_STAGE)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [message, setMessage] = useState<string | null>(null)
  const [askSibling, setAskSibling] = useState(false)
  const siblings = useCollectionAll<ProspectRecord>(
    'prospects',
    { filters: { stage: [...OPEN_PROSPECT_STAGES, 'Kayıt oldu'] } },
    { enabled: askSibling },
  )
  const pending = change.isPending
  // Kart değişince artık geçerli olmayan seçim gönderilmez.
  const stage = choices.some((choice) => choice.value === values.stage) ? values.stage : ''
  const reopening = prospect.stage === 'Vazgeçti'

  function update(patch: Partial<StageInput>) {
    setValues({ ...values, ...patch })
    const cleared = { ...errors }
    for (const key of Object.keys(patch)) delete cleared[key]
    setErrors(cleared)
    setMessage(null)
  }

  async function submit() {
    if (pending || !ready) return
    const result = stageBody({ ...values, stage }, { reopening })
    if (!result.ok) {
      setErrors({ [result.field]: result.message })
      return
    }
    const collector = createFieldCollector()
    const outcome = await change.submit(
      { prospectId: row.id, version: row.version, body: result.body },
      { setError: collector.setError, silent: () => true },
    )
    if (outcome.status === 'busy') return
    if (outcome.status === 'success') {
      notify('Aday aşaması güncellendi.')
      onBack()
      return
    }
    const failure = prospectFailure(outcome.error, collector.fields)
    if (failure.contactShared) setAskSibling(true)
    setErrors(failure.fields)
    setMessage(failure.message)
  }

  const footer = (
    <View style={{ gap: 12 }}>
      {message && <Notice tone="red" title="Aşama güncellenemedi" text={message} />}
      <Button
        primary
        icon="CircleCheck"
        disabled={pending || !ready || choices.length === 0}
        onPress={() => void submit()}
      >
        {pending ? 'Kaydediliyor…' : 'Aşamayı güncelle'}
      </Button>
      <Button disabled={pending} onPress={onBack}>
        Vazgeç
      </Button>
    </View>
  )

  return (
    <Sheet visible title="Aşamayı değiştir" onClose={onClose} footer={footer} pinFooter>
      <Notice
        title={prospect.name}
        text={`Şu anki aşama: ${prospectStageLabel(prospect.stage, type)}`}
      />
      {choices.length === 0 ? (
        <T muted>Bu aday için geçerli aşama yok.</T>
      ) : (
        <>
          <Select
            label="Yeni aşama"
            value={stage}
            required
            disabled={pending}
            options={choices}
            onChange={(next) => update({ stage: next })}
          />
          <FieldError text={errors.stage} />
        </>
      )}
      {stage === 'Vazgeçti' && (
        <>
          <Select
            label="Vazgeçme nedeni"
            value={values.lostReason}
            required
            disabled={pending}
            options={LOST_REASON_OPTIONS}
            onChange={(lostReason) => update({ lostReason })}
          />
          <FieldError text={errors.lostReason} />
          <Field
            label="Tercih ettiği kurum"
            value={values.lostToInstitution}
            onChange={(lostToInstitution) => update({ lostToInstitution })}
            hint="İsteğe bağlı. Yalnız kurum adını yazın; kişi bilgisi yazmayın."
            maxLength={PROSPECT_LOST_INSTITUTION_MAX}
            editable={!pending}
            {...(errors.lostToInstitution ? { error: errors.lostToInstitution } : {})}
          />
        </>
      )}
      {askSibling &&
        (siblings.error ? (
          <QueryError error={siblings.error} onRetry={() => void siblings.refetch()} />
        ) : !siblings.data ? (
          <ListLoading label="Adaylar yükleniyor…" />
        ) : (
          <>
            <T muted size={14}>
              Bu iletişim bilgisi başka bir adayda kayıtlı. Kardeşse, kardeşini listeden kendiniz
              seçin.
            </T>
            <Select
              label="Kardeş aday"
              value={values.siblingOfId}
              disabled={pending}
              options={siblings.data
                .filter((entry) => entry.record.id !== row.id)
                .map((entry) => ({
                  value: entry.record.id,
                  label: `${entry.record.name} · ${prospectStageLabel(entry.record.stage, type)}`,
                }))}
              onChange={(siblingOfId) => update({ siblingOfId })}
            />
            <FieldError text={errors.siblingOfId} />
          </>
        ))}
    </Sheet>
  )
}

/**
 * Görüşme notu (DOM-KAY-032; web `ProspectNoteForm`): not yalnız eklenir, düzenlenmez ve silinmez;
 * yazar adı sunucuda oturumdan alınır. Özel nitelikli veri uyarısı alanın altında durur. Başarısız
 * gönderimde metin korunur; ağ/5xx sonrası yeniden gönderim aynı istek anahtarıyla gider.
 */
function NoteSheet({ row, ready, onBack, onClose }: FormProps) {
  const notify = useNotify()
  const add = useAddProspectNote()
  const [text, setText] = useState('')
  const [error, setError] = useState<string | undefined>(undefined)
  const [message, setMessage] = useState<string | null>(null)
  const pending = add.isPending
  const open = isOpenStage(row.record.stage)

  async function submit() {
    if (pending || !ready || !open) return
    const check = checkNote(text)
    if (!check.ok) {
      setError(check.error)
      return
    }
    const collector = createFieldCollector()
    const outcome = await add.submit(
      { prospectId: row.id, version: row.version, body: check.body },
      { setError: collector.setError, silent: () => true },
    )
    if (outcome.status === 'busy') return
    if (outcome.status === 'success') {
      notify('Not eklendi.')
      onBack()
      return
    }
    const failure = prospectFailure(outcome.error, collector.fields)
    setError(failure.fields.text)
    setMessage(failure.message)
  }

  const footer = (
    <View style={{ gap: 12 }}>
      {message && <Notice tone="red" title="Not eklenemedi" text={message} />}
      <Button
        primary
        icon="CircleCheck"
        disabled={pending || !ready || !open}
        onPress={() => void submit()}
      >
        {pending ? 'Kaydediliyor…' : 'Notu kaydet'}
      </Button>
      <Button disabled={pending} onPress={onBack}>
        Vazgeç
      </Button>
    </View>
  )

  return (
    <Sheet visible title="Görüşme notu ekle" onClose={onClose} footer={footer} pinFooter>
      <Notice title={row.record.name} text="Notlar eklenir; düzenlenmez ve silinmez." />
      {open ? (
        <Field
          label="Görüşme notu"
          value={text}
          onChange={(next) => {
            setText(next)
            setError(undefined)
            setMessage(null)
          }}
          multiline
          hint={PROSPECT_NOTE_NOTICE}
          maxLength={PROSPECT_NOTE_MAX_LENGTH}
          editable={!pending}
          {...(error ? { error } : {})}
        />
      ) : (
        <T muted>Aday kapandığı için not eklenemez.</T>
      )}
    </Sheet>
  )
}
