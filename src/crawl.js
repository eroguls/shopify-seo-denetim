import { checkPage, checkSite } from './checks.js'
import { decodeEntities, parseHtml } from './html.js'

export const USER_AGENT = 'shopify-seo-denetim/0.1 (+https://github.com/eroguls/shopify-seo-denetim)'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function readLocs(xml) {
  return [...String(xml).matchAll(/<loc>\s*([\s\S]*?)\s*<\/loc>/gi)].map((match) => decodeEntities(match[1].trim()))
}

// Shopify alt site haritası adları: sitemap_products_1.xml, sitemap_collections_1.xml …
export function sitemapType(url) {
  const name = new URL(url).pathname
  if (/products/.test(name)) return 'urun'
  if (/collections/.test(name)) return 'koleksiyon'
  if (/pages/.test(name)) return 'sayfa'
  if (/blogs|articles/.test(name)) return 'blog'
  return 'diger'
}

/** robots.txt’teki “User-agent: *” grubunun Disallow/Allow kurallarını döndürür. */
export function parseRobots(text) {
  const rules = []
  let applies = false
  let inGroupHeader = false
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim()
    const match = line.match(/^([a-z-]+)\s*:\s*(.*)$/i)
    if (!match) continue
    const key = match[1].toLowerCase()
    const value = match[2].trim()
    if (key === 'user-agent') {
      if (!inGroupHeader) applies = false
      inGroupHeader = true
      if (value === '*') applies = true
      continue
    }
    inGroupHeader = false
    if (applies && (key === 'disallow' || key === 'allow') && value) rules.push({ allow: key === 'allow', pattern: value })
  }
  return rules
}

function ruleMatches(pattern, path) {
  const source = pattern
    .replace(/[.+?^{}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
  return new RegExp('^' + source).test(path)
}

/** En uzun eşleşen kural kazanır (Google’ın yorumu). */
export function isAllowed(rules, url) {
  const { pathname, search } = new URL(url)
  const path = pathname + search
  let best = null
  for (const rule of rules) {
    if (!ruleMatches(rule.pattern, path)) continue
    if (!best || rule.pattern.length > best.pattern.length || (rule.pattern.length === best.pattern.length && rule.allow)) best = rule
  }
  return !best || best.allow
}

export function createFetcher({ delay = 500, timeout = 20000, fetchImpl = fetch } = {}) {
  let last = 0
  return async function get(url) {
    const wait = last + delay - Date.now()
    if (wait > 0) await sleep(wait)
    for (let attempt = 0; ; attempt++) {
      last = Date.now()
      const response = await fetchImpl(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xml;q=0.9,*/*;q=0.8' },
        redirect: 'follow',
        signal: AbortSignal.timeout(timeout),
      })
      // Shopify hız sınırı: bir kez kısa bekleyip yeniden dene, olmazsa 429 olarak bildir.
      if (response.status === 429 && attempt < 1) {
        const retry = Number(response.headers.get('retry-after')) || 5
        await sleep(Math.min(retry, 10) * 1000)
        continue
      }
      return {
        status: response.status,
        finalUrl: response.url || url,
        contentType: response.headers.get('content-type') || '',
        text: await response.text(),
      }
    }
  }
}

/**
 * Mağazayı site haritasından örnekleyip denetler.
 * @param origin  https://magaza.com
 * @param options { sinir: tür başına sayfa, gecikme: ms, ilerleme: (mesaj) => void, fetchImpl }
 */
export async function audit(origin, options = {}) {
  const base = new URL(origin)
  base.pathname = '/'
  base.search = ''
  base.hash = ''
  const limit = options.sinir ?? 20
  const log = options.ilerleme ?? (() => {})
  const get = createFetcher({ delay: options.gecikme ?? 500, fetchImpl: options.fetchImpl })
  const siteFindings = []

  const robots = await get(new URL('/robots.txt', base).href).catch(() => null)
  const rules = robots && robots.status === 200 ? parseRobots(robots.text) : []
  if (!robots || robots.status !== 200) siteFindings.push({ url: new URL('/robots.txt', base).href, type: 'site', seviye: 'uyari', kod: 'robots-yok', mesaj: 'robots.txt okunamadı.' })

  const index = await get(new URL('/sitemap.xml', base).href)
  if (index.status !== 200) throw new Error(`sitemap.xml okunamadı (${index.status}).`)
  const isIndex = /<sitemapindex/i.test(index.text)
  const targets = [{ url: base.href, type: 'ana-sayfa' }]
  const seen = new Set([base.href])
  const add = (url, type, bucket) => {
    if (seen.has(url) || bucket.length >= limit) return
    seen.add(url)
    if (!isAllowed(rules, url)) {
      siteFindings.push({ url, type, seviye: 'uyari', kod: 'robots-engelli', mesaj: 'Site haritasında olan adres robots.txt ile engellenmiş.' })
      return
    }
    bucket.push({ url, type })
  }

  const buckets = new Map()
  if (isIndex) {
    for (const sitemap of readLocs(index.text)) {
      const type = sitemapType(sitemap)
      if (!buckets.has(type)) buckets.set(type, [])
      if (buckets.get(type).length >= limit) continue
      log(`site haritası: ${sitemap}`)
      const child = await get(sitemap)
      if (child.status !== 200) {
        siteFindings.push({ url: sitemap, type: 'site', seviye: 'hata', kod: 'site-haritasi', mesaj: `Alt site haritası ${child.status} döndü.` })
        continue
      }
      for (const url of readLocs(child.text)) add(url, type, buckets.get(type))
    }
  } else {
    buckets.set('diger', [])
    for (const url of readLocs(index.text)) add(url, 'diger', buckets.get('diger'))
  }
  for (const bucket of buckets.values()) targets.push(...bucket)

  const pages = []
  let limited = 0
  for (const [position, target] of targets.entries()) {
    if (limited >= 3) {
      siteFindings.push({ url: target.url, type: 'site', seviye: 'hata', kod: 'hiz-siniri', mesaj: `Mağaza art arda 429 döndü; denetim ${targets.length - position} sayfa kala durdu. --gecikme değerini artırıp bir süre sonra yeniden deneyin.` })
      break
    }
    log(`${position + 1}/${targets.length} ${target.url}`)
    try {
      const response = await get(target.url)
      limited = response.status === 429 ? limited + 1 : 0
      if (response.status === 200 && !/html/i.test(response.contentType)) {
        log(`  HTML değil, atlandı (${response.contentType})`)
        continue
      }
      const html = parseHtml(response.status === 200 ? response.text : '')
      const page = { ...target, status: response.status, finalUrl: response.finalUrl, html }
      page.findings = checkPage(page)
      pages.push(page)
    } catch (error) {
      pages.push({ ...target, status: 0, html: parseHtml(''), findings: [{ seviye: 'hata', kod: 'erisim', mesaj: error.message }] })
    }
  }

  const findings = [
    ...siteFindings,
    ...pages.flatMap((page) => page.findings.map((item) => ({ url: page.url, type: page.type, ...item }))),
    ...checkSite(pages),
  ]
  return { origin: base.href, pages, findings }
}
