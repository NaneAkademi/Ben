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
- **Garaj:** 3 tank sınıfı — Çita (hafif, hızlı), Kurt (orta), Ayı (ağır, kalın zırh, yavaş doldurma). Kamuflaj renkleri seviye atladıkça açılır.
- **Gerçekçi atış:** Mermiler yerçekimiyle eğrisel uçar, uçuş süresi vardır. Hareket halindeyken ve taret dönerken nişan dağılır;
  durunca daire daralır. Zırh yüzeyi önemlidir: ön zırh kalın, yan ve arka zayıf; dik açıyla gelmeyen mermi sekebilir.
- **Mühimmat ve ekipman:** ZD (zırh delici) ve YP (yüksek patlayıcı, alan hasarı) mermi, sis perdesi, tamir kiti.
- **Haritalar:** Yeşil Vadi, Çöl Üssü, Kuzey Cephesi — her maçta yeniden üretilen arazi: köy evleri, ahırlar, konteyner yığınları,
  gölet, yollar, tepeler, ağaçlar, kum torbası siperleri, tank tuzakları, patlayan variller.
- **Tecrübe ve seviye:** Maç sonunda imha, hasar, dalga ve zafere göre TP kazanılır; istatistikler profilde tutulur.
- Grafik: aydınlık gökyüzü ve çevre ışığı, gölgeler, rüzgârda sallanan çimenler, su yüzeyi, patlama/duman/kıvılcım efektleri,
  yüksek ayarda parlama (bloom). Parlaklık ayarı vardır; kare hızı düşerse çözünürlük kendiliğinden ayarlanır.
- Sesler anlık üretilir: dizel motor ve palet sesi, mesafeye göre gecikmeli ve yankılı top atışı, mermi ıslığı, sekme, zırh delinmesi;
  titreşim desteği.

### Kontroller

| | Dokunmatik | Klavye / fare | Oyun kolu |
|---|---|---|---|
| Sürüş | Sol joystick | W A S D / oklar | Sol çubuk |
| Kamera ve taret | Ekranın sağ yarısında parmakla kaydır | Fare (tıklayınca kilitlenir) | Sağ çubuk |
| Ateş | ATEŞ (basılıyken kaydırarak nişan alınabilir) | Boşluk / sol tık | RT / A |
| Dürbün (yakınlaştır) | Nişangâh tuşu | Z / sol Shift / sağ tık | LT |
| Mermi seçimi | ZD / YP | 1 / 2 | X / B |
| Sis / Tamir | Sis ve anahtar tuşları | Q / R | LB / RB |
| Menü | ❚❚ ya da geri tuşu | Esc | Start |

Taret, kameranın baktığı yere döner; ekranın ortasındaki artı nişangâh, küçük daire ise namlunun gerçekte nereye baktığını gösterir.
Ayarlar → Kontrol bölümünden hassasiyet, dikey eksen ters çevirme ve nişan yardımı değiştirilebilir.

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
Otomatik testler (Playwright): `node test/smoke.cjs`, `node test/long.cjs`, `node test/multi.cjs`, `node test/layout.cjs`, `node test/edge.cjs`.

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
