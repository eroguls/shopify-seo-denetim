#!/usr/bin/env node
import { writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

import { audit } from '../src/crawl.js'
import { toCsv, toMarkdown, toText } from '../src/report.js'

const HELP = `Kullanım: seo-denetim <mağaza adresi> [seçenekler]

Mağazanın site haritasından her türden (ürün, koleksiyon, sayfa, blog) örnek sayfalar alır ve
başlık, meta açıklama, canonical, noindex, h1, alt metin, JSON-LD ve tekrar eden başlıkları denetler.

Seçenekler:
  --sinir <n>      Tür başına en fazla sayfa (varsayılan 20)
  --gecikme <ms>   İstekler arası bekleme (varsayılan 500)
  -o, --cikti      Bulguları CSV olarak yaz
  --md <dosya>     Özeti Markdown olarak yaz
  --sessiz         İlerlemeyi yazma
  -h, --yardim     Bu metin

Yalnızca sahibi olduğunuz ya da izin aldığınız mağazaları denetleyin.`

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    sinir: { type: 'string' },
    gecikme: { type: 'string' },
    cikti: { type: 'string', short: 'o' },
    md: { type: 'string' },
    sessiz: { type: 'boolean' },
    yardim: { type: 'boolean', short: 'h' },
  },
})

if (values.yardim || !positionals[0]) {
  console.log(HELP)
  process.exit(values.yardim ? 0 : 1)
}

const address = /^https?:\/\//.test(positionals[0]) ? positionals[0] : `https://${positionals[0]}`
const number = (value, fallback) => {
  const parsed = Number(value)
  return value === undefined ? fallback : Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

try {
  const result = await audit(address, {
    sinir: number(values.sinir, 20),
    gecikme: number(values.gecikme, 500),
    ilerleme: values.sessiz ? undefined : (message) => process.stderr.write(message + '\n'),
  })
  process.stdout.write(toText(result))
  if (values.cikti) {
    writeFileSync(values.cikti, toCsv(result.findings))
    console.log(`\nBulgular: ${values.cikti}`)
  }
  if (values.md) {
    writeFileSync(values.md, toMarkdown(result))
    console.log(`Özet: ${values.md}`)
  }
} catch (error) {
  console.error(`Hata: ${error.message}`)
  process.exit(1)
}
