import { useId, useState, type ChangeEvent } from 'react'
import { fileFailure } from '@kampus/react-shared/assessment-feedback.ts'
import {
  EVALUATION_STALE_CODE,
  useEvaluateOptical,
  usePreviewEvaluation,
  type EvaluationPreview,
} from '@kampus/react-shared/use-assessment-commands.ts'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { notify } from '@/lib/notify.ts'
import { AssessmentPanel } from './AssessmentPanel.tsx'
import {
  answerFileProblem,
  answerTextProblem,
  decodeAnswerFile,
  type ProfileRow,
} from './optical-model.ts'

/** Önizleme tablosunda en fazla gösterilen satır; özet sayıları tüm sonuçları kapsar. */
const PREVIEW_LIMIT = 100
const ENCODING_LABELS = { 'utf-8': 'UTF-8', 'windows-1254': 'Windows-1254 (Türkçe)' } as const

/** Önizleme ve onayı bağlayan istek: ikisi aynı profil ve metinle çalışır. */
type Checked = { profileId: string; text: string; data: EvaluationPreview }

type Props = {
  profiles: readonly ProfileRow[]
  subjects: readonly { id: string; name: string }[]
  /** Koleksiyonlar yükleniyor: profil listesi boş görünür ama henüz yok demek değildir. */
  loading: boolean
  onDownloadExample: (profileId: string) => void
  /** Seçili profilin cevap anahtarı CSV'si (içe aktarma biçiminde). */
  onDownloadKey: (profileId: string) => void
}

/**
 * Optik cevap dosyası değerlendirme (Vue `AssessmentAutomation.vue`, optik bölümü). Dosya
 * tarayıcıda çözülür (UTF-8, olmazsa Windows-1254) ve metin olarak gönderilir. Önizlemeyi ve
 * kaydı sunucu yapar: "Sonuçları önizle" `POST /assessment/evaluate/preview`, "Onayla ve
 * sonuçları kaydet" `POST /assessment/evaluate` (önizlemenin özetiyle). Önizlemeden sonra
 * veri değişirse sunucu 409 `evaluation_stale` döner; ekran yeniden önizleme ister.
 */
