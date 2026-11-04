// Sözleşme PDF'i (API modu; IST-092, DOM-FIN-010, -051): belge kaydı ve ona bağlı öğrenci, sınıf,
// veli, kampüs ve taksit kayıtları sunucudan kapsamlı okunur, belge verisi core `documentData` ile
// kurulur (web `use-document-pdf.ts` ile aynı veri), metin web şablonunun
// (`apps/web-react/src/lib/pdf/templates/contract.ts`) bölümleriyle HTML'e yazılır ve telefonda
// `expo-print` ile PDF'e çevrilir. Çevrimdışı demo belgesi (`lib/files.ts` `documentHtml`) demo
// verisine bağlı olduğu için burada kullanılmaz.
//
// Dosya React Native'e bağlanmaz; Node birim testi HTML'i doğrudan sınar.
import type { KampusClient } from '@kampus/api-client/client.ts'
import {
  fetchAllCollectionPages,
  fetchCollectionItem,
  isUnreadableCollectionError,
} from '@kampus/react-shared/collections.ts'
import type { State } from '@kampus/school-core/data/seed.ts'
import {
  CONTRACT_APPROVAL_METHOD_LABELS,
  CONTRACT_STATUS_LABELS,
  contractPlanLines,
  contractStatus,
  SIGNATORY_ROLE_LABELS,
  type ContractPlanLine,
} from '@kampus/school-core/lib/contract-status.ts'
import { documentData, type DocumentDataMap } from '@kampus/school-core/lib/document-data.ts'
import { DomainError } from '@kampus/school-core/lib/errors.ts'
import {
  FEE_DISCOUNT_KIND_LABELS,
  FEE_ITEM_KIND_LABELS,
} from '@kampus/school-core/lib/fee-tariffs.ts'
import { dateLabel, money, timeLabel } from '@kampus/school-core/lib/format.ts'
import { COLLECTION_NAMES } from '@kampus/school-core/modules/collection-modules.ts'

export type ContractDocumentData = DocumentDataMap['contract']
type Contract = NonNullable<ContractDocumentData['contract']>
type StudentRecord = State['students'][number]

/** Okunamayan (yetki/yok) yardımcı kaydı `undefined` yapar; başka hata yeniden fırlatılır. */
async function optional<T>(read: Promise<T>): Promise<T | undefined> {
  try {
    return await read
  } catch (error) {
    if (isUnreadableCollectionError(error)) return undefined
    throw error
  }
}

/**
 * Belge kayıtlarından core `State` kurar: okunmayan koleksiyonlar boş dizidir. Koleksiyon kayıtları
 * sunucudan core tipinde gelir (aynı Zod şemaları); kalan alanlar belge hesabında kullanılmaz.
 */
function documentState(records: Partial<Record<keyof State, readonly unknown[]>>): State {
  const collections = Object.fromEntries(
    COLLECTION_NAMES.map((name) => [name, records[name] ?? []]),
  )
  return {
    ...collections,
    version: 3,
    createdAt: '',
    preferences: {},
    modules: {},
  } as unknown as State
}

/**
 * Sözleşme belgesinin verisi (web `loadDocumentState` sözleşme dalı): sözleşme ve öğrenci okunamazsa
 * belge açılmaz; sınıf, veli ve kampüs okunamazsa belge o alanı "—" yazar. Ek 1 için öğrencinin
 * bütün taksitleri okunur, hangilerinin sözleşmeye ait olduğunu core seçer (DOM-FIN-012).
 */
