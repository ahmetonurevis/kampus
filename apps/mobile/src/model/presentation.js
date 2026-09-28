export function contentTitle(title, subject) {
  const text = String(title || '').trim(),
    prefix = String(subject || '').trim()
  if (
    !prefix ||
    text.slice(0, prefix.length).toLocaleLowerCase('tr') !== prefix.toLocaleLowerCase('tr')
  )
    return text
  const rest = text.slice(prefix.length)
  return /^\s*[·:–—-]\s*\S/.test(rest) ? rest.replace(/^\s*[·:–—-]\s*/, '') : text
}
