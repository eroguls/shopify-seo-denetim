const LEVELS = ['hata', 'uyari', 'bilgi']
const LEVEL_LABEL = { hata: 'Hata', uyari: 'Uyarı', bilgi: 'Bilgi' }

function csvField(value) {
  const text = String(value ?? '')
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

const byLevel = (a, b) => LEVELS.indexOf(a.seviye) - LEVELS.indexOf(b.seviye)

export function toCsv(findings) {
  const rows = [['seviye', 'kod', 'tur', 'adres', 'mesaj']]
  for (const item of [...findings].sort(byLevel)) rows.push([item.seviye, item.kod, item.type, item.url, item.mesaj])
  return rows.map((row) => row.map(csvField).join(',')).join('\n') + '\n'
}

export function summarize(findings) {
  const codes = new Map()
  for (const item of findings) {
    const key = `${item.seviye}\u0000${item.kod}`
    if (!codes.has(key)) codes.set(key, { seviye: item.seviye, kod: item.kod, mesaj: item.mesaj, adresler: [] })
    codes.get(key).adresler.push(item.url)
  }
  return [...codes.values()].sort((a, b) => byLevel(a, b) || b.adresler.length - a.adresler.length)
}

export function toText(result) {
  const counts = Object.fromEntries(LEVELS.map((level) => [level, result.findings.filter((item) => item.seviye === level).length]))
  const lines = [
    `${result.origin} · ${result.pages.length} sayfa denetlendi`,
    `${counts.hata} hata, ${counts.uyari} uyarı, ${counts.bilgi} bilgi`,
    '',
  ]
  for (const group of summarize(result.findings)) {
    lines.push(`${LEVEL_LABEL[group.seviye].padEnd(6)} ${group.kod.padEnd(24)} ${String(group.adresler.length).padStart(4)} sayfa  ör. ${group.adresler[0]}`)
  }
  return lines.join('\n') + '\n'
}

export function toMarkdown(result) {
  const lines = [`# SEO denetimi: ${result.origin}`, '', `${result.pages.length} sayfa denetlendi.`, '']
  for (const group of summarize(result.findings)) {
    lines.push(`## ${LEVEL_LABEL[group.seviye]}: ${group.kod} (${group.adresler.length})`, '', group.mesaj, '')
    for (const url of group.adresler.slice(0, 20)) lines.push(`- ${url}`)
    if (group.adresler.length > 20) lines.push(`- … ve ${group.adresler.length - 20} adres daha`)
    lines.push('')
  }
  return lines.join('\n')
}
