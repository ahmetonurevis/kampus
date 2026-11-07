// Siteye gömülen ön başvuru formunun saf yardımcıları (ON-133; DOM-KAY-003, -004, -009; IST-145):
// form şeması, gövde, gömme kodu ve gömülü açılış denetimi. Sunucu kuralları core
// `lib/prospect-application-form.ts`'tedir; burada yalnız ekran alanları API gövdesine çevrilir.
import { z } from 'zod'
import type { ProspectApplicationBody } from '@kampus/react-shared/use-prospect-application-form.ts'
import {
  APPLICATION_DAILY_REJECTED_LIMIT,
  prospectApplicationSchema,
  siteOriginSchema,
} from '@kampus/school-core/lib/prospect-application-form.ts'
import { APPLICATION_FORM_PATH } from './application-form-route.ts'

const { shape } = prospectApplicationSchema

/** Boş alan "yok" sayılır (iletişim e-postası gibi); şemanın kendi iletisi geçerlidir. */
export function applicationFormSchema(asksAgeGroup: boolean) {
  return z
    .object({
      name: shape.name,
      phone: shape.phone,
      email: shape.email,
      branchId: shape.branchId,
      interest: shape.interest,
      minor: z.enum(['', 'yes', 'no']),
      guardianName: z.string().trim().max(80, 'En fazla 80 karakter girebilirsiniz.'),
      smsConsent: z.boolean(),
      emailConsent: z.boolean(),
      callConsent: z.boolean(),
      website: z.string(),
    })
    .superRefine((values, context) => {
      if (asksAgeGroup && values.minor === '')
        context.addIssue({
          code: 'custom',
          path: ['minor'],
          message: '18 yaş altı olup olmadığını seçin.',
        })
      if (isMinorApplicant(values.minor, asksAgeGroup) && values.guardianName.length < 2)
        context.addIssue({
          code: 'custom',
          path: ['guardianName'],
          message: 'Velinin adını yazın.',
        })
      if (values.emailConsent && (values.email ?? '') === '')
        context.addIssue({
          code: 'custom',
          path: ['emailConsent'],
          message: 'E-posta onayı için e-posta adresi girin.',
        })
    })
}
export type ApplicationFormValues = z.input<ReturnType<typeof applicationFormSchema>>
export type ApplicationFormOutput = z.output<ReturnType<typeof applicationFormSchema>>

/** Okulda aday her zaman 18 yaş altı sayılır; kurs türlerinde seçilir (DOM-KAY-009). */
export function isMinorApplicant(minor: string, asksAgeGroup: boolean): boolean {
  return asksAgeGroup ? minor === 'yes' : true
}

export const applicationDefaults = (branchId: string): ApplicationFormValues => ({
  name: '',
  phone: '',
  email: '',
  branchId,
  interest: '',
  minor: '',
  guardianName: '',
  smsConsent: false,
  emailConsent: false,
  callConsent: false,
  website: '',
})

/**
 * API gövdesi. Yaş seçimi yalnız sorulan kurumda, veli adı yalnız 18 yaş altında gider (yetişkinde
 * veli verisi saklanmaz); onaylar yalnız işaretlenen kanallarda gönderilir, gerisi kapalıdır.
 */
export function applicationBody(
  values: ApplicationFormOutput,
  noticeVersion: string,
  asksAgeGroup: boolean,
): ProspectApplicationBody {
  const minor = isMinorApplicant(values.minor, asksAgeGroup)
  const marketingConsent = {
    ...(values.smsConsent ? { sms: true } : {}),
    ...(values.emailConsent ? { email: true } : {}),
    ...(values.callConsent ? { call: true } : {}),
  }
  return {
    name: values.name,
    phone: values.phone,
    ...(values.email ? { email: values.email } : {}),
    branchId: values.branchId,
    interest: values.interest,
    ...(asksAgeGroup ? { minor } : {}),
    ...(minor ? { guardianName: values.guardianName } : {}),
    privacyNoticeVersion: noticeVersion,
    ...(Object.keys(marketingConsent).length > 0 ? { marketingConsent } : {}),
    ...(values.website === '' ? {} : { website: values.website }),
  }
}