export function OpticalEvaluateSection({
  profiles,
  subjects,
  loading,
  onDownloadExample,
  onDownloadKey,
}: Props) {
  const [profileId, setProfileId] = useState('')
  const [text, setText] = useState('')
  const [encoding, setEncoding] = useState<keyof typeof ENCODING_LABELS | null>(null)
  const [fileError, setFileError] = useState('')
  const [textError, setTextError] = useState('')
  const [checked, setChecked] = useState<Checked | null>(null)
  const [stale, setStale] = useState(false)
  const [saved, setSaved] = useState<number | null>(null)
  const [reading, setReading] = useState(false)
  const fileId = useId()
  const textId = useId()
  const selected = profileId || profiles[0]?.id || ''
  const previewer = usePreviewEvaluation()
  const evaluate = useEvaluateOptical()

  function reset() {
    setChecked(null)
    setStale(false)
    setSaved(null)
    setTextError('')
  }

  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (!file) return
    reset()
    const problem = answerFileProblem(file)
    if (problem) {
      setFileError(problem)
      setEncoding(null)
      input.value = ''
      return
    }
    setFileError('')
    setReading(true)
    try {
      const decoded = decodeAnswerFile(new Uint8Array(await file.arrayBuffer()))
      setText(decoded.text)
      setEncoding(decoded.encoding)
    } catch (error) {
      notify.error('Dosya okunamadı. Başka bir dosya seçip yeniden deneyin.', error)
    } finally {
      setReading(false)
      input.value = ''
    }
  }

  async function runPreview() {
    setStale(false)
    setSaved(null)
    const problem = answerTextProblem(text)
    if (problem) {
      setChecked(null)
      setTextError(problem)
      return
    }
    setTextError('')
    const outcome = await previewer.preview({ profileId: selected, text })
    if (outcome.status === 'success') {
      setChecked({ profileId: selected, text, data: outcome.data })
      return
    }
    setChecked(null)
    // Dosya hatası satır numarasıyla; diğer 422 kuralları (ör. profil/sınav) sunucu iletisiyle.
    const failure = fileFailure(outcome.error, 'text')
    if (failure) setTextError(failure.message)
    else if (outcome.error.status === 422) setTextError(outcome.error.message)
  }

  async function confirm() {
    if (!checked) return
    setStale(false)
    const outcome = await evaluate.submit({
      profileId: checked.profileId,
      text: checked.text,
      expectedDigest: checked.data.digest,
    })
    if (outcome.status === 'success') {
      const { inserted, updated } = outcome.data.data.changes
      notify.success(`${inserted + updated} sonuç kaydedildi.`)
      setSaved(inserted + updated)
      setChecked(null)
      setText('')
      setEncoding(null)
      return
    }
    if (outcome.status !== 'failed') return
    if (outcome.error.code === EVALUATION_STALE_CODE) {
      // Bayat önizleme atılır: "Yeniden önizle" `stale`'i hemen kapatır ve eski özet yeni yanıt
      // gelene kadar onaylanabilir görünürdü; onay eski özetle ikinci kez 409 alırdı.
      setChecked(null)
      setStale(true)
      return
    }
    const failure = fileFailure(outcome.error, 'text')
    if (failure) {
      setChecked(null)
      setTextError(failure.message)
    }
  }

  const busy = previewer.isPending || evaluate.isPending

  return (
    <AssessmentPanel
      id="optik-degerlendirme-formu"
      title="Cevap dosyasını değerlendir"
      description="Okuyucunun CSV, DAT veya TXT çıktısını seçin; sonuçlar kaydedilmeden önce sunucuda ön kontrol edilir."
    >
      {profiles.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {loading
            ? 'Optik profilleri yükleniyor…'
            : 'Henüz optik profili yok. Profil tanımlandığında cevap dosyası değerlendirilebilir.'}
        </p>
      ) : (
        <form
          className="grid max-w-3xl gap-4"
          aria-label="Cevap dosyası değerlendirme formu"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            void runPreview()
          }}
        >
          <FormField id={`${fileId}-profil`} label="Optik profil">
            {(control) => (
              <NativeSelect
                {...control}
                className="w-full"
                value={selected}
                onChange={(event) => {
                  setProfileId(event.target.value)
                  reset()
                }}
              >
                {profiles.map((profile) => (
                  <NativeSelectOption key={profile.id} value={profile.id}>
                    {profile.title}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <FormField
            id={fileId}
            label="Optik cevap dosyası"
            error={fileError ? { message: fileError } : undefined}
            description={
              encoding
                ? `Dosya ${ENCODING_LABELS[encoding]} olarak okundu. Okuyucu çıktısının kodlaması otomatik algılanır.`
                : 'En fazla 1 MB; CSV, DAT veya TXT. UTF-8 ve Windows-1254 kodlamaları otomatik algılanır.'
            }
          >
            {(control) => (
              <Input
                {...control}
                type="file"
                accept=".csv,.dat,.txt,text/csv,text/plain"
                disabled={reading}
                onChange={(event) => void readFile(event)}
              />
            )}
          </FormField>
          <FormField
            id={textId}
            label="Optik dosya içeriği"
            error={textError ? { message: textError } : undefined}
          >
            {(control) => (
              <Textarea
                {...control}
                rows={6}
                className="font-mono text-sm"
                value={text}
                spellCheck={false}
                onChange={(event) => {
                  setText(event.target.value)
                  setEncoding(null)
                  reset()
                }}
              />
            )}
          </FormField>
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              disabled={!selected || !text.trim() || loading || busy}
              aria-busy={previewer.isPending || undefined}
            >
              Sonuçları önizle
            </Button>
            <Button type="button" variant="secondary" onClick={() => onDownloadExample(selected)}>
              <Icon name="Download" size={16} aria-hidden="true" />
              Örnek cevap dosyasını indir
            </Button>
            <Button type="button" variant="secondary" onClick={() => onDownloadKey(selected)}>
              <Icon name="Download" size={16} aria-hidden="true" />
              Cevap anahtarını indir
            </Button>
          </div>
        </form>
      )}
      {saved !== null ? (
        <p role="status" className="mt-6 text-sm text-success">
          {saved} sonuç kaydedildi. Aşağıdaki kayıtlı değerlendirmelerde görünür.
        </p>
      ) : null}
      {stale ? (
        <div role="alert" className="mt-6 rounded-md border border-warning bg-warning-soft p-4">
          <h3 className="text-base font-semibold">Veri değişti</h3>
          <p className="mt-1 text-sm">
            Önizlemeden sonra sonuçlar veya cevap anahtarı değişti. Hiçbir sonuç kaydedilmedi;
            dosyayı yeniden önizleyip tekrar onaylayın.
          </p>
          <div className="mt-3">
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => void runPreview()}
            >
              Yeniden önizle
            </Button>
          </div>
        </div>
      ) : null}
      {checked && !stale ? (
        <PreviewResult
          preview={checked.data}
          subjects={subjects}
          pending={evaluate.isPending}
          onConfirm={() => void confirm()}
        />
      ) : null}
    </AssessmentPanel>
  )
}

