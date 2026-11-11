// Materyal seti formları (DOM-FIN-080; ON-232). Alan kuralları core şemalarından: sette ad, eğitim
// yılı, hedef (okulda sınıf düzeyi, dil okulunda kur) ve kalemler; teslimde depo, gün, teslim alan ve
// kâğıt imza işareti. Formda sayılar metindir; gövdeye tam sayı gider. Stok yeterliliği, mükerrer
// teslim ve kısıtlı veli sunucuda kurum kilidi altında denetlenir.
import { z } from 'zod'
import type {
  CreateMaterialSetBody,
  MaterialDeliveryBody,
  MaterialSetDetail,
} from '@kampus/react-shared/use-finance-material-sets.ts'
import { daySchema } from '@kampus/school-core/lib/domain.ts'
import {
  MATERIAL_DELIVERY_NOTE_MAX,
  MATERIAL_RECIPIENT_KINDS,
  MATERIAL_RECIPIENT_NAME_MAX,
  MATERIAL_SET_GRADE_MAX,
  MATERIAL_SET_GRADE_MIN,
  MATERIAL_SET_ITEM_QUANTITY_MAX,
  MATERIAL_SET_ITEMS_MAX,
  MATERIAL_SET_NAME_MAX,
} from '@kampus/school-core/lib/finance-material-sets.ts'

const YEAR = /^\d{4}$/
const COUNT = /^\d{1,3}$/

/** Okulda seçilebilen sınıf düzeyleri (5–12). */
export const MATERIAL_GRADE_OPTIONS = Array.from(
  { length: MATERIAL_SET_GRADE_MAX - MATERIAL_SET_GRADE_MIN + 1 },
  (_, index) => {
    const grade = MATERIAL_SET_GRADE_MIN + index
    return { value: String(grade), label: `${String(grade)}. sınıf` }
  },
)

// --- Set -----------------------------------------------------------------------------------------

export const materialSetFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'En az 2 karakter girin.')
    .max(
      MATERIAL_SET_NAME_MAX,
      `En fazla ${String(MATERIAL_SET_NAME_MAX)} karakter girebilirsiniz.`,
    ),
  academicYear: z.string().trim().regex(YEAR, 'Eğitim yılını dört haneli yazın.'),
  /** Okulda sınıf düzeyi, dil okulunda kur kimliği; boşsa bütün öğrenciler. */
  target: z.string(),
  items: z
    .array(
      z.object({
        stockItemId: z.string().min(1, 'Stok kartını seçin.'),
        quantity: z
          .string()
          .trim()
          .regex(COUNT, 'Adedi tam sayı girin.')
          .refine(
            (value) => Number(value) >= 1 && Number(value) <= MATERIAL_SET_ITEM_QUANTITY_MAX,
            `Adet 1–${String(MATERIAL_SET_ITEM_QUANTITY_MAX)} arasında olmalıdır.`,
          ),
      }),
    )
    .min(1, 'Sete en az bir stok kartı ekleyin.')
    .max(MATERIAL_SET_ITEMS_MAX, `Sette en çok ${String(MATERIAL_SET_ITEMS_MAX)} kalem olabilir.`)
    .superRefine((items, ctx) => {
      const seen = new Set<string>()
      items.forEach((item, index) => {
        if (item.stockItemId !== '' && seen.has(item.stockItemId))
          ctx.addIssue({
            code: 'custom',
            path: [index, 'stockItemId'],
            message: 'Aynı stok kartı sette bir kez yer alır; adedi artırın.',
          })
        seen.add(item.stockItemId)
      })
    }),
})
export type MaterialSetFormValues = z.input<typeof materialSetFormSchema>

export function materialSetDefaults(
  academicYear: number,
  set?: MaterialSetDetail,
): MaterialSetFormValues {
  return {
    name: set?.name ?? '',
    academicYear: String(set?.academicYear ?? academicYear),
    target:
      set?.gradeLevel !== null && set?.gradeLevel !== undefined
        ? String(set.gradeLevel)
        : (set?.courseId ?? ''),
    items: set?.items.map((item) => ({
      stockItemId: item.stockItemId,
      quantity: String(item.quantity),
    })) ?? [{ stockItemId: '', quantity: '1' }],
  }
}

