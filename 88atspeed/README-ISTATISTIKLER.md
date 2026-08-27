# İstatistikler Sekmesi — Proje Özeti

Bu belge, **88ATSPEED** uygulamasındaki **İstatistikler** sekmesi üzerinde yapılan çalışmaların özetidir. Yeni bir sohbet penceresinde devam etmek için referans olarak kullanılabilir.

---

## Amaç

GÖSTERİM sekmesinde yüklenen hesaplama kaydındaki at geçmişlerini kullanarak, **program koşusundaki her at için rakip kıyaslı yüzdelik istatistikler** üretmek ve tablo halinde göstermek.

Veri kaynağı: GÖSTERİM kayıt senkronu (`postMessage` → `88atspeed-kayit-loaded`).

---

## Git / Deploy

| Bilgi | Değer |
|-------|-------|
| Branch | `cursor/istatistikler-tab-c2e4` |
| PR | [#11 — İstatistikler sekmesi](https://github.com/harikaotoservisinfo-spec/88atspeed/pull/11) |
| Son build | `20260824r` |
| Deploy komutu | `bash /var/www/88atspeed/deploy/update-on-server.sh cursor/istatistikler-tab-c2e4` |

**Önemli:** Sunucuya SSH cloud agent ortamından çalışmıyor; deploy kullanıcı tarafından sunucuda yapılıyor.

---

## Ana Dosyalar

| Dosya | Görev |
|-------|-------|
| `public/js/istatistik-engine.js` | Tüm istatistik hesaplamaları |
| `public/istatistikler.html` | UI, tablo render, CSS, cache sürümü |
| `public/index.html` | Ana sayfa; iframe `istatistikler.html?v=20260824q` |
| `public/js/formula-engine.js` | DR/SL, 1DR/SL, SON800 referans tanımları |
| `public/js/utils.js` | `dereceToSalise`, `metreBasiSalise`, `parseDateTR` vb. |

---

## Veri Akışı

```
GÖSTERİM kaydı yüklendi
    ↓ postMessage (88atspeed-kayit-loaded)
istatistikler.html → onKayitLoaded()
    ↓
buildIstatistikGrid(data, hipodrom, tarih)
    ↓ her koşu için
IstatistikEngine.buildRaceIstatistikPackage(race, hedefSehir, programTarih)
    ↓
Tablo render (koşu kartları, sticky # ve AT İSMİ sütunları)
```

**Kurallar (genel):**
- Program günü koşuları hesaba katılmaz.
- Atlar tabloda `no` sırasına göre listelenir.
- Yüzde rozetleri: `.istat-pct` + `pctClass()` (0 / düşük / orta / iyi / yüksek).

---

## Tamamlanan Sütunlar

### 1. Şehir Deneyimi
- Atın bilinen koşuları içinde program hipodromunda koşma oranı.

### 2. SON800-1 / SON800-2 (turkuaz — **değiştirilmemeli**)
- **Fonksiyon:** `computeSon800DepthGrid(race, programTarih, alan)`
- Derinlik sütunları: `SON`, `1 ÖNCE`, `2 ÖNCE` … (alandaki max koşu sayısı kadar)
- Her derinlikte rakip kıyası: en düşük SON800 = %100, diğerleri `(min / değer) × 100`
- SON800-2: `son800_iki` yoksa (`-`) o koşu **atlanır** (son800_bir'e düşülmez)

### 3. 800-1 ORAN / 800-2 ORAN (turuncu/sarı — mevcut sütunlara ek)
- **Fonksiyon:** `computeSon800AnaOranGrid(race, programTarih, alan)`
- Koşunun **ana SON800 derecesi** (tüm derinliklerdeki en iyi süre) = %100
- Koşunun **en kötü SON800 derecesi** (tüm derinliklerdeki en yüksek süre) = %0
- Her hücre: `pctLinearMinBest(atSalise, anaSalise, kotuSalise)` — doğrusal min–max ölçek
- Aynı derinlik sütun yapısı (SON, 1 ÖNCE …)

### 4. SON800·1DR/SL (mor — **derinlik bazlı**)
- **Fonksiyon:** `computeSon800Dr1slKorelasyonGrid(race, programTarih)`
- Derinlik sütunları: `SON`, `1 ÖNCE`, `2 ÖNCE` … (atın geçerli koşu sayısı kadar, alandaki max)
- Her derinlikte aynı koşudan SON800-1 + 1DR/SL birlikte değerlendirilir
- Rakip kıyası + geometrik ortalama (tek sütun değil, tüm geçmiş koşular)

### 5. Dönem İçi Koşu Oranı
- Son 3 ay / 1 ay / 15 gün içindeki koşu oranı.

### 6. Genel İlk 3 / İlk 2 / İlk 1
- Tüm koşularda sıra başarı oranları (3 ay / 1 ay / 15 gün).

### 7. Ş/M İlk 3 / İlk 2 / İlk 1
- Aynı şehir + koşu mesafesinde sıra başarı oranları (3 ay / 1 ay / 15 gün).
- Eşleşen geçmiş yoksa `—` (ör. %0 şehir deneyimi olan atlar).

---

## Motor API Özeti (`istatistik-engine.js`)

```javascript
// SON800 zinciri (yeniden eskiye, program günü hariç)
_kosularSon800Zinciri(kosular, programTarih, alan)
_buildSon800Chains(race, programTarih, alan)

// Mevcut turkuaz sütunlar
computeSon800DepthGrid(race, programTarih, alan)

// Turuncu ORAN sütunları
computeSon800AnaOranGrid(race, programTarih, alan)

// Mor korelasyon sütunları (derinlik bazlı)
_kosularSon800Dr1slZinciri(kosular, programTarih)
computeSon800Dr1slKorelasyonGrid(race, programTarih)

// Ana paket — tüm satırlar + meta
buildRaceIstatistikPackage(race, hedefSehir, programTarih)
```

**`buildRaceIstatistikPackage` dönüşü:**
- `rows[]` — her at için tüm sütun verileri
- `maxDepth1`, `maxDepth2` — SON800 derinlik sayıları
- `oranMaxDepth1`, `oranMaxDepth2`, `oranAnaDerece1`, `oranAnaDerece2`
- `son800Dr1ComparedCount` — korelasyon sütununda kıyaslanan at sayısı

**Satır alanları (önemli):**
- `son8001Depths`, `son8002Depths`, `oran1Depths`, `oran2Depths` (dizi)
- `son800Dr1Depths` (dizi)

---

## Metrik Tanımları (`formula-engine.js` referans)

```javascript
dr_sl = metreBasiSalise(at_derece_salise, mesafe)
birinci_dr_sl = metreBasiSalise(birinci_derece_salise, mesafe)  // GÖSTERİM: 1DR/SL
dr_oran = dr_sl / birinci_dr_sl                                   // GÖSTERİM: DR/1DR

son800_1_sl = dereceToSalise(son800_bir) / 800
```

GÖSTERİM sütunları: DR/SL (11), 1DR/SL (12), DR/1DR (13).

---

## UI Kuralları

1. **Mevcut sütunları değiştirme** — kullanıcı özellikle SON800-1/2 sütunlarının korunmasını istedi; yeni özellikler **yanına eklenir**.
2. İki satırlı grup başlıkları (`renderIstatistikTableHead`).
3. Renkli grup CSS sınıfları: `istat-grp-son8001`, `istat-grp-son8002`, `istat-grp-son800oran1`, `istat-grp-son800oran2`, `istat-grp-son800dr1`, `istat-grp-donem`, `istat-grp-ilk*`, `istat-grp-sm*`.
4. Cache kırma: `ISTAT_BUILD` + script `?v=` + `index.html` iframe `?v=` birlikte güncellenmeli.

---

## SON800 Gelişim Geçmişi (yanlış anlamalar)

Bu konuda birkaç iterasyon yaşandı; doğru model şu:

| Deneme | Durum |
|--------|-------|
| Tek sütun, sadece son koşu | ❌ Yetersiz |
| Tüm koşuların SON800 ortalaması | ❌ Yanlış |
| Tek sütunda derinlik ortalaması | ❌ Yanlış |
| **Her derinlik için ayrı sütun (SON, 1 ÖNCE …)** | ✅ Doğru |
| Ana derece ORAN sütunları (mevcutlara ek) | ✅ Doğru |
| Son koşu SON800 + 1DR/SL korelasyonu (tek sütun) | ✅ Son eklenen |

---

## Test

```bash
cd 88atspeed
node scripts/test-son800-dr1-korelasyon.js
```

Bu script geometrik ortalama mantığını doğrular (en iyi at %100, zayıf metrikli atlar daha düşük).

---

## Bilinen Konular

- Tarayıcı önbelleği: sürüm bump (`ISTAT_BUILD`) şart.
- Ş/M sütunları eşleşen geçmiş olmayan atlarda `—`.
- Cloud agent → production SSH başarısız; deploy manuel.
- `VERSION.txt` yerelde değişmiş olabilir; commit edilmemiş debug scriptleri var (`debug-fosfor-kirmizi.js`, `debug-scrape.js`).

---

## Yapılmaya Çalışılan / Açık Noktalar

### Tamamlandı (kodda mevcut, deploy bekliyor olabilir)
- [x] SON800·1DR/SL korelasyon sütunu
- [x] Unit test scripti (`scripts/test-son800-dr1-korelasyon.js`)

### Henüz yapılmadı / tartışılabilir
- [ ] Sunucuya deploy ve canlı doğrulama (kullanıcı tarafı)
- [ ] Korelasyon formülü alternatifleri (aritmetik ortalama vs geometrik ortalama — şu an geometrik)
- [ ] SON800-2 + 1DR/SL varyantı (ayrı sütun?)
- [ ] DR/SL (atın kendi derecesi) ile korelasyon — sadece 1DR/SL yapıldı
- [ ] Derinlik bazlı korelasyon (SON, 1 ÖNCE …) — kullanıcı tek sütun / son koşu istedi
- [ ] Korelasyon sütununa göre sıralama
- [ ] Koşu başlığında korelasyon özeti rozeti

---

## Son Commitler (branch)

```
c804f05 İstatistikler: SON800·1DR/SL son koşu korelasyon sütunu eklendi
2fec7c4 SON800: mevcut sütunlar korundu, 800 ORAN sütunları eklendi
47eb735 SON800: ana derece %100 referans, sütun başlığında göster
3fa161f SON800: her koşu derinliği için ayrı sütun
```

---

## Hızlı Başlangıç (yeni geliştirici / yeni sohbet)

1. Branch: `git checkout cursor/istatistikler-tab-c2e4`
2. Sunucu: `cd 88atspeed && PORT=3023 node app.js`
3. Tarayıcı: `index.html` → İstatistikler sekmesi → GÖSTERİM kaydı yükle
4. Yeni sütun eklerken: `istatistik-engine.js` → `buildRaceIstatistikPackage` → `istatistikler.html` (CSS + thead + tbody + hint) → `ISTAT_BUILD` bump → commit/push → PR güncelle
