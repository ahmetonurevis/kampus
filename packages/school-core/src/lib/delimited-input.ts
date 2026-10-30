// CSV alanları tırnak içinde ayraç, çift tırnak ve satır sonu içerebilir.
export function delimitedRows(raw: string) {
  const source = raw.replace(/^\uFEFF/, '')
  const [firstLine = ''] = source.split(/\r?\n/, 1)
  const separator = firstLine.includes(';') ? ';' : ','
  const rows: string[][] = [],
    row: string[] = []
  let cell = '',
    quoted = false,
    closed = false
  for (let index = 0; index <= source.length; index++) {
    const char = source[index]
    if (char === '"') {
      if (quoted && source[index + 1] === '"') {
        cell += '"'
        index++
      } else if (quoted) {
        quoted = false
        closed = true
      } else if (!cell && !closed) quoted = true
      else throw new Error('CSV içinde geçersiz tırnak kullanımı var.')
    } else if (!quoted && (char === separator || char === '\n' || char === undefined)) {
      row.push(cell)
      cell = ''
      closed = false
      if (char !== separator) {
        if (row.some((v) => v.trim())) rows.push([...row])
        row.length = 0
      }
    } else if (char !== undefined && char !== '\r') {
      if (closed && char.trim())
        throw new Error('CSV kapanan tırnaktan sonra geçersiz karakter içeriyor.')
      if (!closed) cell += char
    }
  }
  if (quoted) throw new Error('CSV içinde kapanmamış tırnak var.')
  return rows
}

export function csvObjects<const H extends readonly string[]>(
  raw: string,
  header: H,
  maximumRows = 1000,
): Record<H[number], string>[] {
  const rows = delimitedRows(raw)
  if (rows[0]?.map((v) => v.trim()).join('|') !== header.join('|'))
    throw new Error(`CSV başlıkları ${header.join(';')} olmalıdır.`)
  if (rows.length < 2 || rows.length > maximumRows + 1)
    throw new Error(`Dosya 1–${maximumRows} veri satırı içermelidir.`)
  return rows.slice(1).map((values, index) => {
    if (values.length !== header.length)
      throw new Error(`CSV ${index + 2}. satırda sütun sayısı geçersiz.`)
    // Dosya sınırı: başlık ve sütun sayısı doğrulandığı için her başlık anahtarı dolu bir dizedir;
    // Object.fromEntries anahtar birleşimini koruyamadığından tip burada daraltılır.
    return Object.fromEntries(header.map((key, i) => [key, values[i] ?? ''])) as Record<
      H[number],
      string
    >
  })
}
