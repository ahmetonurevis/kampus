import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  APPLICATION_DAILY_REJECTED_LIMIT,
  prospectApplicationSchema,
} from '@kampus/school-core/lib/prospect-application-form.ts'
import { APPLICATION_FORM_ROUTE } from '../src/pages/crm/application-form-route.ts'
import {
  applicationBody,
  applicationDefaults,
  applicationEmbedCode,
  applicationFailureText,
  applicationFormSchema,
  applicationFormUrl,
  applicationLimitWarning,
  applicationTheme,
  embeddingAllowed,
  isMinorApplicant,
  siteOriginFormSchema,
  type ApplicationFormValues,
} from '../src/pages/crm/prospect-application-form.ts'

// Siteye gömülen ön başvuru formu (ON-133; DOM-KAY-003, -004, -009; IST-145).

const SITE = 'https://okul.example'
const values = (overrides: Partial<ApplicationFormValues> = {}): ApplicationFormValues => ({
  ...applicationDefaults('b1'),
  name: 'Mert Ak',
  phone: '05321110099',
  interest: '7. sınıf',
  guardianName: 'Sevgi Ak',
  ...overrides,
})

const parse = (asksAgeGroup: boolean, overrides: Partial<ApplicationFormValues> = {}) =>
  applicationFormSchema(asksAgeGroup).parse(values(overrides))

test('DOM-KAY-009: gövde en az veriyi taşır ve sunucu şemasından geçer', () => {
  const body = applicationBody(parse(false), '3', false)
  assert.deepEqual(body, {
    name: 'Mert Ak',
    phone: '05321110099',
    branchId: 'b1',
    interest: '7. sınıf',
    guardianName: 'Sevgi Ak',
    privacyNoticeVersion: '3',
  })
  assert.equal(prospectApplicationSchema.safeParse(body).success, true)
})

test('DOM-KAY-009: dil okulunda yetişkin gövdesine veli adı girmez, yaş seçimi gider', () => {
  const adult = applicationBody(parse(true, { minor: 'no' }), '1', true)
  assert.equal(adult.minor, false)
  assert.equal('guardianName' in adult, false)
  const minor = applicationBody(parse(true, { minor: 'yes' }), '1', true)
  assert.equal(minor.minor, true)
  assert.equal(minor.guardianName, 'Sevgi Ak')
  assert.equal(isMinorApplicant('', false), true)
  assert.equal(isMinorApplicant('', true), false)
})

test('DOM-KAY-009: yaş seçimi, veli adı ve geçersiz telefon alan hatası verir', () => {
  const paths = (asksAgeGroup: boolean, overrides: Partial<ApplicationFormValues>) =>
    (applicationFormSchema(asksAgeGroup).safeParse(values(overrides)).error?.issues ?? []).map(
      (issue) => issue.path.join('.'),
    )
  assert.deepEqual(paths(true, {}), ['minor'])
  assert.deepEqual(paths(false, { guardianName: '' }), ['guardianName'])
  assert.deepEqual(paths(false, { phone: '123' }), ['phone'])
  assert.deepEqual(paths(true, { minor: 'no', guardianName: '' }), [])
})

test('DOM-KAY-004: onay varsayılan kapalıdır, yalnız işaretlenen kanal gider; e-postasız e-posta onayı hata', () => {
  assert.equal('marketingConsent' in applicationBody(parse(false), '1', false), false)
  const chosen = applicationBody(parse(false, { smsConsent: true }), '1', false)
  assert.deepEqual(chosen.marketingConsent, { sms: true })
  const invalid = applicationFormSchema(false).safeParse(values({ emailConsent: true }))
  assert.deepEqual(
    invalid.error?.issues.map((issue) => issue.path.join('.')),
    ['emailConsent'],
  )
})

test('IST-145: gizli alan yalnız doluysa gövdeye girer', () => {
  assert.equal('website' in applicationBody(parse(false), '1', false), false)
  assert.equal(applicationBody(parse(false, { website: 'x' }), '1', false).website, 'x')
})

