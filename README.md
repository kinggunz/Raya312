# Ayaraya config
1. Upload semua isi folder ini ke repo GitHub (branch main).
2. Tab Actions -> "Build APK" -> tunggu hijau (atau Run workflow).
3. Unduh artifact "Ayaraya-config-apk" -> ekstrak -> Ayaraya-config.apk -> install.
Ubah tampilan: edit web/src/main.js lalu `npm i && npx esbuild web/src/main.js --bundle --minify --format=iife --outfile=app/src/main/assets/app.js`

## Unity AssetBundle
Buka file bundle (UnityFS; kompresi none/LZ4/LZMA). Tab "Unity": pilih mesh & tekstur, "Ganti dari gambar", lalu "Simpan Bundle Unity".
Tekstur pengganti ditulis sebagai RGBA32 (ukuran asli tekstur). Tekstur ASTC/Crunch belum bisa ditampilkan (tetap bisa diganti).

Catatan: bundle Free Fire memakai SerializedFile v22, tekstur ASTC (8x8/10x10) dan mesh terkompresi. Semuanya sudah didukung (diuji pada file asli, hasil identik dengan UnityPy).
