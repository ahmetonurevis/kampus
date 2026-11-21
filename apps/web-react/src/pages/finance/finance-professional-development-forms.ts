import { z } from 'zod'
import type {
  ProfessionalDevelopmentProgram,
  ProfessionalDevelopmentProgramBody,
} from '@kampus/react-shared/use-finance-professional-development.ts'
import {
  professionalDevelopmentProgramInputSchema,
  PROFESSIONAL_DEVELOPMENT_KINDS,
  type ProfessionalDevelopmentKind,
} from '@kampus/school-core/lib/finance-professional-development.ts'
import { STAFF_ROLES, type StaffRole } from '@kampus/school-core/lib/staff-accounts.ts'

// Mesleki gelişim katalog formunun saf mantığı (DOM-FIN-125; ON-214): metin alanları gövdeye
// çevrilir (saat ondalık virgüllü, ücret TL), doğrulama core şemasıyla yapılır ve hata alana düşer.

export type ProgramFormValues = {
  name: string
  kind: ProfessionalDevelopmentKind
  provider: string
  durationHours: string
  ongoing: boolean
  startDate: string
  endDate: string
  location: string
  onlineUrl: string
  audienceRoles: StaffRole[]
  audienceBranches: string
  feeTl: string
  capacity: string
}

const FORM_FIELDS = [
  'name',
  'kind',
  'provider',
  'durationHours',
  'ongoing',
  'startDate',
  'endDate',
  'location',
  'onlineUrl',
  'audienceRoles',
  'audienceBranches',
  'feeTl',
  'capacity',
] as const satisfies readonly (keyof ProgramFormValues)[]
type FormField = (typeof FORM_FIELDS)[number]

/** Sunucu ya da core hata yolunu form alanına çevirir; karşılığı yoksa `null` (kök hata). */
export function programFormField(name: string): FormField | null {
  if (name === 'feeCents' || name === 'costCenterId') return 'feeTl'
  return (FORM_FIELDS as readonly string[]).includes(name) ? (name as FormField) : null
}

export const emptyProgramForm = (): ProgramFormValues => ({
  name: '',
  kind: 'course',
  provider: '',
  durationHours: '',
  ongoing: false,
  startDate: '',
  endDate: '',
  location: '',
  onlineUrl: '',
  audienceRoles: [],
  audienceBranches: '',
  feeTl: '',
  capacity: '',
})

const decimalText = (value: number) => String(value).replace('.', ',')

/** Düzeltme formu kayıttan doldurulur. */
export function programFormFrom(program: ProfessionalDevelopmentProgram): ProgramFormValues {
  return {
    name: program.name,
    kind: program.kind,
    provider: program.provider,
    durationHours: decimalText(program.durationHours),
    ongoing: program.ongoing,
    startDate: program.startDate ?? '',
    endDate: program.endDate ?? '',
    location: program.location ?? '',
    onlineUrl: program.onlineUrl ?? '',
    audienceRoles: [...program.audienceRoles],
    audienceBranches: program.audienceBranches.join(', '),
    feeTl: program.feeCents === null ? '' : decimalText(program.feeCents / 100),
    capacity: program.capacity === null ? '' : String(program.capacity),
  }
}

/** "1.250,50" ya da "12,5" → sayı; boşsa `null`, sayı değilse `NaN` (core şeması reddeder). */
export function parseDecimal(text: string): number | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const normalized = trimmed.replace(/\./g, '').replace(',', '.')
  return /^-?\d+(\.\d+)?$/.test(normalized) ? Number(normalized) : Number.NaN
}

/** Gövde: sürekli eğitimde tarih gitmez; ücret TL'den kuruşa; branşlar virgülle ayrılır. */
export function programBody(values: ProgramFormValues): ProfessionalDevelopmentProgramBody {
  const fee = parseDecimal(values.feeTl)
  const capacity = parseDecimal(values.capacity)
  return {
    name: values.name,
    kind: values.kind,
    provider: values.provider,
    durationHours: parseDecimal(values.durationHours) ?? Number.NaN,
    ongoing: values.ongoing,
    startDate: values.ongoing || values.startDate === '' ? null : values.startDate,
    endDate: values.ongoing || values.endDate === '' ? null : values.endDate,
    location: values.location,
    onlineUrl: values.onlineUrl,
    audienceRoles: values.audienceRoles,
    audienceBranches: values.audienceBranches
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item !== ''),
    feeCents: fee === null ? null : Math.round(fee * 100),
    capacity,
  }
}

export const programFormSchema = z
  .object({
    name: z.string(),
    kind: z.enum(PROFESSIONAL_DEVELOPMENT_KINDS),
    provider: z.string(),
    durationHours: z.string(),
    ongoing: z.boolean(),
    startDate: z.string(),
    endDate: z.string(),
    location: z.string(),
    onlineUrl: z.string(),
    audienceRoles: z.array(z.enum(STAFF_ROLES)),
    audienceBranches: z.string(),
    feeTl: z.string(),
    capacity: z.string(),
  })
  .superRefine((values, context) => {
    const result = professionalDevelopmentProgramInputSchema.safeParse(programBody(values))
    if (result.success) return
    const seen = new Set<string>()
    for (const issue of result.error.issues) {
      const field = programFormField(String(issue.path[0] ?? '')) ?? 'name'
      if (seen.has(field)) continue
      seen.add(field)
      context.addIssue({ code: 'custom', path: [field], message: issue.message })
    }
  })

/** Tarih sütunu: "Sürekli" ya da gün aralığı. */
export function programDatesText(
  program: Pick<ProfessionalDevelopmentProgram, 'ongoing' | 'startDate' | 'endDate'>,
  format: (day: string) => string,
): string {
  if (program.ongoing || program.startDate === null) return 'Sürekli'
  if (program.endDate === null || program.endDate === program.startDate)
    return format(program.startDate)
  return `${format(program.startDate)} – ${format(program.endDate)}`
}

/** Kontenjan sütunu: "3 / 20" ya da sınırsızsa "3 kişi". */
export const capacityText = (
  program: Pick<ProfessionalDevelopmentProgram, 'enrolledCount' | 'capacity'>,
) =>
  program.capacity === null
    ? `${String(program.enrolledCount)} kişi`
    : `${String(program.enrolledCount)} / ${String(program.capacity)}`
