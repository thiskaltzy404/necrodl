# NecroDL

Paste a video link, get the download. Frontend in `public/`, backend as Vercel serverless functions in `api/`, powered by [scrapr](https://github.com/coflyn/scrapr) (vendored in `scrapr/`, MIT).

## Deploy ke Vercel

1. Upload folder ini ke repo GitHub baru (`git init && git add . && git commit -m "NecroDL" && git push`).
2. Buka vercel.com > Add New > Project > pilih repo tadi.
3. Framework Preset: **Other**. Biarkan Build Command dan Output Directory kosong. Klik Deploy.

Jalankan lokal: `npm i -g vercel && npm install && vercel dev`.

## Struktur

- `public/index.html` - seluruh tampilan (Home, Download, History, Profile, Settings)
- `api/resolve.js` - deteksi platform lalu coba beberapa scraper sampai ada yang berhasil
- `api/download.js` - proxy streaming agar file bisa disimpan dan progress asli tampil (diblokir untuk alamat internal)
- `scrapr/` - library scraper (scraper berbasis browser tidak dipakai di Vercel)

## Catatan

- Scraper bergantung pada situs pihak ketiga, jadi bisa rusak sewaktu-waktu. Cek `scrapr/README.md` untuk status tiap scraper.
- Unduh hanya konten milik sendiri atau yang Anda punya izinnya.
