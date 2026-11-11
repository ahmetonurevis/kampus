import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { PdfButton } from '@/components/PdfButton.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { useCoreItem } from '@/hooks/use-core-collection.ts'
import { SummaryLoading, SummarySection } from '../management/SummaryParts.tsx'
import { Facts, SummaryTitle } from './LearningParts.tsx'

type Props = { materialId: string; onClose: () => void }

/**
 * Materyal özeti: ders, düzey, dosya ve içerik metni; çalışma kâğıdı PDF olarak açılır.
 */
export function MaterialPanel({ materialId, onClose }: Props) {
  return (
    <SidePanel
      open={materialId !== ''}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Materyal özeti"
    >
      {materialId ? <MaterialDetail materialId={materialId} /> : null}
    </SidePanel>
  )
}

function MaterialDetail({ materialId }: { materialId: string }) {
  const item = useCoreItem('materials', materialId)
  if (item.error) return <QueryError error={item.error} onRetry={() => void item.refetch()} />
  if (!item.data) return <SummaryLoading />
  const material = item.data.record
  return (
    <>
      <SummaryTitle
        icon="FolderOpen"
        title={material.title}
        subtitle={`${material.subject} · ${material.level}`}
      />
      <Facts
        items={[
          ['Tür', material.type],
          ['Dosya', material.fileName],
          ['Eklenme tarihi', dateLabel(material.createdAt, { year: 'numeric' })],
        ]}
      />
      <SummarySection title="İçerik">
        <div className="grid gap-2 text-sm">
          {material.content.map((paragraph) => (
            <p key={paragraph} className="[overflow-wrap:anywhere]">
              {paragraph}
            </p>
          ))}
        </div>
      </SummarySection>
      <div className="mt-6 flex flex-wrap gap-2">
        <PdfButton
          type="material"
          recordId={material.id}
          label="Çalışma kâğıdını görüntüle"
          size="default"
        />
      </div>
    </>
  )
}
