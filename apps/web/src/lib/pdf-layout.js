import { dateLabel, money } from './format.js'

const ink = [35, 47, 68],
  muted = [99, 113, 131],
  line = [220, 226, 234]
const sapphire = [30, 58, 138],
  sapphireSoft = [237, 242, 255],
  orange = [249, 115, 22],
  orangeSoft = [255, 241, 231],
  orangeInk = [154, 52, 18]
const labels = {
  receipt: 'TAHSİLAT DEKONTU',
  contract: 'EĞİTİM SÖZLEŞMESİ',
  'payment-plan': 'TAKSİT TAAHHÜTNAMESİ',
  material: 'DERS ÇALIŞMA KÂĞIDI',
  homework: 'ÖDEV ÇALIŞMA KÂĞIDI',
  submission: 'ÖDEV DEĞERLENDİRME FORMU',
}
const date = (value) => dateLabel(value, { year: 'numeric' })

// All positions are measured in millimetres. Blocks reserve their height before drawing.
class DocumentLayout {
  constructor(pdf, type, data, generatedAt) {
    this.pdf = pdf
    this.type = type
    this.data = data
    this.generatedAt = generatedAt
    this.y = 0
    this.header(true)
  }
  text(value, x, y, size = 10, color = ink, options = {}) {
    this.pdf.setFontSize(size)
    this.pdf.setTextColor(...color)
    this.pdf.text(String(value ?? '—'), x, y, options)
  }
  wrap(value, width = 174, size = 10) {
    this.pdf.setFontSize(size)
    return this.pdf.splitTextToSize(String(value ?? '—'), width)
  }
  rule(y, x = 18, width = 174) {
    this.pdf.setDrawColor(...line)
    this.pdf.setLineWidth(0.3)
    this.pdf.line(x, y, x + width, y)
  }
  header(first) {
    this.pdf.setFillColor(255, 255, 255)
    this.pdf.rect(0, 0, 210, 297, 'F')
    this.text('DEMO BELGESİ', 54, 176, 30, sapphireSoft, { angle: 35 })
    this.pdf.setFillColor(...sapphire)
    this.pdf.rect(0, 0, 210, 3, 'F')
    this.pdf.setFillColor(...orange)
    this.pdf.rect(174, 0, 36, 3, 'F')
    const logoSize = first ? 23 : 18
    this.text('kampüs', 18, 19, logoSize, sapphire)
    this.text('.', 18 + this.pdf.getTextWidth('kampüs'), 19, logoSize, orange)
    this.text('AKADEMİ ÖZEL OKULLARI', 18, 26, 8, muted)
    this.pdf.setFillColor(...orangeSoft)
    this.pdf.roundedRect(151, 10, 41, 9, 2, 2, 'F')
    this.text('DEMO BELGESİ', 188, 16, 8, orangeInk, { align: 'right' })
    this.text(date(this.generatedAt), 192, 23, 8, muted, { align: 'right' })
    this.rule(32)
    this.y = 43
    if (first) {
      this.text(labels[this.type], 18, this.y, 10, sapphire)
      this.y += 8
    } else {
      this.text(labels[this.type] + ' · Devam', 18, 41, 8, muted)
      this.y = 51
    }
  }
  ensure(height) {
    if (this.y + height > 266) {
      this.pdf.addPage()
      this.header(false)
      return true
    }
    return false
  }
  heading(title, subtitle) {
    for (const part of this.wrap(title, 174, 20)) {
      this.ensure(10)
      this.text(part, 18, this.y + 4, 20)
      this.y += 9
    }
    this.y += 2
    if (subtitle) this.paragraph(subtitle, 9, muted)
    this.y += 3
  }
  paragraph(value, size = 10, color = ink) {
    const lines = this.wrap(value, 174, size)
    this.ensure(Math.min(lines.length, 3) * 5.7)
    for (let index = 0; index < lines.length; index++) {
      const part = lines[index]
      if (lines.length - index === 2) this.ensure(11.4)
      this.ensure(6)
      this.text(part, 18, this.y + 4, size, color)
      this.y += 5.7
    }
    this.y += 3
  }
  section(title) {
    this.ensure(24)
    this.y += 3
    this.text(title, 18, this.y + 4, 11, sapphire)
    this.rule(this.y + 7)
    this.y += 13
  }
  fields(pairs) {
    for (let i = 0; i < pairs.length; i += 2) {
      const row = pairs.slice(i, i + 2)
      const wrapped = row.map(([, value]) => this.wrap(value, 80, 10))
      const height = 11 + Math.max(...wrapped.map((v) => v.length)) * 5
      this.ensure(height)
      row.forEach(([label], column) => {
        const x = 18 + column * 91
        this.text(label, x, this.y + 3, 8, muted)
        wrapped[column].forEach((text, index) => this.text(text, x, this.y + 10 + index * 5))
      })
      this.y += height
    }
  }
  highlight(label, amount, detail) {
    this.ensure(37)
    this.pdf.setFillColor(...sapphireSoft)
    this.pdf.roundedRect(18, this.y, 174, 31, 3, 3, 'F')
    this.pdf.setFillColor(...orange)
    this.pdf.roundedRect(18, this.y + 6, 1.5, 19, 0.75, 0.75, 'F')
    this.text(label, 24, this.y + 9, 9, sapphire)
    this.text(amount, 24, this.y + 22, 23, sapphire)
    if (detail) this.text(detail, 186, this.y + 22, 9, sapphire, { align: 'right' })
    this.y += 38
  }
  table(headers, rows, widths, compact = false) {
    const drawHeader = () => {
      this.pdf.setFillColor(239, 242, 247)
      this.pdf.roundedRect(18, this.y, 174, 11, 2, 2, 'F')
      let x = 18
      headers.forEach((header, i) => {
        this.text(header, x + 3, this.y + 7, 8, muted)
        x += widths[i]
      })
      this.y += 11
    }
    this.ensure(25)
    drawHeader()
    rows.forEach((row) => {
      const cells = row.map((value, i) => this.wrap(value, widths[i] - 6, 9))
      const height = Math.max(
        compact ? 9 : 12,
        Math.max(...cells.map((cell) => cell.length)) * 4.5 + (compact ? 4.5 : 6),
      )
      if (this.ensure(height)) drawHeader()
      let x = 18
      cells.forEach((cell, i) => {
        cell.forEach((text, index) => this.text(text, x + 3, this.y + 7 + index * 5, 9))
        x += widths[i]
      })
      this.y += height
      this.rule(this.y)
    })
    this.y += 7
  }
  writingArea(title, rows = 6) {
    this.ensure(22 + rows * 8)
    this.section(title)
    for (let i = 0; i < rows; i++) {
      this.rule(this.y + 7)
      this.y += 8
    }
    this.y += 6
  }
  signatures(left, right, compact = false) {
    const labels = [this.wrap(left, 76, compact ? 8 : 9), this.wrap(right, 83, compact ? 8 : 9)]
    const height = Math.max(...labels.map((lines) => lines.length)) * 4 + (compact ? 16 : 33)
    this.ensure(height)
    labels.forEach((lines, column) =>
      lines.forEach((text, index) =>
        this.text(text, 18 + column * 91, this.y + 4 + index * 4, compact ? 8 : 9, muted),
      ),
    )
    this.rule(this.y + height - 3, 18, 76)
    this.rule(this.y + height - 3, 109, 83)
    this.y += height + 3
  }
  finish() {
    const count = this.pdf.getNumberOfPages()
    for (let page = 1; page <= count; page++) {
      this.pdf.setPage(page)
      this.rule(276)
      this.text(
        ['receipt', 'contract', 'payment-plan'].includes(this.type)
          ? 'Demo örneğidir. Gerçek ödeme veya hukuki belge yerine geçmez.'
          : 'Akademi Özel Okulları · Eğitim amaçlı demo çalışma belgesidir.',
        18,
        282,
        7,
        muted,
      )
      this.text(`${page} / ${count}`, 192, 282, 8, muted, { align: 'right' })
      const reference = this.wrap(`Belge no: ${this.data.reference}`, 174, 7)
      this.text(reference[0], 18, 287, 7, muted)
    }
    this.pdf.setProperties({
      title: labels[this.type],
      author: 'Akademi Özel Okulları',
      subject: 'Kampüs demo belgesi',
      creator: 'Kampüs',
    })
    return this.pdf
  }
}

