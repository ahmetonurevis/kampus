import { useState } from 'react'
import {
  useAcknowledgeMealAllergy,
  useLoadMealAllergyRoster,
  useMealAllergyOptions,
  type MealAllergyOptions,
  type MealAllergyRoster,
  type MealAllergyRosterStudent,
} from '@kampus/react-shared/use-finance-meal-allergy-checks.ts'
import type { HealthAccessReason } from '@kampus/school-core/lib/finance-health-access.ts'
import {
  MEAL_KIND_LABELS,
  MEAL_KINDS,
  type MealKind,
} from '@kampus/school-core/lib/finance-meal-menus.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { EmptyState } from '@/components/EmptyState.tsx'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from '@/components/ui/native-select'
import { notify } from '@/lib/notify.ts'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import {
  acknowledgementText,
  classTarget,
  conflictText,
  gradeTarget,
  MEAL_ALLERGY_REASON_SCOPE,
  MEAL_ALLERGY_SUGGESTED_REASON,
  menuScopeText,
  rosterQuery,
  rosterTitle,
  severityText,
  unmatchedText,
  withAcknowledgement,
} from './finance-meal-allergy-forms.ts'
import { HealthAccessGate } from './FinanceHealthAccessReasonDialog.tsx'

/**
 * Yazdırma: yalnız liste kâğıda çıkar (gezinme, seçim ve düğmeler gizli). Kural bileşen açıkken
 * geçerlidir; ortak stil dosyasına girmez.
 */
const PRINT_CSS = `@media print {
  body * { visibility: hidden !important; }
  [data-yemekhane-yazdir], [data-yemekhane-yazdir] * { visibility: visible !important; }
  [data-yemekhane-yazdir] { position: absolute; top: 0; left: 0; width: 100%; padding: 0; }
  [data-yemekhane-gizle] { display: none !important; }
}`

/**
 * Yemekhane alerji uyarısı (DOM-FIN-162; ON-151; K-541…K-543): Finans "Yemekhane alerji uyarısı"
 * sekmesi, yönetici ve ön büro. Görevli gün, öğün ve sınıf (ya da sınıf düzeyi) seçer; liste yalnız
 * uyarısı olan öğrencileri, hangi yemekte hangi alerjen olduğunu ve menüyle karşılaştırılamayan
 * alerjileri gösterir. Sağlık bilgisi içerdiğinden erişim gerekçesi sorulur (ön seçili "Yemek
 * servisinde alerji kontrolü"); her açılış kayda geçer. Bugünün servisinde öğrenci başına "uyarı
 * görüldü, alternatif verildi" işaretlenir. Ekran sade ve yazdırılabilir.
 */
export function FinanceMealAllergySection() {
  const { session } = useAuth()
  if (session?.modules.meals !== true)
    return (
      <EmptyState
        icon="Utensils"
        title="Yemek menüsü modülü kapalı"
        description="Alerji uyarısı yayımlanmış yemek menüsüyle karşılaştırılır. Kurum ayarlarından Yemek Menüsü modülünü açın."
      />
    )
  return (
    <section
      aria-labelledby="yemekhane-alerji"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <style>{PRINT_CSS}</style>
      <header className="panel-heading grid gap-1 px-6 pt-6 pb-2" data-yemekhane-gizle="">
        <h2 id="yemekhane-alerji" className="text-lg font-semibold">
          Yemekhane alerji uyarısı
        </h2>
        <p className="text-sm text-muted-foreground">
          Servis sırasında, seçilen öğünde alerjisine denk gelen yemeği olan öğrenciler. Teşhis ve
          ilaç gösterilmez; her açılış kayda geçer.
        </p>
      </header>
      <div className="grid gap-6 px-6 pb-6">
        <HealthAccessGate
          scope={MEAL_ALLERGY_REASON_SCOPE}
          subject="Yemekhane alerji listesi"
          askOnOpen={false}
          suggested={MEAL_ALLERGY_SUGGESTED_REASON}
        >
          {(reason) => <Roster reason={reason} />}
        </HealthAccessGate>
      </div>
    </section>
  )
}