/** Form → gövde: hedef kurum türüne göre sınıf düzeyi ya da kurdur. */
export function materialSetBody(
  values: MaterialSetFormValues,
  institutionType: string,
): CreateMaterialSetBody {
  const target = values.target.trim()
  const language = institutionType === 'language_school'
  return {
    name: values.name.trim(),
    academicYear: Number(values.academicYear),
    gradeLevel: !language && target !== '' ? Number(target) : null,
    courseId: language && target !== '' ? target : null,
    items: values.items.map((item) => ({
      stockItemId: item.stockItemId,
      quantity: Number(item.quantity),
    })),
  }
}

/** Sunucu alan yolu → form alanı (`items.0.stockItemId` dahil); hedef iki alanı tek seçimdedir. */
export function materialSetFormField(
  name: string,
): 'name' | 'academicYear' | 'target' | `items.${number}.stockItemId` | 'items' | undefined {
  if (name === 'name' || name === 'academicYear') return name
  if (name === 'gradeLevel' || name === 'courseId') return 'target'
  const item = /^items\.(\d+)\.stockItemId$/.exec(name)
  if (item) return `items.${Number(item[1])}.stockItemId`
  return name.startsWith('items') ? 'items' : undefined
}

// --- Teslim --------------------------------------------------------------------------------------

export const materialDeliveryFormSchema = z
  .object({
    warehouseId: z.string().min(1, 'Depoyu seçin.'),
    deliveryDate: daySchema,
    recipientKind: z.enum(MATERIAL_RECIPIENT_KINDS, 'Teslim alanı seçin.'),
    guardianId: z.string(),
    recipientName: z
      .string()
      .trim()
      .max(
        MATERIAL_RECIPIENT_NAME_MAX,
        `En fazla ${String(MATERIAL_RECIPIENT_NAME_MAX)} karakter girebilirsiniz.`,
      ),
    signatureReceived: z.boolean(),
    note: z
      .string()
      .trim()
      .max(
        MATERIAL_DELIVERY_NOTE_MAX,
        `En fazla ${String(MATERIAL_DELIVERY_NOTE_MAX)} karakter girebilirsiniz.`,
      ),
  })
  .superRefine((value, ctx) => {
    if (value.recipientKind === 'guardian' && value.guardianId === '')
      ctx.addIssue({ code: 'custom', path: ['guardianId'], message: 'Veliyi seçin.' })
    if (value.recipientKind === 'other' && value.recipientName.trim().length < 2)
      ctx.addIssue({
        code: 'custom',
        path: ['recipientName'],
        message: 'Teslim alanın adını en az 2 karakterle yazın.',
      })
  })
export type MaterialDeliveryFormValues = z.input<typeof materialDeliveryFormSchema>

export function materialDeliveryDefaults(
  today: string,
  warehouseId = '',
): MaterialDeliveryFormValues {
  return {
    warehouseId,
    deliveryDate: today,
    recipientKind: 'student',
    guardianId: '',
    recipientName: '',
    signatureReceived: true,
    note: '',
  }
}

/** Form → gövde: teslim alan türünün taşımadığı alan boş gider. */
export function materialDeliveryBody(
  studentId: string,
  values: MaterialDeliveryFormValues,
): MaterialDeliveryBody {
  const note = values.note.trim()
  return {
    studentId,
    warehouseId: values.warehouseId,
    deliveryDate: values.deliveryDate,
    recipientKind: values.recipientKind,
    guardianId: values.recipientKind === 'guardian' ? values.guardianId : null,
    recipientName: values.recipientKind === 'other' ? values.recipientName.trim() : null,
    signatureReceived: values.signatureReceived,
    note: note === '' ? null : note,
  }
}

const DELIVERY_FIELDS = [
  'warehouseId',
  'deliveryDate',
  'recipientKind',
  'guardianId',
  'recipientName',
  'signatureReceived',
  'note',
] as const
export const materialDeliveryFormField = (name: string) =>
  DELIVERY_FIELDS.find((field) => field === name)