/** Sayfa adresi: kök adres uygulamanın yayınlandığı yerden gelir, sabit alan adı yazılmaz. */
export function applicationFormUrl(base: string, formKey: string): string {
  return new URL(`${APPLICATION_FORM_PATH}/${encodeURIComponent(formKey)}`, base).href
}

/**
 * Yöneticinin kopyalayacağı iframe kodu. Üçüncü taraf betik yoktur. `sandbox` köken korur: istek
 * kendi kökenimizden gitmezse `Origin: null` CSRF denetiminde reddedilir. Gönderim yalnız tek
 * çerçeve içinde kalır; üst sayfaya gezinme izni verilmez.
 */
export function applicationEmbedCode(url: string, title: string, dark: boolean): string {
  const src = dark ? `${url}?tema=koyu` : url
  return `<iframe src="${src}" title="${title.replaceAll('"', '&quot;')}" width="100%" height="820" style="border:0" loading="lazy" referrerpolicy="no-referrer" sandbox="allow-forms allow-scripts allow-same-origin"></iframe>`
}

/** Yönetici formundaki site adresi: boş metin adresi kaldırır. */
export const siteOriginFormSchema = z.object({
  siteOrigin: z.string().transform((value, context) => {
    if (value.trim() === '') return ''
    const parsed = siteOriginSchema.safeParse(value)
    if (parsed.success) return parsed.data
    // `z.union` ayrıntıyı genel iletiye çevirirdi; alanda şemanın kendi iletisi görünür.
    context.addIssue({ code: 'custom', message: parsed.error.issues[0]?.message ?? '' })
    return z.NEVER
  }),
})

/**
 * Sayfa çerçeve içinde açıldıysa bütün üst pencereler kurumun sitesi olmalıdır. Asıl koruma sunucu
 * başlığı `frame-ancestors`'tır; bu denetim onu destekler (`ancestorOrigins` olmayan tarayıcıda
 * karar başlığa kalır). Çerçevesiz doğrudan bağlantı her zaman açılır.
 */
export function embeddingAllowed(
  framed: boolean,
  ancestors: readonly string[] | null,
  siteOrigin: string | null,
): boolean {
  if (!framed || ancestors === null) return true
  return siteOrigin !== null && ancestors.every((origin) => origin === siteOrigin)
}

/**
 * `?tema=koyu|acik`: kurum sitesi kendi temasını gömme kodunda seçer; tercih saklanmaz. Verilmezse
 * `null`: tarayıcıdaki tema kararı (varsayılan açık) geçerli kalır.
 */
export function applicationTheme(search: string): 'dark' | 'light' | null {
  const theme = new URLSearchParams(search).get('tema')
  return theme === 'koyu' ? 'dark' : theme === 'acik' ? 'light' : null
}

/**
 * Gönderim hatasının başvurana iletisi. Alan hatası alanında görünür; dolu kurum tavanı dahil diğer
 * hatalarda sunucunun Türkçe iletisi yazılır (`application_unavailable`, K-23).
 */
export function applicationFailureText(error: {
  status: number
  message: string
  issues?: readonly unknown[] | undefined
}): string {
  if (error.status === 429)
    return 'Kısa sürede çok fazla başvuru gönderildi. Lütfen biraz sonra yeniden deneyin.'
  return error.issues?.length ? '' : error.message
}

/**
 * Yöneticinin bugünkü tavan uyarısı (DOM-KAY-002, K-23); tavan dolmadıysa `null`. Sayı gönderimdir,
 * kişi değildir ve üst sınıra ulaşınca "en az" yazılır: sayım orada durur.
 */
export function applicationLimitWarning(limit: { reached: boolean; rejected: number }) {
  if (!limit.reached) return null
  const count = limit.rejected.toLocaleString('tr-TR')
  return limit.rejected === 0
    ? 'Bugün ön başvuru tavanı doldu; yeni başvuru bugün alınamayacak.'
    : `Bugün ön başvuru tavanı doldu, ${limit.rejected >= APPLICATION_DAILY_REJECTED_LIMIT ? 'en az ' : ''}${count} başvuru alınamadı. Başvuranlara kurumla iletişime geçmeleri söylendi; bilgileri saklanmadı.`
}
