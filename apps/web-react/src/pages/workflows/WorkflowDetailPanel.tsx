import type {
  WorkflowAction,
  WorkflowDetails,
  WorkflowRow,
} from '@kampus/school-core/lib/workflow-presentation.ts'
import { PdfButton } from '@/components/PdfButton.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'

type Props = {
  /** URL'deki kayıt kimliği (`?kayit=`); boşsa panel kapalı. */
  selectedId: string | null
  row: WorkflowRow | undefined
  details: WorkflowDetails | null
  pending: boolean
  onAction: (action: WorkflowAction) => void
  onClose: () => void
}

/**
 * Kayıt ayrıntısı (Vue drawer): bölümler ve işlemler core `workflowDetails`'tan. Kapsam dışı veya
 * silinmiş kayıt bağlantısı "Kayıt bulunamadı" der; satır başka kaynaktan uydurulmaz.
 */
export function WorkflowDetailPanel({
  selectedId,
  row,
  details,
  pending,
  onAction,
  onClose,
}: Props) {
  const title = row ? row.title || 'Kayıt' : pending ? 'Kayıt yükleniyor' : 'Kayıt bulunamadı'
  return (
    <SidePanel
      open={Boolean(selectedId)}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={title}
    >
      {row && details ? (
        <div className="grid gap-5">
          <div>
            <StatusBadge text={row.status} />
          </div>
          {details.sections.map((section) => (
            <section key={section.title} className="grid gap-1.5 border-t pt-4 first:border-t-0">
              <h3 className="text-sm font-semibold">{section.title}</h3>
              {section.lines.length ? (
                section.lines.map((line) => (
                  <p key={line} className="text-sm whitespace-pre-line text-muted-foreground">
                    {line}
                  </p>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">Henüz kayıt yok.</p>
              )}
            </section>
          ))}
          {details.documents.length ? (
            <section aria-label="Belgeler" className="flex flex-wrap gap-2 border-t pt-4">
              {details.documents.map((document) => (
                <PdfButton
                  key={`${document.type}-${document.id}`}
                  type={document.type}
                  recordId={document.id}
                  label={document.title}
                />
              ))}
            </section>
          ) : null}
          {details.actions.length ? (
            <div className="flex flex-wrap gap-2 border-t pt-4">
              {details.actions.map((action, index) => (
                <Button
                  key={`${action.command}-${action.recordId ?? ''}-${action.label}`}
                  variant={index === 0 ? 'default' : 'secondary'}
                  onClick={() => onAction(action)}
                >
                  {action.label}
                </Button>
              ))}
            </div>
          ) : null}
        </div>
      ) : pending ? (
        <p role="status" className="text-sm text-muted-foreground">
          Kayıt yükleniyor…
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          Kayıt mevcut rol veya çocuk kapsamında bulunamadı. Listeye dönüp yeniden seçin.
        </p>
      )}
    </SidePanel>
  )
}