test('IST-145: gömme kodu dış betik ve çerez içermez, köken korunur, başlık kaçışlanır', () => {
  const url = applicationFormUrl('https://kampus.example/', 'abc_-')
  assert.equal(url, 'https://kampus.example/basvuru/abc_-')
  const code = applicationEmbedCode(url, 'Ön "başvuru"', false)
  assert.match(code, /^<iframe src="https:\/\/kampus\.example\/basvuru\/abc_-" /)
  assert.match(code, /title="Ön &quot;başvuru&quot;"/)
  // `allow-same-origin` olmadan Origin: null olur, CSRF denetimi gönderimi reddeder.
  assert.match(code, /sandbox="allow-forms allow-scripts allow-same-origin"/)
  assert.doesNotMatch(code, /<script|allow-top-navigation/)
  assert.match(applicationEmbedCode(url, 'x', true), /\?tema=koyu"/)
})

test('IST-145: çerçeve yalnız kurum sitesinde açılır; doğrudan bağlantı açıktır', () => {
  assert.equal(embeddingAllowed(false, [], null), true)
  assert.equal(embeddingAllowed(true, [SITE], SITE), true)
  assert.equal(embeddingAllowed(true, ['https://kotu.example'], SITE), false)
  assert.equal(embeddingAllowed(true, [SITE, 'https://kotu.example'], SITE), false)
  assert.equal(embeddingAllowed(true, [SITE], null), false)
  // `ancestorOrigins` olmayan tarayıcıda karar sunucu başlığına kalır.
  assert.equal(embeddingAllowed(true, null, SITE), true)
})

test('ON-133: site adresi alanı boş metni kabul eder, kök adresi normalleştirir', () => {
  assert.equal(siteOriginFormSchema.parse({ siteOrigin: '' }).siteOrigin, '')
  assert.equal(siteOriginFormSchema.parse({ siteOrigin: 'https://Okul.example/' }).siteOrigin, SITE)
  const invalid = siteOriginFormSchema.safeParse({ siteOrigin: 'http://okul.example' })
  assert.match(invalid.error?.issues[0]?.message ?? '', /https:\/\/okul\.example biçiminde/)
})

test('ON-133: tema gömme kodundan gelir, verilmezse tarayıcı kararı kalır; rota sabiti', () => {
  assert.equal(applicationTheme(''), null)
  assert.equal(applicationTheme('?tema=koyu'), 'dark')
  assert.equal(applicationTheme('?tema=acik'), 'light')
  assert.equal(applicationTheme('?tema=diger'), null)
  assert.equal(APPLICATION_FORM_ROUTE, 'basvuru/:formKey')
})

test('DOM-KAY-002 K-23: tavan dolmadıysa uyarı yok; dolunca alınamayan sayı yazılır', () => {
  assert.equal(applicationLimitWarning({ reached: false, rejected: 0 }), null)
  assert.match(applicationLimitWarning({ reached: true, rejected: 0 }) ?? '', /tavanı doldu/)
  assert.doesNotMatch(applicationLimitWarning({ reached: true, rejected: 0 }) ?? '', /alınamadı/)
  assert.match(
    applicationLimitWarning({ reached: true, rejected: 3 }) ?? '',
    /Bugün ön başvuru tavanı doldu, 3 başvuru alınamadı\./,
  )
})

test('DOM-KAY-002 K-23: sayım üst sınıra ulaşınca kesin sayı gibi yazılmaz', () => {
  const below = applicationLimitWarning({
    reached: true,
    rejected: APPLICATION_DAILY_REJECTED_LIMIT - 1,
  })
  assert.match(below ?? '', /doldu, 999 başvuru/)
  const atLimit = applicationLimitWarning({
    reached: true,
    rejected: APPLICATION_DAILY_REJECTED_LIMIT,
  })
  assert.match(atLimit ?? '', /en az 1\.000 başvuru/)
})

test('DOM-KAY-002 K-23: dolu tavanın sunucu iletisi başvurana yazılır; alan hatası alanda kalır', () => {
  const message = 'Başvurunuz şu anda alınamadı. Lütfen kurumla doğrudan iletişime geçin.'
  assert.equal(applicationFailureText({ status: 422, message, issues: [] }), message)
  assert.equal(applicationFailureText({ status: 422, message, issues: [{ path: 'name' }] }), '')
  assert.match(applicationFailureText({ status: 429, message }), /çok fazla başvuru/)
})
