# shopify-seo-denetim

Bir Shopify mağazasının teknik SEO’sunu site haritasından örnekleyerek denetleyen komut satırı
aracı. Ana sayfayı ve her türden (ürün, koleksiyon, sayfa, blog) belirli sayıda sayfayı açar,
sorunları satır satır listeler.

Bağımlılığı yoktur; Node.js 20 ya da üstü yeterlidir.

```bash
npx github:eroguls/shopify-seo-denetim magazaniz.com --sinir 20 -o bulgular.csv --md ozet.md
```

Örnek çıktı (sayılar örnektir):

```
https://magazaniz.com/ · 61 sayfa denetlendi
4 hata, 37 uyarı, 12 bilgi

Hata   canonical-yok               4 sayfa  ör. https://magazaniz.com/pages/kampanya
Uyarı  aciklama-yok               21 sayfa  ör. https://magazaniz.com/collections/yeni
Uyarı  baslik-tekrar               8 sayfa  ör. https://magazaniz.com/products/kupa-mavi
...
```

## Ne denetlenir

| Kod | Seviye | Ne zaman |
| --- | --- | --- |
| `durum-kodu` | hata | Site haritasındaki sayfa 200 dönmüyor |
| `noindex` | hata | Site haritasındaki sayfada `robots` noindex var |
| `canonical-yok`, `canonical-baska-alan` | hata | Canonical yok ya da başka bir alan adını gösteriyor |
| `baslik-yok` | hata | `<title>` yok |
| `json-ld-bozuk` | hata | JSON-LD bloğu JSON olarak okunamıyor |
| `robots-engelli` | uyarı | Site haritasındaki adres robots.txt ile engelli |
| `yonlendirme` | uyarı | Site haritasındaki adres başka bir adrese yönleniyor |
| `baslik-uzun`, `baslik-kisa` | uyarı | Başlık 60 karakterden uzun ya da 15’ten kısa |
| `aciklama-yok` | uyarı | Meta açıklama yok |
| `baslik-tekrar`, `aciklama-tekrar` | uyarı | Birden fazla sayfada aynı başlık ya da açıklama |
| `h1-yok` | uyarı | Sayfada h1 yok |
| `alt-yok` | uyarı | `alt` özelliği hiç olmayan görsel |
| `urun-isaretleme-yok`, `urun-teklif-yok`, `urun-gorsel-yok` | uyarı | Ürün sayfasında Product yapısal verisi, `offers` ya da `image` eksik |
| `canonical-farkli` | bilgi | Canonical aynı alanda başka bir sayfayı gösteriyor |
| `aciklama-uzun`, `aciklama-kisa` | bilgi | Açıklama 160 karakterden uzun ya da 50’den kısa |
| `h1-birden-fazla` | bilgi | Birden fazla h1 |
| `alt-bos` | bilgi | Ürün sayfasında alt metni boş görsel |
| `og-eksik`, `lang-yok` | bilgi | `og:title`/`og:image` ya da `<html lang>` eksik |

Karakter sınırları kesin kural değil, arama sonucunda kesilme riskine dair yaklaşık değerlerdir.
Bir bulgunun düzeltilmesi gerekip gerekmediğine sayfanın amacına bakarak karar verin.

## Seçenekler

| Seçenek | Varsayılan | |
| --- | --- | --- |
| `--sinir <n>` | 20 | Tür başına en fazla sayfa |
| `--gecikme <ms>` | 500 | İki istek arasındaki bekleme |
| `-o, --cikti <dosya>` | | Bütün bulgular CSV olarak (Excel ve Google E-Tablolar açar) |
| `--md <dosya>` | | Koda göre gruplanmış Markdown özet |
| `--sessiz` | | İlerleme satırlarını yazma |

## Nasıl çalışır

1. `robots.txt`’i okur; `User-agent: *` grubundaki kuralları uygular, engelli adresleri açmaz.
2. `sitemap.xml` dizinindeki alt site haritalarını (`sitemap_products_1.xml` …) türüne göre ayırır
   ve her türden ilk `--sinir` adresi alır.
3. Sayfaları **tek tek**, aralarında `--gecikme` kadar bekleyerek açar. HTML olmayan adresleri
   atlar.
4. Her sayfada yukarıdaki kontrolleri, sonda bütün sayfalar arasında tekrar kontrollerini yapar.

İstekler `shopify-seo-denetim/0.1 (+https://github.com/eroguls/shopify-seo-denetim)` kimliğiyle
gönderilir.

## Hız sınırı

Shopify, mağazalara gelen otomatik istekleri sınırlayabilir. Mağaza `429` dönerse araç bir kez
kısa bekleyip yeniden dener; olmazsa sayfayı `durum-kodu` (429) olarak bildirir. Art arda üç
429’da denetimi durdurur. Bu durumda `--gecikme 2000` gibi daha uzun bir bekleme ve daha küçük bir
`--sinir` ile bir süre sonra yeniden deneyin. Araç bu korumayı aşmaya çalışmaz.

## Sınırlar

- HTML, sayfa ilk açıldığında sunucudan gelen hâliyle okunur; JavaScript ile sonradan eklenen
  içerik (ör. bazı uygulamaların yorum ve yapısal veri blokları) görünmez. Google bu içeriği
  işleyebilir; sonuçları Search Console ile karşılaştırın.
- HTML okuyucu bilerek basit tutuldu: başlık, meta/link/img etiketleri, h1’ler ve JSON-LD
  blokları çıkarılır. Tam bir tarayıcı ya da ayrıştırıcı değildir.
- Hız (Core Web Vitals) ölçülmez. Bunun için PageSpeed Insights ya da Search Console kullanın.
- Yalnızca sahibi olduğunuz ya da denetim için izin aldığınız mağazaları denetleyin.

## Kütüphane olarak

```js
import { audit } from 'shopify-seo-denetim'

const result = await audit('https://magazaniz.com', { sinir: 10, gecikme: 1000 })
console.log(result.findings.filter((item) => item.seviye === 'hata'))
```

## Geliştirme

```bash
npm test
```

Testler yerel bir sahte mağaza (robots.txt, site haritası dizini, yönlendirme, 404, tekrar eden
başlıklar) üzerinde uçtan uca çalışır; dışarıya istek atmaz.

## Lisans

MIT · [Salih Eroğul](https://saliherogul.com), bağımsız Shopify geliştiricisi.
