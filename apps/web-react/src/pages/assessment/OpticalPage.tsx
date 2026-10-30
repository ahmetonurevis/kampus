import { useId, useMemo, useState, type ChangeEvent } from 'react'
import { exampleOpticalFile } from '@kampus/school-core/lib/assessment-automation.ts'
import { decodeText, textEncodings } from '@kampus/school-core/lib/text-decoding.ts'
import type { Session } from '@/auth/auth-port.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { DataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import { saveBlob } from '@/lib/download.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { notify } from '@/lib/notify.ts'
import { useSourcesState } from '../workflows/use-workflow-state.ts'
import { collectionSources, coreSession } from '../workflows/workflow-state.ts'
import { AssessmentPanel } from './AssessmentPanel.tsx'
import {
  answerFileProblem,
  evaluationRows,
  examsWithoutProfile,
  OPTICAL_SOURCES,
  previewAnswerFile,
  profileRows,
  type EvaluationRow,
  type OpticalPreview,
  type ProfileRow,
} from './optical-model.ts'

/** Önizleme tablosunda en fazla gösterilen satır; özet sayıları tüm sonuçları kapsar. */
const PREVIEW_LIMIT = 100
const ENCODING_LABELS: Record<string, string> = {
  'utf-8': 'UTF-8',
  'windows-1254': 'Windows-1254 (Türkçe)',
}

/**
 * Optik değerlendirme (Vue `AssessmentAutomation.vue`, optik bölümü): okuyucu profilleri, cevap
 * dosyası ön kontrolü ve kayıtlı analizlerin durumu. Ayrıştırma ve net hesabı core'dadır;
 * ön kontrol saf işlemdir ve sunucuya yazmaz.
 *
 * TODO(api-optical-profile): profil oluşturma/düzenleme ucu (`profile` komutu) API'de yok;
 * profiller salt okunur listelenir.
 * TODO(api-optical-evaluate): değerlendirmeyi kaydeden uç (`evaluate` komutu, çift gönderime
 * karşı `Idempotency-Key`, `expectedPreview`) API'de yok; ön kontrol çalışır, kayıt kilitli.
 * TODO(perf): ön kontrol için öğrenci/sınıf/sonuç koleksiyonları bütünüyle okunur; sunucu
 * ön kontrol ucu gelince istemci okuması kalkar.
 */
export function OpticalPage({ page }: { page: NavPage }) {
  const { session } = useAuth()
  useDocumentTitle(page.title)
  if (!session) return null
  return <OpticalView page={page} session={session} />
}

