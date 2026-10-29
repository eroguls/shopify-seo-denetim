import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { checkPage } from '../src/checks.js'
import { audit, isAllowed, parseRobots, readLocs, sitemapType } from '../src/crawl.js'
import { parseHtml } from '../src/html.js'
import { toCsv } from '../src/report.js'

const page = ({ title = 'Keten Gömlek – Örnek Mağaza', description = 'Yazlık keten gömlek, beş renk ve altı beden seçeneğiyle. Ücretsiz değişim.', canonical, h1 = '<h1>Keten Gömlek</h1>', extra = '' } = {}) => `<!doctype html>
<html lang="tr"><head>
<title>${title}</title>
<meta name="description" content="${description}">
${canonical === null ? '' : `<link rel="canonical" href="${canonical}">`}
<meta property="og:title" content="x"><meta property="og:image" content="//cdn/x.jpg">
${extra}
</head><body>${h1}<img src="a.jpg" alt="Keten gömlek önden"></body></html>`

test('HTML okuma: başlık, meta, canonical, h1, alt, JSON-LD', () => {
  const html = parseHtml(`<html lang="tr"><head><title> Kupa &amp; Tabak </title>
    <meta content='El yapımı' name=description>
    <link rel="canonical" href="https://a.com/products/kupa">
    <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Product","name":"Kupa","offers":{"@type":"Offer"}}]}</script>
    <script type="application/ld+json">{bozuk</script>
    <script>document.write('<h1>sayılmaz</h1>')</script>
    </head><body><!-- <h1>yorum</h1> --><h1>Kupa <span>El</span></h1><img src="1.jpg"><img src="2.jpg" alt=""><noscript><img src="3.jpg"></noscript></body></html>`)
  assert.equal(html.title, 'Kupa & Tabak')
  assert.equal(html.description, 'El yapımı')
  assert.equal(html.canonical, 'https://a.com/products/kupa')
  assert.deepEqual(html.h1s, ['Kupa El'])
  assert.deepEqual(html.images.map((img) => img.alt), [null, ''])
  assert.deepEqual(html.jsonLdTypes, ['Product', 'Offer'])
  assert.equal(html.jsonLdErrors.length, 1)
  assert.equal(html.findType('Product').name, 'Kupa')
  assert.equal(html.lang, 'tr')
})

test('sayfa kontrolleri', () => {
  const codes = (html, extra = {}) =>
    checkPage({ url: 'https://a.com/products/x', finalUrl: 'https://a.com/products/x', status: 200, type: 'urun', html: parseHtml(html), ...extra }).map((item) => item.kod)

  assert.deepEqual(codes(page({ canonical: 'https://a.com/products/x', extra: '<script type="application/ld+json">{"@type":"Product","image":"x","offers":{}}</script>' })), [])
  assert.deepEqual(
    codes(page({ title: 'x'.repeat(70), description: '', canonical: null, h1: '' })),
    ['baslik-uzun', 'aciklama-yok', 'canonical-yok', 'h1-yok', 'urun-isaretleme-yok'],
  )
  assert.ok(codes(page({ canonical: 'https://b.com/products/x' })).includes('canonical-baska-alan'))
  assert.ok(codes(page({ canonical: '/products/y' })).includes('canonical-farkli'))
  assert.ok(codes(page({ canonical: '/products/x', extra: '<meta name="robots" content="noindex,follow">' })).includes('noindex'))
  assert.ok(codes(page({ canonical: '/products/x', extra: '<script type="application/ld+json">{"@type":"Product"}</script>' })).includes('urun-teklif-yok'))
  assert.deepEqual(codes('', { status: 404 }), ['durum-kodu'])
  assert.ok(codes(page({ canonical: '/products/x' }), { finalUrl: 'https://a.com/products/z' }).includes('yonlendirme'))
})

test('robots.txt kuralları', () => {
  const rules = parseRobots(`User-agent: Googlebot\nDisallow: /yalniz-google\n\nUser-agent: *\nDisallow: /cart\nDisallow: /collections/*sort_by*\nAllow: /cart/izinli\n# yorum\nDisallow:\n`)
  assert.equal(rules.length, 3)
  assert.equal(isAllowed(rules, 'https://a.com/cart'), false)
  assert.equal(isAllowed(rules, 'https://a.com/cart/izinli'), true)
  assert.equal(isAllowed(rules, 'https://a.com/collections/all?sort_by=price'), false)
  assert.equal(isAllowed(rules, 'https://a.com/yalniz-google'), true)
  assert.equal(isAllowed(rules, 'https://a.com/products/x'), true)
})

test('site haritası adresleri ve türleri', () => {
  assert.deepEqual(readLocs('<sitemapindex><sitemap><loc>https://a.com/sitemap_products_1.xml?from=1&amp;to=9</loc></sitemap></sitemapindex>'), [
    'https://a.com/sitemap_products_1.xml?from=1&to=9',
  ])
  assert.equal(sitemapType('https://a.com/sitemap_products_1.xml?from=1&to=9'), 'urun')
  assert.equal(sitemapType('https://a.com/sitemap_blogs_1.xml'), 'blog')
})