function PreviewResult({
  preview,
  subjects,
  pending,
  onConfirm,
}: {
  preview: EvaluationPreview
  subjects: readonly { id: string; name: string }[]
  pending: boolean
  onConfirm: () => void
}) {
  const { summary, rows } = preview
  const multiple = rows.reduce((sum, row) => sum + row.multiple, 0)
  return (
    <div className="mt-6 grid gap-4">
      <h3 className="text-base font-semibold">Değerlendirme önizlemesi</h3>
      <p role="status" className="text-sm text-muted-foreground">
        {summary.studentCount} öğrenci, {summary.rowCount} ders sonucu
        {summary.replacesCount ? ` · ${summary.replacesCount} kayıtlı sonuç güncellenecek` : ''}
        {multiple ? ` · ${multiple} çoklu işaret yanlış sayıldı` : ''}.
      </p>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Öğrenci</TableHead>
              <TableHead>Ders</TableHead>
              <TableHead>Kitapçık</TableHead>
              <TableHead>Doğru</TableHead>
              <TableHead>Yanlış</TableHead>
              <TableHead>Boş</TableHead>
              <TableHead>Net</TableHead>
              <TableHead>Zayıf kazanımlar</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.slice(0, PREVIEW_LIMIT).map((row) => (
              <TableRow key={`${row.studentId}:${row.subjectId}`}>
                <TableCell>{row.studentName}</TableCell>
                <TableCell>
                  {subjects.find((item) => item.id === row.subjectId)?.name ?? row.subjectId}
                </TableCell>
                <TableCell>{row.booklet}</TableCell>
                <TableCell>{row.correct}</TableCell>
                <TableCell>{row.wrong}</TableCell>
                <TableCell>{row.blank}</TableCell>
                <TableCell>{row.net}</TableCell>
                <TableCell>{row.weakTopics.join(', ') || '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {rows.length > PREVIEW_LIMIT ? (
        <p className="text-sm text-muted-foreground">
          İlk {PREVIEW_LIMIT} satır gösteriliyor; toplam {rows.length} satır kontrol edildi.
        </p>
      ) : null}
      <div>
        <Button
          type="button"
          disabled={pending}
          aria-busy={pending || undefined}
          onClick={onConfirm}
        >
          Onayla ve sonuçları kaydet
        </Button>
      </div>
    </div>
  )
}
