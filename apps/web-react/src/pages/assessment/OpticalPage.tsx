import { useMemo, useState } from 'react'
import { exampleOpticalFile } from '@kampus/school-core/lib/assessment-automation.ts'
import type { Session } from '@/auth/auth-port.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { DataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import { saveBlob } from '@/lib/download.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { notify } from '@/lib/notify.ts'
import { useSourcesState } from '../workflows/use-workflow-state.ts'
import { collectionSources, coreSession } from '../workflows/workflow-state.ts'
import { AssessmentPanel } from './AssessmentPanel.tsx'
import { OpticalEvaluateSection } from './OpticalEvaluateSection.tsx'
import { OpticalProfileForm } from './OpticalProfileForm.tsx'
import {
  evaluationRows,
  examsWithoutProfile,
  OPTICAL_SOURCES,
  profileRows,
  type EvaluationRow,
  type ProfileRow,
} from './optical-model.ts'

/**
 * Optik değerlendirme (Vue `AssessmentAutomation.vue`, optik bölümü): okuyucu profilleri, cevap
 * dosyası değerlendirme ve kayıtlı analizlerin durumu. Önizleme ve kayıt sunucudadır
 * (`/assessment/evaluate[/preview]`); profil oluşturma/düzenleme yalnız yöneticidedir
 * (`/assessment/profile`, sunucu da zorlar). Öğretmen profilleri ve kendi sonuçlarını görür.
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

  const admin = session.role === 'yonetici'
  const writer = admin || session.role === 'ogretmen'
  // Profil formu: `null` kapalı, `'new'` oluşturma, kimlik düzenleme.
  const [editing, setEditing] = useState<string | null>(null)
  const editedProfile = data.state.opticalProfiles.find((item) => item.id === editing) ?? null

  function downloadExample(profileId: string) {
    const profile = data.state.opticalProfiles.find((item) => item.id === profileId)
    if (!profile) return
    try {
      const content = exampleOpticalFile(data.state, profile, actor)
      saveBlob(
        new Blob(['\ufeff', content], { type: 'text/plain;charset=utf-8' }),
        'optik-ornek.csv',
      )
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
      ...(admin
        ? [
            {
              key: 'actions',
              label: 'İşlem',
              cell: (row: ProfileRow) => (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  aria-label={`${row.title} profilini düzenle`}
                  onClick={() => setEditing(row.id)}
                >
                  Düzenle
                </Button>
              ),
            },
          ]
        : []),
    ],
    [admin],
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

      {writer ? (
        <OpticalEvaluateSection
          profiles={profiles}
          subjects={data.state.subjects}
          loading={data.pending}
          onDownloadExample={downloadExample}
        />
      ) : null}

      <AssessmentPanel
        id="optik-profiller"
        title="Okuyucu profilleri"
        description={`${profiles.length} profil`}
        flush
        actions={
          admin ? (
            <Button
              onClick={() => setEditing('new')}
              disabled={data.pending || missing.length === 0}
              title={missing.length === 0 ? 'Her denemenin optik profili var.' : undefined}
            >
              <Icon name="Plus" size={17} aria-hidden="true" />
              Profil ekle
            </Button>
          ) : undefined
        }
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
      {admin && editing ? (
        <OpticalProfileForm
          key={editing}
          profile={editedProfile}
          exams={
            editedProfile
              ? data.state.mockExams.map((exam) => ({ id: exam.id, title: exam.title }))
              : missing
          }
          version={editedProfile ? data.versions.get(editedProfile.id) : undefined}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  )
}