/* ------------------------------------------------- sahte mağaza ile uçtan uca */

let server
let origin
const routes = {}

before(async () => {
  server = createServer((request, response) => {
    const route = routes[request.url]
    if (!route) {
      response.writeHead(404).end('yok')
      return
    }
    if (route.redirect) {
      response.writeHead(301, { Location: route.redirect }).end()
      return
    }
    response.writeHead(200, { 'Content-Type': route.type || 'text/html; charset=utf-8' }).end(route.body)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${server.address().port}`
  const xml = (urls, tag = 'url') => `<?xml version="1.0"?><${tag === 'url' ? 'urlset' : 'sitemapindex'}>${urls.map((url) => `<${tag}><loc>${url}</loc></${tag}>`).join('')}</${tag === 'url' ? 'urlset' : 'sitemapindex'}>`
  const product = `<script type="application/ld+json">{"@type":"Product","image":"x","offers":{"price":"1"}}</script>`
  Object.assign(routes, {
    '/robots.txt': { type: 'text/plain', body: 'User-agent: *\nDisallow: /pages/gizli\n' },
    '/sitemap.xml': { type: 'application/xml', body: xml([`${origin}/sitemap_products_1.xml?from=1&amp;to=5`, `${origin}/sitemap_pages_1.xml`, `${origin}/sitemap_blogs_1.xml`], 'sitemap') },
    '/sitemap_products_1.xml?from=1&to=5': { type: 'application/xml', body: xml(['a', 'b', 'c', 'd'].map((handle) => `${origin}/products/${handle}`)) },
    '/sitemap_pages_1.xml': { type: 'application/xml', body: xml([`${origin}/pages/hakkimizda`, `${origin}/pages/gizli`, `${origin}/pages/eski`]) },
    '/': { body: page({ title: 'Örnek Mağaza – El yapımı ürünler', canonical: `${origin}/` }) },
    '/products/a': { body: page({ canonical: `${origin}/products/a`, extra: product }) },
    '/products/b': { body: page({ canonical: `${origin}/products/b`, extra: product }) },
    '/products/c': { body: page({ title: 'Seramik Kupa – Örnek Mağaza', canonical: `${origin}/products/c` }) },
    '/pages/hakkimizda': { body: page({ title: 'Hakkımızda – Örnek Mağaza', description: 'Kısa', canonical: null }) },
    '/pages/eski': { redirect: '/pages/hakkimizda' },
  })
})

after(() => server.close())

test('uçtan uca denetim: örnekleme, robots, yönlendirme, tekrarlar', async () => {
  const result = await audit(origin, { sinir: 3, gecikme: 0 })
  assert.deepEqual(
    result.pages.map((item) => [new URL(item.url).pathname, item.type, item.status]),
    [
      ['/', 'ana-sayfa', 200],
      ['/products/a', 'urun', 200],
      ['/products/b', 'urun', 200],
      ['/products/c', 'urun', 200],
      ['/pages/hakkimizda', 'sayfa', 200],
      ['/pages/eski', 'sayfa', 200],
    ],
  )
  const has = (code, path) => result.findings.some((item) => item.kod === code && (!path || new URL(item.url).pathname === path))
  assert.ok(has('robots-engelli', '/pages/gizli'))
  assert.ok(has('site-haritasi'), 'blog site haritası 404')
  assert.ok(has('urun-isaretleme-yok', '/products/c'))
  assert.ok(has('canonical-yok', '/pages/hakkimizda'))
  assert.ok(has('aciklama-kisa', '/pages/hakkimizda'))
  assert.ok(has('yonlendirme', '/pages/eski'))
  assert.ok(has('baslik-tekrar', '/products/a') && has('baslik-tekrar', '/products/b'))
  assert.ok(!has('baslik-tekrar', '/products/c'))
  assert.ok(toCsv(result.findings).startsWith('seviye,kod,tur,adres,mesaj\nhata,'))
})

test('komut satırı CSV ve Markdown yazar', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'seo-denetim-'))
  const bin = fileURLToPath(new URL('../bin/seo-denetim.js', import.meta.url))
  const { stdout } = await promisify(execFile)(process.execPath, [bin, origin, '--sinir', '2', '--gecikme', '0', '--sessiz', '-o', join(dir, 'b.csv'), '--md', join(dir, 'o.md')])
  assert.match(stdout, /sayfa denetlendi/)
  assert.match(readFileSync(join(dir, 'b.csv'), 'utf8'), /^seviye,kod/)
  assert.match(readFileSync(join(dir, 'o.md'), 'utf8'), /^# SEO denetimi/)
})