export async function loadContractDocument(
  client: KampusClient,
  contractId: string,
  signal?: AbortSignal,
): Promise<ContractDocumentData> {
  const read = async <TRecord>(collection: keyof State, id: string) =>
    (await fetchCollectionItem<TRecord>(client, collection, id, signal)).record
  const contract = await read<State['contracts'][number]>('contracts', contractId)
  const student = await read<StudentRecord>('students', contract.studentId)
  // Sözleşme kendi sınıfını taşır; yoksa öğrencinin güncel sınıfı.
  const classId = contract.classId || student.classId
  const [classroom, parent, invoices] = await Promise.all([
    classId ? optional(read<State['classes'][number]>('classes', classId)) : undefined,
    student.parentId
      ? optional(read<State['parents'][number]>('parents', student.parentId))
      : undefined,
    fetchAllCollectionPages<State['invoices'][number]>(
      client,
      'invoices',
      { filters: { studentId: student.id } },
      signal,
    ),
  ])
  const branch = classroom
    ? await optional(read<State['branches'][number]>('branches', classroom.branchId))
    : undefined
  const state = documentState({
    contracts: [contract],
    students: [student],
    classes: classroom ? [classroom] : [],
    parents: parent ? [parent] : [],
    branches: branch ? [branch] : [],
    invoices: invoices.map((row) => row.record),
  })
  return documentData(state, 'contract', contractId)
}

/** Kullanıcıya gösterilen ileti: core'un Türkçe kullanıcı hatası aynen, teknik hata genel ileti. */
export function contractDocumentErrorMessage(error: unknown): string {
  return error instanceof DomainError
    ? error.message
    : 'Sözleşme belgesi hazırlanamadı. Lütfen yeniden deneyin.'
}

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}
/** Kayıttan gelen her metin HTML'e kaçışlı yazılır (başlık, ad, gerekçe kullanıcı girdisidir). */
export const escapeHtml = (value: unknown) =>
  String(value ?? '—').replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char)
/** CSS `content` dizesi: tırnak, ters bölü ve `<` kaçışlı (`</style>` kapanamaz), satır sonu yok. */
const cssString = (value: string) =>
  `"${value.replace(/[\\"]/g, '\\$&').replace(/</g, '\\3C ').replace(/\s+/g, ' ')}"`

const day = (value: string) => dateLabel(value, { year: 'numeric' })
const FEE_LABELS: Readonly<Record<string, string>> = { ...FEE_ITEM_KIND_LABELS }
const DISCOUNT_LABELS: Readonly<Record<string, string>> = { ...FEE_DISCOUNT_KIND_LABELS }
const extraLabel = (kind: string) => FEE_LABELS[kind] ?? kind
const discountLabel = (kind: string) => DISCOUNT_LABELS[kind] ?? kind

type Fields = readonly (readonly [string, string])[]

