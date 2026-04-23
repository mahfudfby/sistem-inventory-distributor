# UD DUTA PANGAN — Firebase Backend
## Pengganti 100% Google Apps Script (Code.gs)

---

## 📁 Struktur Project

```
dutapangan-backend/
├── functions/
│   ├── index.js          ← 🔥 Backend utama (pengganti Code.gs)
│   └── package.json      ← Dependensi Node.js
├── public/
│   └── index.html        ← Frontend (index_firebase.html yang sudah dibuat)
├── firebase.json         ← Konfigurasi Firebase project
├── firestore.rules       ← Aturan keamanan Firestore
├── firestore.indexes.json← Index composite Firestore
├── .firebaserc           ← Project ID Firebase
└── .env.example          ← Template environment variables
```

---

## 🗺️ Pemetaan: Code.gs → Firebase Cloud Functions

| Code.gs (GAS)                     | Firebase Backend (Node.js)             |
|------------------------------------|----------------------------------------|
| `loginUser(username, password)`    | `POST /api/auth/login`                 |
| `requestOTP(email)`               | `POST /api/auth/request-otp`           |
| `verifyOTPAndReset(email,otp,pw)` | `POST /api/auth/verify-otp`            |
| `getDashboardData()`              | `GET  /api/dashboard`                  |
| `getDropdownData()`               | `GET  /api/dropdown`                   |
| `getInventoryData()`              | `GET  /api/inventory`                  |
| `addInventoryItem(obj, user)`     | `POST /api/inventory`                  |
| `updateInventoryItem(sku,obj,u)`  | `PUT  /api/inventory/:sku`             |
| `deleteInventoryItem(sku, user)`  | `DELETE /api/inventory/:sku`           |
| `getBarangMasukData()`            | `GET  /api/barang-masuk`               |
| `addBarangMasuk(t, user)`         | `POST /api/barang-masuk`               |
| `deleteBarangMasuk(id, user)`     | `DELETE /api/barang-masuk/:docId`      |
| `getBarangKeluarData()`           | `GET  /api/barang-keluar`              |
| `addSuratLoadingMassal(p, user)`  | `POST /api/barang-keluar/loading`      |
| `deleteBarangKeluar(id, user)`    | `DELETE /api/barang-keluar/:docId`     |
| `getInvoiceData(trxId)`           | `GET  /api/barang-keluar/invoice/:id`  |
| `getUserData()`                   | `GET  /api/users`                      |
| `addUser(u, logUser)`             | `POST /api/users`                      |
| `updateUser(un, u, logUser)`      | `PUT  /api/users/:username`            |
| `deleteUser(username, logUser)`   | `DELETE /api/users/:username`          |
| `getKontakData()`                 | `GET  /api/kontak`                     |
| `addKontak(k, u)`                 | `POST /api/kontak`                     |
| `updateKontak(id, k, u)`          | `PUT  /api/kontak/:id`                 |
| `deleteKontak(id, u)`             | `DELETE /api/kontak/:id`               |
| `getLogsData()`                   | `GET  /api/logs`                       |
| `deleteLogs(u)`                   | `DELETE /api/logs`                     |
| `getRekapPenjualanMutasi(b,t)`    | `GET  /api/rekap?bulan=7&tahun=2025`   |
| `getPublicStock()`                | `GET  /api/public/stock`               |

---

## 🚀 Langkah Deploy (Step-by-Step)

### 1. Prasyarat
```bash
# Install Node.js v18+ (https://nodejs.org)
node --version  # harus v18 atau lebih

# Install Firebase CLI
npm install -g firebase-tools

# Login Firebase
firebase login
```

### 2. Buat Firebase Project
1. Buka https://console.firebase.google.com
2. Klik **Add Project** → beri nama → tunggu proses
3. Aktifkan **Firestore Database**:
   - Build → Firestore Database → Create database
   - Pilih mode **Production** → pilih region `asia-southeast1` (Singapore)
4. Catat **Project ID** (ada di Project Settings)

### 3. Siapkan Gmail App Password (untuk OTP)
1. Buka https://myaccount.google.com
2. Security → 2-Step Verification → aktifkan dulu jika belum
3. Security → App passwords → Generate → pilih "Mail" → salin password 16 karakter

### 4. Set Environment Variables
```bash
firebase functions:config:set \
  email.user="akungmail@gmail.com" \
  email.pass="xxxx-xxxx-xxxx-xxxx" \
  email.from="UD DUTA PANGAN <akungmail@gmail.com>" \
  app.secret="ganti-ini-string-acak-panjang-min-32-karakter"

# Verifikasi
firebase functions:config:get
```

### 5. Update .firebaserc
Ganti `YOUR-FIREBASE-PROJECT-ID` dengan Project ID Firebase Anda:
```json
{
  "projects": {
    "default": "dutapangan-prod"
  }
}
```

### 6. Siapkan Frontend
```bash
mkdir -p public
# Copy index_firebase.html ke folder public/
cp /path/to/index_firebase.html public/index.html
```

### 7. Update Frontend (index.html)
Di dalam `index_firebase.html`, cari konstanta ini dan isi:
```javascript
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSy...",        // dari Firebase Console
  authDomain:        "project.firebaseapp.com",
  projectId:         "your-project-id",
  storageBucket:     "project.appspot.com",
  messagingSenderId: "123456789",
  appId:             "1:123:web:abc"
};

const API_BASE_URL = "https://asia-southeast1-YOUR-PROJECT-ID.cloudfunctions.net/api";
const APP_SECRET   = "ganti-ini-string-acak-panjang-min-32-karakter"; // sama dengan functions:config
```