function Roster({ reason }: { reason: HealthAccessReason }) {
  const options = useMealAllergyOptions()
  if (options.error)
    return <QueryError error={options.error} onRetry={() => void options.refetch()} />
  const data = options.data?.data
  if (data === undefined) return <SummaryLoading />
  return <RosterView options={data} reason={reason} />
}

function RosterView({
  options,
  reason,
}: {
  options: MealAllergyOptions
  reason: HealthAccessReason
}) {
  const load = useLoadMealAllergyRoster()
  const kinds = options.mealKinds.length > 0 ? options.mealKinds : [...MEAL_KINDS]
  const [serviceDate, setServiceDate] = useState(options.today)
  const [mealKind, setMealKind] = useState<MealKind>(
    kinds.includes('lunch') ? 'lunch' : (kinds[0] ?? 'lunch'),
  )
  const [target, setTarget] = useState('')
  const [roster, setRoster] = useState<MealAllergyRoster | null>(null)
  const query = rosterQuery({ serviceDate, mealKind, target })

  async function show() {
    if (query === null) return
    const outcome = await load.submit({ query, reason })
    if (outcome.status === 'success') setRoster(outcome.data.data)
  }
  const reset = () => setRoster(null)

  return (
    <>
      <div className="flex flex-wrap items-end gap-3" data-yemekhane-gizle="">
        <div className="grid gap-2">
          <Label htmlFor="yemekhane-gun">Servis günü</Label>
          <Input
            id="yemekhane-gun"
            type="date"
            value={serviceDate}
            min={options.today}
            max={options.lastDate}
            disabled={load.isPending}
            onChange={(event) => {
              setServiceDate(event.target.value)
              reset()
            }}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="yemekhane-ogun">Öğün</Label>
          <NativeSelect
            id="yemekhane-ogun"
            value={mealKind}
            disabled={load.isPending}
            onChange={(event) => {
              const next = kinds.find((kind) => kind === event.target.value)
              if (next !== undefined) setMealKind(next)
              reset()
            }}
          >
            {kinds.map((kind) => (
              <NativeSelectOption key={kind} value={kind}>
                {MEAL_KIND_LABELS[kind]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="yemekhane-sinif">Sınıf ya da düzey</Label>
          <NativeSelect
            id="yemekhane-sinif"
            value={target}
            disabled={load.isPending}
            onChange={(event) => {
              setTarget(event.target.value)
              reset()
            }}
          >
            <NativeSelectOption value="">Seçin</NativeSelectOption>
            <NativeSelectOptGroup label="Sınıflar">
              {options.classes.map((item) => (
                <NativeSelectOption key={item.classId} value={classTarget(item.classId)}>
                  {item.className}
                </NativeSelectOption>
              ))}
            </NativeSelectOptGroup>
            {options.grades.length > 0 ? (
              <NativeSelectOptGroup label="Sınıf düzeyleri">
                {options.grades.map((grade) => (
                  <NativeSelectOption key={grade} value={gradeTarget(grade)}>
                    {`${String(grade)}. sınıfların tümü`}
                  </NativeSelectOption>
                ))}
              </NativeSelectOptGroup>
            ) : null}
          </NativeSelect>
        </div>
        <Button
          className="min-h-11"
          disabled={query === null || load.isPending}
          aria-busy={load.isPending || undefined}
          onClick={() => void show()}
        >
          Listeyi göster
        </Button>
        <Button
          variant="secondary"
          className="min-h-11"
          disabled={roster === null}
          onClick={() => window.print()}
        >
          <Icon name="Printer" size={17} aria-hidden="true" />
          Yazdır
        </Button>
      </div>
      {roster === null ? null : (
        <RosterList
          roster={roster}
          isToday={roster.serviceDate === options.today}
          onAcknowledged={(studentId, ack) =>
            setRoster((current) =>
              current === null ? current : withAcknowledgement(current, studentId, ack),
            )
          }
        />
      )}
    </>
  )
}

function RosterList({
  roster,
  isToday,
  onAcknowledged,
}: {
  roster: MealAllergyRoster
  isToday: boolean
  onAcknowledged: (
    studentId: string,
    ack: NonNullable<MealAllergyRosterStudent['acknowledgement']>,
  ) => void
}) {
  const title = rosterTitle(roster, MEAL_KIND_LABELS[roster.mealKind])
  return (
    <div className="grid gap-3" data-yemekhane-yazdir="">
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="text-sm text-muted-foreground">
        {roster.menus.length === 0
          ? 'Karşılaştırılan yayımlanmış menü yok.'
          : `Karşılaştırılan menü: ${roster.menus.map(menuScopeText).join(', ')}. ${String(roster.studentCount)} öğrenciden ${String(roster.students.length)} uyarı.`}
      </p>
      {roster.studentsWithoutMenu > 0 ? (
        <p className="text-sm text-muted-foreground">
          {`${String(roster.studentsWithoutMenu)} öğrencinin kampüsünde bu gün ve öğünde yayımlanmış yemek yok; karşılaştırma yapılmadı.`}
        </p>
      ) : null}
      {roster.students.length === 0 ? (
        <p className="text-sm">Bu seçimde alerji uyarısı olan öğrenci yok.</p>
      ) : (
        <ul aria-label="Alerji uyarıları" className="grid gap-3">
          {roster.students.map((row) => (
            <StudentItem
              key={row.studentId}
              row={row}
              roster={roster}
              isToday={isToday}
              onAcknowledged={onAcknowledged}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function StudentItem({
  row,
  roster,
  isToday,
  onAcknowledged,
}: {
  row: MealAllergyRosterStudent
  roster: MealAllergyRoster
  isToday: boolean
  onAcknowledged: (
    studentId: string,
    ack: NonNullable<MealAllergyRosterStudent['acknowledgement']>,
  ) => void
}) {
  const acknowledge = useAcknowledgeMealAllergy()
  async function mark() {
    const outcome = await acknowledge.submit({
      studentId: row.studentId,
      serviceDate: roster.serviceDate,
      mealKind: roster.mealKind,
    })
    if (outcome.status !== 'success') return
    const data = outcome.data.data
    onAcknowledged(row.studentId, {
      id: data.id,
      acknowledgedAt: data.acknowledgedAt,
      acknowledgedByMembershipId: data.acknowledgedByMembershipId,
      acknowledgedByName: data.acknowledgedByName,
    })
    notify.success(`${row.studentName} için uyarı işaretlendi.`)
  }
  return (
    <li
      aria-label={`${row.studentName} alerji uyarısı`}
      className="grid gap-2 border-b pb-3 text-sm"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{row.studentName}</span>
        <span className="text-muted-foreground">{row.className}</span>
        <StatusBadge
          text={severityText(row.severity)}
          tone={row.severity === 'severe' ? 'red' : row.severity === 'moderate' ? 'amber' : 'gray'}
        />
      </div>
      {row.profileUnreadable ? (
        <p>Sağlık bilgisi okunamadı; menüyle karşılaştırılamadı, elle kontrol edin.</p>
      ) : null}
      {row.conflicts.length > 0 ? (
        <ul aria-label={`${row.studentName} yemek uyarıları`} className="grid gap-1">
          {row.conflicts.map((conflict) => (
            <li key={conflict.position}>{conflictText(conflict)}</li>
          ))}
        </ul>
      ) : null}
      {row.unmatched.length > 0 ? (
        <ul aria-label={`${row.studentName} elle kontrol`} className="grid gap-1">
          {row.unmatched.map((item) => (
            <li key={item.allergyName}>{unmatchedText(item)}</li>
          ))}
        </ul>
      ) : null}
      {row.acknowledgement === null ? (
        isToday ? (
          <Button
            size="sm"
            variant="outline"
            className="min-h-11 justify-self-start"
            data-yemekhane-gizle=""
            disabled={acknowledge.isPending}
            aria-busy={acknowledge.isPending || undefined}
            aria-label={`${row.studentName} için uyarı görüldü, alternatif verildi`}
            onClick={() => void mark()}
          >
            Uyarı görüldü, alternatif verildi
          </Button>
        ) : null
      ) : (
        <p className="text-muted-foreground">{acknowledgementText(row.acknowledgement)}</p>
      )}
    </li>
  )
}