const fieldsTable = (fields: Fields) =>
  `<table class="fields"><tbody>${fields
    .map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`)
    .join('')}</tbody></table>`
const paragraph = (text: string, muted = false) =>
  `<p${muted ? ' class="muted"' : ''}>${escapeHtml(text)}</p>`
const section = (title: string) => `<h3>${escapeHtml(title)}</h3>`

/**
 * Ek 1 satırları (web şablonu `planRows`): onaylı sürümde onay anının kopyası, ek protokol
 * taslağında önerilen plan; onaysız sözleşmede güncel taksitler. Kopyadaki taksit güncel planda
 * yoksa durum sütunu bunu söyler; tutar onaylanan tutardır.
 */
function planRows(contract: Contract, data: ContractDocumentData): (readonly string[])[] {
  const lines = contractPlanLines(contract)
  if (lines === null)
    return data.invoices.map((item) => [
      `${String(item.installment)}. taksit`,
      day(item.dueDate),
      money(item.amount),
      item.status,
    ])
  const live = new Map<string, string>(data.invoices.map((item) => [item.id, item.status]))
  const status = (line: ContractPlanLine) =>
    line.invoiceId === null ? 'Öneri' : (live.get(line.invoiceId) ?? 'Güncel planda yok')
  return lines.map((line) => [
    line.feeKind && line.feeKind !== 'tuition'
      ? extraLabel(line.feeKind)
      : `${String(line.installment)}. taksit`,
    day(line.dueDate),
    money(line.amount),
    status(line),
  ])
}

/** Sözleşmenin tarafı: veli ya da 18 yaş ve üstü kursiyer (DOM-KAY-012). */
function payerLabel(contract: Contract, data: ContractDocumentData): string {
  if (contract.payer === 'student') return `Kursiyer · ${data.student.name}`
  return `Veli · ${contract.approval?.payerName || data.parent?.name || 'Ad soyad'}`
}

/** İmza yetkilisi: kurucu ya da kurucu temsilcisi (ÖÖKY m.31/4); işlenmediyse boş imza yeri. */
function signatoryLabel(contract: Contract): string {
  const signatory = contract.signatory
  return signatory
    ? `${SIGNATORY_ROLE_LABELS[signatory.role]} · ${signatory.name}`
    : 'Kurum yetkilisi · Ad soyad / İmza'
}

export interface ContractDocumentOptions {
  /** Etkin kurumun adı (oturumdan). */
  institution: string
  generatedAt: Date
}

const style = (reference: string) => `@page{size:A4;margin:18mm 16mm 20mm}
@page{@bottom-left{content:${cssString(reference)};font:9px sans-serif;color:#56647A}@bottom-right{content:"Sayfa " counter(page) " / " counter(pages);font:9px sans-serif;color:#56647A}}
body{font:12px/1.55 'Noto Sans',sans-serif;color:#233044;margin:0}
header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1px solid #DDE3EE;padding-bottom:12px;margin-bottom:18px}
.brand{font:700 22px 'Noto Serif',serif;color:#1E3A8A;letter-spacing:.04em}.brand b{color:#F97316}
.institution{font-size:10px;color:#56647A;text-transform:uppercase;letter-spacing:.08em}
.badge{font-size:10px;font-weight:700;color:#9A3412;background:#FFF1E7;padding:5px 9px;border-radius:4px}
h1{font:700 11px sans-serif;color:#1E3A8A;letter-spacing:.08em;margin:0 0 4px}
h2{font:700 19px 'Noto Serif',serif;margin:0 0 4px;overflow-wrap:anywhere}
h3{font-size:12px;color:#1E3A8A;margin:22px 0 6px;text-transform:uppercase;letter-spacing:.04em}
.meta{color:#56647A;font-size:11px;margin:0}
p{margin:8px 0;overflow-wrap:anywhere}.muted{color:#56647A;font-size:10px}
table{border-collapse:collapse;width:100%;margin:8px 0;table-layout:fixed}
th,td{text-align:left;padding:7px 8px;border-bottom:1px solid #DDE3EE;overflow-wrap:anywhere;vertical-align:top}
.fields th{width:38%;color:#56647A;font-weight:400}
.plan thead th{background:#F4F6FB;color:#56647A;font-weight:700}
thead{display:table-header-group}tr{page-break-inside:avoid}
td.amount,th.amount{text-align:right}
.highlight{display:flex;justify-content:space-between;align-items:baseline;border:1px solid #DDE3EE;border-radius:6px;padding:12px 14px;margin:12px 0}
.highlight span{font-size:10px;color:#56647A;letter-spacing:.06em}.highlight strong{font-size:20px;color:#1E3A8A}
.signatures{display:flex;gap:24px;margin-top:40px}.signatures div{flex:1;border-top:1px solid #233044;padding-top:6px;font-size:10px;overflow-wrap:anywhere}
.page-break{page-break-before:always}`

/**
 * Sözleşme ve Ek 1 ödeme planı (web şablonuyla aynı bölümler): taraflar, ek protokol, hizmet kapsamı,
 * bedel ve bilgilendirme, imza ve onay bilgisi, imza yerleri; Ek 1 yeni sayfada başlar, tablo
 * başlığı her sayfada tekrarlanır, sayfa altında belge numarası ve sayfa numarası yazar.
 */
export function contractDocumentHtml(
  data: ContractDocumentData,
  options: ContractDocumentOptions,
): string {
  const { contract } = data
  if (!contract)
    throw new DomainError('contract_not_found', 'Sözleşme kaydı bulunamadı.', {
      kind: 'not_found',
    })
  // Belge yalnız kendi sürümünü bilir; yerini ek protokole bıraktığını sürüm listesi gösterir.
  const status = contractStatus(contract, [contract])
  const revision = contract.revision ?? 1
  const approval = contract.approval
  const label = contract.amendsContractId ? 'EK PROTOKOL' : 'EĞİTİM SÖZLEŞMESİ'
  const rows = planRows(contract, data)
  const parts: string[] = []

  parts.push(
    `<header><div><div class="brand">KAMPÜS<b>.</b></div><div class="institution">${escapeHtml(options.institution)}</div></div><span class="badge">SÖZLEŞME</span></header>`,
    `<h1>${label}</h1><h2>${escapeHtml(contract.title)}</h2>`,
    `<p class="meta">${escapeHtml(`Sözleşme tarihi: ${day(contract.date)} · Sürüm ${String(revision)} · ${CONTRACT_STATUS_LABELS[status]}`)}</p>`,
    section('01 / Taraflar ve öğrenci bilgileri'),
    fieldsTable([
      ['Öğrenci', data.student.name],
      [
        'Okul numarası / Sınıf',
        `${data.student.number || data.student.id} / ${data.classroom?.name || '—'}`,
      ],
      ['Veli', data.parent?.name || '—'],
      ['Kampüs', data.branch?.name || '—'],
    ]),
    paragraph(
      `Eğitim kurumu: ${options.institution} · ${data.branch?.address || data.branch?.name || 'Okul yönetimi'}`,
      true,
    ),
  )
  if (contract.amendsContractId)
    // Ek protokol önceki sürümü değiştirmez; önceki sürümün belgesi ayrıca erişilebilir kalır.
    parts.push(
      section('Ek protokol'),
      fieldsTable([
        ['Değiştirdiği sürüm', String(revision - 1)],
        ['Gerekçe', contract.amendmentReason || '—'],
      ]),
      paragraph(
        'Bu ek protokol önceki sürümün ödeme planını onaylandığı andan itibaren değiştirir. Önceki sürüm ve onayı değişmeden saklanır.',
        true,
      ),
    )
  parts.push(
    section('02 / Eğitim hizmetinin kapsamı'),
    paragraph(
      'Bu örnek sözleşme; öğrencinin kayıtlı olduğu sınıftaki eğitim programını, ders materyallerini, ölçme ve değerlendirme çalışmalarını ve öğrenci / veli portalı erişimini kapsar.',
    ),
    paragraph(
      'Ders programı ve akademik takvim okul yönetimi tarafından paylaşılır. Veli, duyuru ve gelişim raporlarını portal üzerinden takip eder. Yemek, servis ve ek etkinlikler bu eğitim bedeline dahil edilmemiştir.',
    ),
    section('03 / Eğitim bedeli ve bilgilendirme'),
  )
  // Tarifeli sözleşme karar anının kopyasını taşır (DOM-FIN-010); eski kayıtta yoktur.
  if (contract.grossCents !== undefined)
    parts.push(
      fieldsTable([
        ['İlan ücreti', money(contract.grossCents)],
        ...(contract.discounts ?? []).map(
          (line) =>
            [`${discountLabel(line.kind)} indirimi`, `-${money(line.amountCents)}`] as const,
        ),
        // Burs indirim değildir, ayrı kalemdir (DOM-FIN-025); net bursla düşülmüş tutardır.
        ...(contract.scholarship
          ? [['Burs', `-${money(contract.scholarship.amountCents)}`] as const]
          : []),
        ['Net öğrenim ücreti', money(contract.netCents ?? contract.amount)],
        ...(contract.extras ?? []).map(
          (line) => [extraLabel(line.kind), money(line.amountCents)] as const,
        ),
        ['Tarife sürümü', String(contract.tariffVersion ?? '—')],
        ['Ödeyici', contract.payer === 'student' ? 'Öğrenci' : 'Veli'],
      ]),
    )
  parts.push(
    paragraph(
      rows.length === 0
        ? `Toplam eğitim bedeli ${money(contract.amount)} olarak kaydedilmiştir; tam bursta öğrenim taksiti açılmaz.`
        : `Toplam eğitim bedeli ${money(contract.amount)}; ${String(rows.length)} satırlık ödeme planı Ek 1'dedir.`,
    ),
  )
  // Bursluya burs belgeleri dışında maddi yükümlülük doğuran belge düzenlenmez (DOM-FIN-025).
  if (contract.scholarship)
    parts.push(
      paragraph('Burslu öğrenci için bu sözleşmeye bağlı senet veya taahhüt düzenlenmez.', true),
    )
  parts.push(
    paragraph(
      `İmza yetkilisi: ${contract.signatory ? signatoryLabel(contract) : 'Bekleniyor'} · Ödeyici onayı: ${
        approval
          ? `${CONTRACT_APPROVAL_METHOD_LABELS[approval.method]} · ${day(approval.approvedAt)} ${timeLabel(approval.approvedAt)}`
          : 'Bekleniyor'
      }`,
    ),
    paragraph(
      approval
        ? 'Bu sürümün tutarı ve ödeme planı onaylanmıştır; değişiklik yalnız ek protokolle yapılır.'
        : 'Bu metin kayıt sürecini tanıtan bir örnektir; onaylanana kadar imza veya ödeme yükümlülüğü oluşturmaz. Gerçek kayıt koşulları kurumun yürürlükteki sözleşmesiyle belirlenir.',
      true,
    ),
    `<div class="signatures"><div>${escapeHtml(payerLabel(contract, data))}</div><div>${escapeHtml(signatoryLabel(contract))}</div></div>`,
    `<section class="page-break"><h2>Ek 1 / Ödeme planı</h2><p class="meta">${escapeHtml(`${data.student.name} · ${data.classroom?.name || ''}`)}</p>`,
    `<div class="highlight"><span>SÖZLEŞME EĞİTİM BEDELİ</span><strong>${escapeHtml(money(contract.amount))}</strong><span>${rows.length === 0 ? 'Taksit yok' : `${String(rows.length)} taksit`}</span></div>`,
  )
  if (rows.length > 0)
    parts.push(
      `<table class="plan"><thead><tr><th>Taksit</th><th>Vade tarihi</th><th class="amount">Tutar</th><th>Durum</th></tr></thead><tbody>${rows
        .map(
          ([installment, due, amount, state]) =>
            `<tr><td>${escapeHtml(installment)}</td><td>${escapeHtml(due)}</td><td class="amount">${escapeHtml(amount)}</td><td>${escapeHtml(state)}</td></tr>`,
        )
        .join('')}</tbody></table>`,
    )
  else parts.push(paragraph('Bu sözleşmede ödeme planı satırı bulunmuyor.'))
  const snapshot = contractPlanLines(contract) !== null
  // Tahsilat ve bakiye güncel taksitlerden gelir; önerilen ve iptal edilen planda anlamı yoktur.
  if (status !== 'cancelled' && contract.proposedPlan === undefined)
    parts.push(
      fieldsTable([
        ['Tahsil edilen', money(data.paid)],
        ['Kalan bakiye', money(data.total - data.paid)],
      ]),
    )
  if (!snapshot && contract.amount !== data.total)
    parts.push(
      paragraph(
        `Güncel taksit toplamı: ${money(data.total)}. Sözleşme bedeli ile güncel plan arasında fark bulunmaktadır; okul muhasebesiyle kontrol edilmelidir.`,
      ),
    )
  parts.push(
    paragraph(
      snapshot
        ? 'Plan satırları onaylanan ya da önerilen sürümün kopyasıdır; durum sütunu belgenin oluşturulduğu andaki kayıtları gösterir.'
        : 'Ödeme durumu, belgenin oluşturulduğu andaki kayıtları gösterir. Tamamlanan her tahsilat için ayrı bir dekont alınabilir.',
      true,
    ),
    paragraph(
      'Örnek sözleşme metnidir; kurumun imzalı sözleşmesi veya hukuki belge yerine geçmez.',
      true,
    ),
    '</section>',
  )
  const reference = `Belge no: ${data.reference} · ${day(options.generatedAt.toISOString())} ${timeLabel(options.generatedAt)}`
  return `<!doctype html><html lang="tr"><head><meta charset="UTF-8"><title>${escapeHtml(`${label} · ${contract.title}`)}</title><style>${style(reference)}</style></head><body>${parts.join('')}</body></html>`
}

/** Dosya adı: belge türü ve kimliği; yol karakterleri ayıklanır. */
export const contractDocumentName = (contractId: string) =>
  `kampus-sozlesme-${contractId.replace(/[^a-z0-9-]/gi, '')}.pdf`