function studentFields(doc, data) {
  doc.fields([
    ['Öğrenci', data.student.name],
    [
      'Okul numarası / Sınıf',
      `${data.student.number || data.student.id} / ${data.classroom?.name || '—'}`,
    ],
    ['Veli', data.parent?.name || '—'],
    ['Kampüs', data.branch?.name || '—'],
  ])
}
function installments(doc, data) {
  doc.table(
    ['Taksit', 'Vade tarihi', 'Tutar', 'Durum'],
    data.invoices.map((i) => [
      `${i.installment}. taksit`,
      date(i.dueDate),
      money(i.amount),
      i.status,
    ]),
    [25, 45, 56, 48],
    true,
  )
}

export function renderDocument(pdf, type, data, generatedAt = new Date()) {
  if (!labels[type]) throw new Error('Belge şablonu bulunamadı.')
  const doc = new DocumentLayout(pdf, type, data, generatedAt)
  if (type === 'receipt') {
    const i = data.invoice
    doc.heading('Ödeme dekontu', 'Eğitim hizmeti tahsilatı · İşlem başarıyla tamamlandı')
    doc.highlight('TAHSİL EDİLEN TUTAR', money(i.amount), 'TRY / Türk lirası')
    doc.fields([
      ['İşlem / Referans no', i.id.toUpperCase()],
      [
        'İşlem tarihi ve saati',
        dateLabel(i.paidAt, { year: 'numeric', hour: '2-digit', minute: '2-digit' }),
      ],
      ['Ödeme yöntemi', i.method],
      ['İşlem durumu', 'Tamamlandı'],
    ])
    doc.section('Ödeyen ve tahsil eden')
    studentFields(doc, data)
    doc.section('İşlem açıklaması')
    doc.paragraph(
      `${data.student.name} adına düzenlenen eğitim ödeme planının ${i.installment}. taksiti. Vade tarihi: ${date(i.dueDate)}.`,
    )
    doc.fields([
      ['Alıcı kurum', 'Akademi Özel Okulları'],
      ['İşlem ücreti', money(0)],
    ])
    doc.paragraph(
      'Bu dekont, demo ödeme kaydındaki bilgilerden oluşturulmuştur. Banka veya ödeme kuruluşu tarafından düzenlenmiş bir belge değildir.',
      8,
      muted,
    )
  } else if (type === 'contract') {
    doc.heading('Özel okul eğitim sözleşmesi', `Sözleşme tarihi: ${date(data.contract.date)}`)
    doc.section('01 / Taraflar ve öğrenci bilgileri')
    studentFields(doc, data)
    doc.paragraph(
      `Eğitim kurumu: Akademi Özel Okulları · ${data.branch?.address || data.branch?.name || 'Okul yönetimi'}`,
      9,
      muted,
    )
    doc.section('02 / Eğitim hizmetinin kapsamı')
    doc.paragraph(
      'Bu örnek sözleşme; öğrencinin kayıtlı olduğu sınıftaki eğitim programını, ders materyallerini, ölçme ve değerlendirme çalışmalarını ve öğrenci / veli portalı erişimini kapsar.',
    )
    doc.paragraph(
      'Ders programı ve akademik takvim okul yönetimi tarafından paylaşılır. Veli, duyuru ve gelişim raporlarını portal üzerinden takip eder. Yemek, servis ve ek etkinlikler bu demo eğitim bedeline dahil edilmemiştir.',
    )
    doc.section('03 / Eğitim bedeli ve bilgilendirme')
    doc.paragraph(
      `Toplam eğitim bedeli ${money(data.contract.amount)} olarak kaydedilmiştir. ${data.invoices.length} taksitlik güncel ödeme takvimi bu belgenin Ek 1 bölümünde yer alır.`,
    )
    doc.paragraph(
      'Bu metin kayıt sürecini tanıtan bir örnektir; imza veya ödeme yükümlülüğü oluşturmaz. Gerçek kayıt koşulları kurumun yürürlükteki sözleşmesiyle belirlenir.',
      9,
      muted,
    )
    doc.signatures(`Veli · ${data.parent?.name || 'Ad soyad'}`, 'Kurum yetkilisi · Ad soyad / İmza')
    pdf.addPage()
    doc.header(false)
    doc.heading('Ek 1 / Ödeme planı', `${data.student.name} · ${data.classroom?.name || ''}`)
    doc.highlight(
      'SÖZLEŞME EĞİTİM BEDELİ',
      money(data.contract.amount),
      `${data.invoices.length} taksit`,
    )
    installments(doc, data)
    doc.fields([
      ['Tahsil edilen', money(data.paid)],
      ['Kalan bakiye', money(data.total - data.paid)],
    ])
    if (data.contract.amount !== data.total)
      doc.paragraph(
        `Güncel taksit toplamı: ${money(data.total)}. Sözleşme bedeli ile güncel plan arasında fark bulunmaktadır; okul muhasebesiyle kontrol edilmelidir.`,
        9,
      )
    doc.paragraph(
      'Ödeme durumu, belgenin oluşturulduğu andaki kayıtları gösterir. Tamamlanan her tahsilat için veli portalından ayrı bir dekont indirilebilir.',
      9,
      muted,
    )
  } else if (type === 'payment-plan') {
    doc.heading('Taksit taahhütnamesi', 'Öğrenciye ait güncel ödeme planı ve tahsilat özeti')
    studentFields(doc, data)
    doc.ensure(27)
    pdf.setFillColor(...sapphireSoft)
    pdf.roundedRect(18, doc.y, 174, 22, 3, 3, 'F')
    pdf.setFillColor(...orange)
    pdf.roundedRect(18, doc.y + 5, 1.5, 12, 0.75, 0.75, 'F')
    ;[
      ['TOPLAM BEDEL', data.total],
      ['TAHSİL EDİLEN', data.paid],
      ['KALAN BAKİYE', data.total - data.paid],
    ].forEach(([label, value], i) => {
      doc.text(label, 24 + i * 57, doc.y + 7, 7, sapphire)
      doc.text(money(value), 24 + i * 57, doc.y + 16, 13, sapphire)
    })
    doc.y += 24
    doc.section('Taksit takvimi')
    installments(doc, data)
    doc.paragraph(
      'Bu plan güncel demo tahsilat durumunu gösterir. Ödeme dekontları veli portalından indirilebilir.',
      8,
      muted,
    )
    doc.signatures(
      `Veli · ${data.parent?.name || 'Ad soyad'}`,
      'Okul muhasebesi · Kontrol / Tarih',
      true,
    )
  } else if (type === 'material') {
    doc.heading(data.title, `${data.subject} · ${data.level}`)
    doc.fields([
      ['Hazırlayan öğretmen', data.teacher?.name],
      ['Yayın tarihi', date(data.createdAt)],
    ])
    doc.fields([
      ['Öğrenci adı soyadı', '................................................'],
      ['Sınıf / Numara', '................................................'],
    ])
    doc.section('01 / Konuyu hatırlayalım')
    data.content.forEach((text, i) => {
      if (i === 1) doc.section('02 / Uygulama ve yönergeler')
      doc.paragraph(text)
    })
    doc.writingArea('03 / Çözüm ve çalışma alanı', 5)
  } else if (type === 'homework') {
    const h = data.homework
    doc.heading(h.title, `${h.subject} · ${data.classroom?.name || 'Sınıf çalışması'}`)
    doc.fields([
      ['Öğretmen', data.teacher?.name],
      ['Son teslim', date(h.dueDate)],
      ['Öğrenci', data.student?.name || '................................................'],
      ['Okul numarası', data.student?.number || '................................................'],
    ])
    doc.section('01 / Görev ve yönerge')
    doc.paragraph(h.description)
    doc.paragraph(
      'Çözüm adımlarını ve kullandığın yöntemi açıkça göster. Çalışmanı tamamladıktan sonra öğrenci portalındaki ilgili ödeve dosyanı yükle.',
      9,
      muted,
    )
    doc.writingArea('02 / Çalışmam', 6)
    doc.writingArea('03 / Kontrol ve öz değerlendirme', 2)
    doc.paragraph(
      'Kontrol: Tüm soruları ele aldım · İşlem ve açıklamalarımı kontrol ettim · Dosyamı teslim ettim',
      8,
      muted,
    )
  } else {
    const { homework: h, submission: s } = data
    doc.heading('Ödev teslim ve değerlendirme', h.title)
    doc.fields([
      ['Öğrenci', data.student.name],
      [
        'Sınıf / Numara',
        `${data.classroom?.name || ''} / ${data.student.number || data.student.id}`,
      ],
    ])
    doc.fields([
      ['Ders / Öğretmen', `${h.subject} / ${data.teacher?.name || '—'}`],
      ['Teslim tarihi', date(s.submittedAt)],
      ['Ek dosya adı', s.fileName],
      [
        'Değerlendirme durumu',
        s.score == null ? 'Öğretmen değerlendirmesi bekleniyor' : 'Değerlendirildi',
      ],
    ])
    doc.section('Verilen görev')
    doc.paragraph(h.description)
    doc.highlight('DEĞERLENDİRME PUANI', s.score == null ? 'Bekliyor' : `${s.score} / 100`)
    doc.section('Öğretmen geri bildirimi')
    doc.paragraph(s.feedback || 'Bu teslim için henüz geri bildirim paylaşılmadı.')
    doc.writingArea('Sonraki çalışma için notlar', 2)
    doc.paragraph(
      'Bu form teslim ve değerlendirme kaydıdır; yüklenen dosyanın içeriğini kapsamaz.',
      8,
      muted,
    )
  }
  return doc.finish()
}
