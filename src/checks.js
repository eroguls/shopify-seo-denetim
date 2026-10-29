// Sayfa ve site düzeyindeki SEO kontrolleri. Her bulgu { seviye, kod, mesaj } biçimindedir.
// seviye: hata (dizine girmeyi ya da zengin sonucu doğrudan etkiler), uyari, bilgi.

export const LIMITS = { titleMax: 60, titleMin: 15, descriptionMax: 160, descriptionMin: 50 }

const finding = (seviye, kod, mesaj) => ({ seviye, kod, mesaj })

function sameUrl(a, b) {
  try {
    const x = new URL(a)
    const y = new URL(b)
    const path = (url) => decodeURIComponent(url.pathname).replace(/\/$/, '') || '/'
    return x.host === y.host && path(x) === path(y)
  } catch {
    return false
  }
}

/**
 * @param page { url, finalUrl, status, type, html: parseHtml sonucu }
 */
export function checkPage(page) {
  const out = []
  if (page.status !== 200) {
    const note = page.status === 429 ? ' Shopify hız sınırı; --gecikme değerini artırın.' : ''
    out.push(finding('hata', 'durum-kodu', `Sayfa ${page.status} döndü.${note}`))
    return out
  }
  if (page.finalUrl && !sameUrl(page.url, page.finalUrl)) {
    out.push(finding('uyari', 'yonlendirme', `Site haritasındaki adres ${page.finalUrl} adresine yönleniyor.`))
  }

  const h = page.html
  if (!h.title) out.push(finding('hata', 'baslik-yok', 'Sayfa başlığı (title) yok.'))
  else if (h.title.length > LIMITS.titleMax) out.push(finding('uyari', 'baslik-uzun', `Başlık ${h.title.length} karakter; arama sonucunda kesilebilir.`))
  else if (h.title.length < LIMITS.titleMin) out.push(finding('uyari', 'baslik-kisa', `Başlık ${h.title.length} karakter.`))

  if (!h.description) out.push(finding('uyari', 'aciklama-yok', 'Meta açıklama yok; arama motoru sayfadan bir parça seçer.'))
  else if (h.description.length > LIMITS.descriptionMax) out.push(finding('bilgi', 'aciklama-uzun', `Meta açıklama ${h.description.length} karakter; kesilebilir.`))
  else if (h.description.length < LIMITS.descriptionMin) out.push(finding('bilgi', 'aciklama-kisa', `Meta açıklama ${h.description.length} karakter.`))

  if (/\bnoindex\b/.test(h.robots)) out.push(finding('hata', 'noindex', 'Site haritasındaki sayfada robots noindex var.'))

  if (!h.canonical) out.push(finding('hata', 'canonical-yok', 'Canonical etiketi yok.'))
  else {
    if (h.canonicalCount > 1) out.push(finding('uyari', 'canonical-birden-fazla', `${h.canonicalCount} canonical etiketi var.`))
    let canonical
    try {
      canonical = new URL(h.canonical, page.finalUrl || page.url)
    } catch {
      canonical = null
    }
    if (!canonical) out.push(finding('hata', 'canonical-gecersiz', `Canonical okunamadı: ${h.canonical}`))
    else if (canonical.host !== new URL(page.finalUrl || page.url).host) {
      out.push(finding('hata', 'canonical-baska-alan', `Canonical başka bir alan adını gösteriyor: ${canonical.href}`))
    } else if (!sameUrl(canonical.href, page.finalUrl || page.url)) {
      out.push(finding('bilgi', 'canonical-farkli', `Canonical başka bir sayfayı gösteriyor: ${canonical.pathname}`))
    }
  }

  if (h.h1s.length === 0) out.push(finding('uyari', 'h1-yok', 'Sayfada h1 başlığı yok.'))
  else if (h.h1s.length > 1) out.push(finding('bilgi', 'h1-birden-fazla', `${h.h1s.length} h1 başlığı var.`))

  const noAlt = h.images.filter((img) => img.alt === null).length
  if (noAlt) out.push(finding('uyari', 'alt-yok', `${noAlt} görselde alt özelliği hiç yok.`))
  if (page.type === 'urun') {
    const emptyAlt = h.images.filter((img) => img.alt === '').length
    if (emptyAlt) out.push(finding('bilgi', 'alt-bos', `${emptyAlt} görselin alt metni boş; ürün görsellerine açıklama yazın.`))
  }

  for (const error of h.jsonLdErrors) out.push(finding('hata', 'json-ld-bozuk', `JSON-LD okunamadı: ${error}`))

  if (page.type === 'urun') {
    const product = h.findType('Product') || h.findType('ProductGroup')
    if (!product) out.push(finding('uyari', 'urun-isaretleme-yok', 'Product yapısal verisi yok.'))
    else {
      const offers = product.offers || (product.hasVariant && [].concat(product.hasVariant).some((variant) => variant.offers))
      if (!offers) out.push(finding('uyari', 'urun-teklif-yok', 'Product işaretlemesinde offers (fiyat, stok) yok.'))
      if (!product.image) out.push(finding('uyari', 'urun-gorsel-yok', 'Product işaretlemesinde image yok.'))
    }
  }

  if (!h.ogTitle || !h.ogImage) out.push(finding('bilgi', 'og-eksik', 'og:title ya da og:image yok; paylaşımlarda önizleme eksik çıkar.'))
  if (!h.lang) out.push(finding('bilgi', 'lang-yok', '<html> etiketinde lang yok.'))
  return out
}

function duplicates(pages, pick, code, label) {
  const groups = new Map()
  for (const page of pages) {
    const value = page.status === 200 ? pick(page.html) : null
    if (!value) continue
    const key = value.trim().toLowerCase()
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(page)
  }
  const out = []
  for (const [, group] of groups) {
    if (group.length < 2) continue
    for (const page of group) {
      out.push({ url: page.url, type: page.type, ...finding('uyari', code, `${label} ${group.length} sayfada aynı: “${pick(page.html)}”`) })
    }
  }
  return out
}

export function checkSite(pages) {
  return [
    ...duplicates(pages, (h) => h.title, 'baslik-tekrar', 'Başlık'),
    ...duplicates(pages, (h) => h.description, 'aciklama-tekrar', 'Meta açıklama'),
  ]
}