function OpticalView({ page, session }: { page: NavPage; session: Session }) {
  const actor = useMemo(() => coreSession(session, ''), [session])
  const sources = useMemo(() => collectionSources(OPTICAL_SOURCES, session.role), [session.role])
  const data = useSourcesState(sources, session)
  const profiles = profileRows(data.state)
  const evaluations = evaluationRows(data.state, actor)
  const missing = examsWithoutProfile(data.state, actor)

  const [profileId, setProfileId] = useState('')
  const [encoding, setEncoding] = useState('utf-8')
  const [text, setText] = useState('')
  const [checked, setChecked] = useState<{ profileId: string; text: string } | null>(null)
  const [reading, setReading] = useState(false)
  const fileId = useId()
  const textId = useId()
  const selected = profileId || profiles[0]?.id || ''

  // Ön kontrol saf işlemdir; koleksiyonlar tazelenince sonuç güncel veriyle yeniden hesaplanır.
  const preview = useMemo<OpticalPreview | null>(
    () => (checked ? previewAnswerFile(data.state, actor, checked.profileId, checked.text) : null),
    [checked, data.state, actor],
  )

  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (!file) return
    const problem = answerFileProblem(file)
    if (problem) {
      notify.error(problem)
      input.value = ''
      return
    }
    setReading(true)
    try {
      setText(decodeText(new Uint8Array(await file.arrayBuffer()), encoding))
      setChecked(null)
    } catch (error) {
      notify.error(
        'Dosya seçilen karakter kodlamasıyla okunamadı. Başka bir kodlama deneyin.',
        error,
      )
    } finally {
      setReading(false)
      input.value = ''
    }
  }

  function downloadExample() {
    const profile = data.state.opticalProfiles.find((item) => item.id === selected)
    if (!profile) return
    try {
      const content = exampleOpticalFile(data.state, profile, actor)
      saveBlob(new Blob(['﻿', content], { type: 'text/plain;charset=utf-8' }), 'optik-ornek.csv')
    } catch (error) {
      notify.error(
        'Örnek dosya hazırlanamadı. Profilde cevap anahtarı olduğundan emin olun.',
        error,
      )
    }
  }

  const profileColumns = useMemo<DataColumn<ProfileRow>[]>(
    () => [
      { key: 'title', label: 'Profil' },
      { key: 'examTitle', label: 'Deneme' },
      { key: 'format', label: 'Dosya biçimi' },
      { key: 'identifier', label: 'Öğrenci eşleşmesi' },
      { key: 'booklets', label: 'Kitapçıklar' },
      { key: 'questionCount', label: 'Soru' },
      { key: 'revision', label: 'Anahtar sürümü' },
      {
        key: 'gaps',
        label: 'Anahtar durumu',
        cell: (row) =>
          row.gaps.length ? (
            <ul className="grid gap-1 text-sm text-danger">
              {row.gaps.map((gap) => (
                <li key={gap}>{gap}</li>
              ))}
            </ul>
          ) : (
            <StatusBadge text="Hazır" tone="green" />
          ),
      },
    ],
    [],
  )
  const evaluationColumns = useMemo<DataColumn<EvaluationRow>[]>(
    () => [
      { key: 'student', label: 'Öğrenci' },
      { key: 'exam', label: 'Deneme' },
      { key: 'subject', label: 'Ders' },
      { key: 'booklet', label: 'Kitapçık' },
      { key: 'correct', label: 'Doğru' },
      { key: 'wrong', label: 'Yanlış' },
      { key: 'blank', label: 'Boş' },
      { key: 'net', label: 'Net' },
      {
        key: 'current',
        label: 'Durum',
        cell: (row) =>
          row.current ? (
            <StatusBadge text="Güncel" tone="green" />
          ) : (
            <div className="grid gap-1">
              <StatusBadge text="Eski analiz" tone="amber" />
              <span className="text-xs text-muted-foreground">
                {row.staleReason} Etüt planlamasında kullanılmaz.
              </span>
            </div>
          ),
      },
    ],
    [],
  )

  return (
    <>
      <PageHeading title={page.title} description={page.description} />
      {data.error ? <QueryError error={data.error} onRetry={data.retry} /> : null}

      <AssessmentPanel
        id="optik-degerlendirme-formu"
        title="Cevap dosyasını değerlendir"
        description="Okuyucunun CSV, DAT veya TXT çıktısını seçin; sonuçlar kaydedilmeden önce ön kontrol edilir."
      >
        {profiles.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Henüz optik profili yok. Profil tanımlandığında cevap dosyası değerlendirilebilir.
          </p>
        ) : (
          <div className="grid max-w-3xl gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor={`${fileId}-profil`}>Optik profil</Label>
                <NativeSelect
                  id={`${fileId}-profil`}
                  className="w-full"
                  value={selected}
                  onChange={(event) => {
                    setProfileId(event.target.value)
                    setChecked(null)
                  }}
                >
                  {profiles.map((profile) => (
                    <NativeSelectOption key={profile.id} value={profile.id}>
                      {profile.title}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`${fileId}-kodlama`}>Karakter kodlaması</Label>
                <NativeSelect
                  id={`${fileId}-kodlama`}
                  className="w-full"
                  value={encoding}
                  onChange={(event) => setEncoding(event.target.value)}
                >
                  {textEncodings.map((item) => (
                    <NativeSelectOption key={item} value={item}>
                      {ENCODING_LABELS[item] ?? item}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={fileId}>Optik cevap dosyası</Label>
              <Input
                id={fileId}
                type="file"
                accept=".csv,.dat,.txt,text/csv,text/plain"
                disabled={reading}
                onChange={(event) => void readFile(event)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={textId}>Optik dosya içeriği</Label>
              <Textarea
                id={textId}
                rows={6}
                className="font-mono text-sm"
                value={text}
                spellCheck={false}
                onChange={(event) => {
                  setText(event.target.value)
                  setChecked(null)
                }}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={!selected || !text.trim() || data.pending}
                onClick={() => setChecked({ profileId: selected, text })}
              >
                Sonuçları önizle
              </Button>
              <Button type="button" variant="secondary" onClick={downloadExample}>
                <Icon name="Download" size={16} aria-hidden="true" />
                Örnek cevap dosyasını indir
              </Button>
            </div>
          </div>
        )}
        {preview ? <PreviewResult preview={preview} subjects={data.state.subjects} /> : null}
      </AssessmentPanel>

      <AssessmentPanel
        id="optik-profiller"
        title="Okuyucu profilleri"
        description={`${profiles.length} profil`}
        flush
      >
        {missing.length ? (
          <p role="status" className="px-6 pb-2 text-sm text-warning max-[650px]:px-4">
            Optik profili olmayan deneme: {missing.map((exam) => exam.title).join(', ')}.
          </p>
        ) : null}
        <DataTable
          listKey="optik-profiller"
          urlPrefix="profil-"
          rows={profiles}
          columns={profileColumns}
          mobileColumns={['title', 'examTitle']}
          searchKeys={['title', 'examTitle']}
          caption="Okuyucu profilleri"
          empty="Henüz optik profili yok."
        />
      </AssessmentPanel>

      <AssessmentPanel
        id="optik-kayitli-analizler"
        title="Kayıtlı değerlendirmeler"
        description={`${evaluations.length} analiz · anahtar veya sonuç değişirse analiz eskir`}
        flush
      >
        <DataTable
          listKey="optik-analizler"
          urlPrefix="analiz-"
          rows={evaluations}
          columns={evaluationColumns}
          mobileColumns={['student', 'current']}
          searchKeys={['student', 'exam', 'subject']}
          caption="Kayıtlı optik değerlendirmeler"
          empty="Henüz kaydedilmiş değerlendirme yok."
        />
      </AssessmentPanel>
    </>
  )
}

function PreviewResult({
  preview,
  subjects,
}: {
  preview: OpticalPreview
  subjects: readonly { id: string; name: string }[]
}) {
  if (!preview.ok)
    return (
      <div role="alert" className="mt-6 rounded-md border border-danger bg-danger-soft p-4">
        <h3 className="text-base font-semibold text-danger">Ön kontrol başarısız</h3>
        <p className="mt-1 text-sm">{preview.message}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Hiçbir sonuç kaydedilmedi. Dosyayı düzeltip yeniden önizleyin.
        </p>
      </div>
    )
  const { summary, rows } = preview
  return (
    <div className="mt-6 grid gap-4">
      <h3 className="text-base font-semibold">Değerlendirme önizlemesi</h3>
      <p role="status" className="text-sm text-muted-foreground">
        {summary.students} öğrenci, {summary.results} ders sonucu
        {summary.replacing ? ` · ${summary.replacing} kayıtlı sonuç güncellenecek` : ''}
        {summary.multiple ? ` · ${summary.multiple} çoklu işaret yanlış sayıldı` : ''}.
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
      <div className="grid gap-2">
        <div>
          <Button type="button" disabled aria-describedby="optik-kayit-notu">
            Onayla ve sonuçları kaydet
            <span className="sr-only"> (henüz kullanıma açık değil)</span>
          </Button>
        </div>
        <p id="optik-kayit-notu" className="text-sm text-muted-foreground">
          Değerlendirmeyi kaydetme henüz kullanıma açık değil; ön kontrol dosyanın kaydedilmeye
          hazır olduğunu gösterir.
        </p>
      </div>
    </div>
  )
}
