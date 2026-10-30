// @ts-nocheck — TODO(ts): tiplenecek (C2)
// CSV alanları tırnak içinde ayraç, çift tırnak ve satır sonu içerebilir.
export function delimitedRows(raw) {
  const source = raw.replace(/^\uFEFF/, '')
  const separator = source.split(/\r?\n/, 1)[0].includes(';') ? ';' : ','
  const rows = [],
    row = []
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

export function csvObjects(raw, header, maximumRows = 1000) {
  const rows = delimitedRows(raw)
  if (rows[0]?.map((v) => v.trim()).join('|') !== header.join('|'))
    throw new Error(`CSV başlıkları ${header.join(';')} olmalıdır.`)
  if (rows.length < 2 || rows.length > maximumRows + 1)
    throw new Error(`Dosya 1–${maximumRows} veri satırı içermelidir.`)
  return rows.slice(1).map((values, index) => {
    if (values.length !== header.length)
      throw new Error(`CSV ${index + 2}. satırda sütun sayısı geçersiz.`)
    return Object.fromEntries(header.map((key, i) => [key, values[i]]))
  })
}
