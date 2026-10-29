// Bağımlılıksız, SEO denetimi için yeterli HTML okuyucu. Tam bir ayrıştırıcı değildir:
// yalnızca başlık, meta/link/img etiketleri, h1’ler ve JSON-LD blokları çıkarılır.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" }

export function decodeEntities(text) {
  return String(text)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+|#39);/gi, (match, name) => ENTITIES[name.toLowerCase()] ?? match)
}

function collapse(text) {
  return decodeEntities(text.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

export function parseAttributes(source) {
  const attributes = {}
  const pattern = /([^\s"'=<>`/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
  for (const match of source.matchAll(pattern)) {
    const name = match[1].toLowerCase()
    if (name in attributes) continue
    attributes[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '')
  }
  return attributes
}

function tags(html, name) {
  const pattern = new RegExp(`<${name}\\b([^>]*)>`, 'gi')
  return [...html.matchAll(pattern)].map((match) => parseAttributes(match[1]))
}

function collectTypes(node, types) {
  if (Array.isArray(node)) {
    node.forEach((item) => collectTypes(item, types))
  } else if (node && typeof node === 'object') {
    const type = node['@type']
    if (type) [].concat(type).forEach((item) => types.add(String(item)))
    for (const value of Object.values(node)) if (value && typeof value === 'object') collectTypes(value, types)
  }
  return types
}

function findType(node, wanted) {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findType(item, wanted)
      if (found) return found
    }
  } else if (node && typeof node === 'object') {
    if ([].concat(node['@type'] ?? []).includes(wanted)) return node
    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') {
        const found = findType(value, wanted)
        if (found) return found
      }
    }
  }
  return null
}

export function parseHtml(html) {
  const jsonLd = []
  const jsonLdErrors = []
  const ldPattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi
  for (const match of html.matchAll(ldPattern)) {
    if (!/type\s*=\s*["']?application\/ld\+json/i.test(match[1])) continue
    try {
      jsonLd.push(JSON.parse(match[2].trim()))
    } catch (error) {
      jsonLdErrors.push(error.message)
    }
  }

  // Yorumlar, betikler, stiller ve noscript içi sayılmaz.
  const body = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, '')

  const titleMatch = body.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)
  const metas = tags(body, 'meta')
  const links = tags(body, 'link')
  const meta = (key, value) => metas.find((item) => (item[key] || '').toLowerCase() === value)?.content
  const htmlTag = tags(body, 'html')[0] || {}
  const h1s = [...body.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((match) => collapse(match[1]))
  const canonicals = links.filter((link) => (link.rel || '').toLowerCase().split(/\s+/).includes('canonical'))

  return {
    title: titleMatch ? collapse(titleMatch[1]) : null,
    description: meta('name', 'description') ?? null,
    robots: (meta('name', 'robots') || '').toLowerCase(),
    canonical: canonicals[0]?.href ?? null,
    canonicalCount: canonicals.length,
    lang: htmlTag.lang || null,
    ogTitle: meta('property', 'og:title') ?? null,
    ogImage: meta('property', 'og:image') ?? null,
    hreflang: links.filter((link) => (link.rel || '').toLowerCase() === 'alternate' && link.hreflang).map((link) => link.hreflang),
    h1s,
    images: tags(body, 'img').map((img) => ({ src: img.src || img['data-src'] || '', alt: 'alt' in img ? img.alt : null })),
    jsonLd,
    jsonLdErrors,
    jsonLdTypes: [...collectTypes(jsonLd, new Set())],
    findType: (type) => findType(jsonLd, type),
  }
}