> ⚠️ **PENTING**: Nilai `APP_SECRET` harus identik antara frontend (`APP_SECRET`) dan backend (`functions:config set app.secret=...`)

### 8. Install Dependencies & Deploy
```bash
cd functions
npm install

cd ..
firebase deploy
# atau deploy bertahap:
firebase deploy --only firestore:rules  # rules dulu
firebase deploy --only functions        # lalu backend
firebase deploy --only hosting          # terakhir frontend
```

### 9. Catat URL API Anda
Setelah deploy, URL API akan terlihat di terminal:
```
Function URL (api): https://asia-southeast1-YOUR-PROJECT-ID.cloudfunctions.net/api
```

Masukkan URL ini ke `API_BASE_URL` di `index.html` dan redeploy hosting.

---

## 🔧 Cara Tes API (Tanpa Frontend)

```bash
# Health check
curl https://asia-southeast1-PROJ-ID.cloudfunctions.net/api/health

# Login
curl -X POST https://asia-southeast1-PROJ-ID.cloudfunctions.net/api/auth/login \
  -H "Content-Type: application/json" \
  -H "X-App-Secret: YOUR_APP_SECRET" \
  -d '{"username":"admin","password":"admin123"}'

# Get Inventory
curl https://asia-southeast1-PROJ-ID.cloudfunctions.net/api/inventory \
  -H "X-App-Secret: YOUR_APP_SECRET"

# Get Dashboard
curl https://asia-southeast1-PROJ-ID.cloudfunctions.net/api/dashboard \
  -H "X-App-Secret: YOUR_APP_SECRET"
```

---

## 🧪 Test Lokal dengan Emulator

```bash
# Jalankan emulator lokal (tidak perlu deploy ke Firebase)
npm run serve
# atau
firebase emulators:start --only functions,firestore

# URL lokal:
# API:       http://127.0.0.1:5001/PROJECT-ID/asia-southeast1/api
# Firestore: http://127.0.0.1:8080
# UI:        http://127.0.0.1:4000
```

---

## 📊 Migrasi Data dari Google Sheets

Untuk import data dari Google Sheets ke Firestore, gunakan script migrasi:

```javascript
// Jalankan via: node migrate.js
// (buat file migrate.js di root project)

const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccountKey.json"); // download dari Firebase Console

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function importInventory() {
  const items = [
    // Data dari export Google Sheets (JSON)
    { sku: "SKU-001", namaBarang: "Pangsit Ayam", brand: "Duta Pangan", stok: 500, hargaJual: 25000, settingPcs: 50, pakaiKarton: true },
    // ... tambah item lainnya
  ];

  const batch = db.batch();
  items.forEach(item => {
    const ref = db.collection("inventory").doc(item.sku);
    batch.set(ref, { ...item, createdAt: admin.firestore.FieldValue.serverTimestamp() });
  });
  await batch.commit();
  console.log("Import selesai!");
}

async function importUsers() {
  const crypto = require("crypto");
  const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

  const users = [
    { username: "admin", password: sha256("admin123"), namaLengkap: "Super Admin", role: "Administrator", email: "admin@dutapangan.com" },
    // ... user lainnya
  ];

  const batch = db.batch();
  users.forEach(u => {
    const ref = db.collection("users").doc(u.username);
    const { username, ...data } = u;
    batch.set(ref, { ...data, createdAt: admin.firestore.FieldValue.serverTimestamp() });
  });
  await batch.commit();
  console.log("Import user selesai!");
}

importInventory().then(importUsers).catch(console.error);
```

---

## 🔒 Keamanan Produksi

| Layer | Implementasi |
|-------|-------------|
| **API Auth** | Header `X-App-Secret` di setiap request |
| **Password** | SHA-256 hash (kompatibel dengan client browser) |
| **OTP** | Hash tersimpan di Firestore, bukan plaintext, expire 10 menit |
| **Firestore** | Rules deny semua akses langsung dari browser |
| **Admin SDK** | Bypass semua rules (hanya bisa dipakai di Cloud Functions) |
| **CORS** | Dikonfigurasi di Express (`cors({ origin: true })`) |
| **Rate Limit** | Tambahkan `express-rate-limit` jika diperlukan |

---

## ❓ Troubleshooting

**Error: PERMISSION_DENIED**
→ Admin SDK sudah otomatis bypass Firestore rules. Pastikan `admin.initializeApp()` terpanggil dengan benar.

**Error: Cannot find module 'express'**
→ Jalankan `cd functions && npm install`

**Email OTP tidak terkirim**
→ Cek Gmail App Password (bukan password biasa). Pastikan 2FA aktif di Google Account.
→ Cek `firebase functions:config:get` apakah nilai email sudah tersimpan.

**Cold start lambat**
→ Normal untuk Cloud Functions. Bisa upgrade ke `memory: "512MB"` atau gunakan Cloud Run untuk traffic tinggi.

**CORS Error dari browser**
→ Pastikan `cors({ origin: true })` ada di Express setup (sudah ada di index.js).
