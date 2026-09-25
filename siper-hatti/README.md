# Siper Hattı 3D

Telefonda (Android) ve tarayıcıda oynanan, arkadaşlarla **çevrimiçi** oynanabilen 3D tank savaşı.

## İndir

**Android APK:** [Releases sayfası](https://github.com/NaneAkademi/Ben/releases) → en üstteki sürümden `SiperHatti-….apk` dosyasını indir, telefonda aç ve kur.
İlk kurulumda "bilinmeyen kaynaklardan yükleme" izni istenebilir.

Her `siper-hatti/` değişikliğinde GitHub Actions APK'yı kendiliğinden derleyip yeni bir sürüm olarak yayınlar.

## Oyun

- **Hayatta Kal (birlikte):** Kenarlardan gelen düşman tanklarına karşı dalgalar halinde savaş. Her 5. dalgada Komutan Tankı gelir. 1–4 kişi.
- **Ölüm Maçı (karşı karşıya):** Herkes birbirine karşı; belirlenen vuruş sayısına ilk ulaşan kazanır. Boş yerleri botlar doldurabilir.
- **Tek oyuncu:** Her iki mod da internetsiz, botlarla oynanabilir.
- 3 harita teması (Çayır, Çöl, Kar), her maçta yeniden üretilen arazi: yıkık binalar, kum torbası siperleri, kayalar, ağaçlar, patlayan variller.
- Bonuslar: onarım (yeşil), kalkan (mavi), seri atış (turuncu). Yetenekler: ağır mermi (alan hasarı) ve nitro.
- Grafik: gölgeler, sis, gökyüzü, rüzgârda sallanan çimenler, kamuflajlı ayrıntılı tanklar, patlama/duman/kıvılcım efektleri, yüksek ayarda parlama (bloom). Kare hızı düşerse çözünürlük kendiliğinden ayarlanır.
- Sesler anlık üretilir (motor, atış, patlama); titreşim desteği.

### Kontroller

| | Dokunmatik | Klavye | Oyun kolu |
|---|---|---|---|
| Sürüş | Ekranın solunda sürükle | W A S D / oklar | Sol çubuk |
| Ateş | ATEŞ tuşu (basılı tut) | Boşluk / sol tık | RT / A |
| Ağır mermi | AĞIR MERMİ | E / sağ tık | B / RB |
| Nitro | NİTRO | Shift | LB / X |
| Menü | ❚❚ ya da geri tuşu | Esc | Start |

Taret en yakın düşmana kendiliğinden nişan alır.

## Çok oyunculu nasıl çalışıyor? (Sunucu gerekir mi?)

Kendi sunucumuz **yok ve gerekmiyor**. Oda kuran oyuncunun telefonu maçı yönetir (host), diğerleri 4 haneli **oda koduyla** ona bağlanır.
Oyun verisi cihazlar arasında doğrudan (WebRTC, eşler arası) akar. Cihazların birbirini bulması için PeerJS'in ücretsiz genel eşleştirme
sunucusu kullanılır; doğrudan bağlantı kurulamayan ağlarda PeerJS'in ücretsiz aktarma (TURN) sunucusu devreye girer.

GitHub bir oyun sunucusu çalıştıramaz (yalnızca dosya barındırır ve derleme yapar). Burada GitHub'ın görevi:
kaynak kodu saklamak, APK'yı otomatik derlemek ve Releases'ta yayınlamak.

İpucu: Bağlanamazsan (bazı mobil operatörler engelleyebilir) Wi-Fi'ye geçip tekrar dene. Tüm oyuncular aynı sürümü kullanmalı.

## Geliştirme

```bash
cd siper-hatti/web
npm ci
npm run build        # dist/ klasörüne derler
npm run dev          # http://localhost:8080 (değişiklikleri izler)
```

Yerel eşleştirme sunucusuyla test: `npx peerjs --port 9000 --host 127.0.0.1` ve sayfayı `?peer=127.0.0.1:9000` ile aç.
Otomatik testler (Playwright): `node test/smoke.cjs`, `node test/long.cjs`, `node test/multi.cjs`, `node test/layout.cjs`.

### APK

```bash
cd siper-hatti
./tools/build-apk.sh           # ANDROID_HOME (Android SDK) varsa onu kullanır
```

Android projesi Gradle'sız, tek bir `MainActivity` (WebView) içerir; oyun `assets/www` altından
`https://appassets.androidplatform.net/` adresiyle yüklenir. SDK yoksa `TOOLS_DIR` ile yedek araçlar verilebilir
(apktool içindeki aapt2, Robolectric android-all.jar, dalvik-dx, apksig).

**İmza anahtarı:** Güncellemelerin eski sürümün üzerine kurulabilmesi için tüm APK'lar `android/siper.keystore` ile imzalanır
(şifre: `siperhatti`). Bu anahtar depoda herkese açık olduğundan Play Store'a yüklemeden önce kendi anahtarını üretip
`SIPER_KEYSTORE_B64` (base64) ve `SIPER_KEYSTORE_PASS` adlı GitHub Secret'ları olarak ekle; iş akışı otomatik olarak onu kullanır.

### Klasörler

- `web/src` — oyun kodu: `game.js` (maç mantığı ve ağ senkronu), `net.js` (P2P), `session.js` (lobi), `scene.js` (3D sahne),
  `tankModel.js`, `fx.js` (efektler), `ai.js` (botlar), `ui.js`, `input.js`, `audio.js`, `world.js` (harita üretimi)
- `android/` — Android sarmalayıcısı
- `tools/` — APK derleme betiği, ikon üretici
