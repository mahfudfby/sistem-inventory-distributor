/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  SISTEM INVENTORY UD DUTA PANGAN — FIREBASE CLOUD FUNCTIONS BACKEND      ║
 * ║  Pengganti 100% Code.gs (Google Apps Script)                              ║
 * ║                                                                            ║
 * ║  Arsitektur:                                                               ║
 * ║    • Satu HTTP Function "api" (Express Router) → efisien, 1 cold start    ║
 * ║    • Semua fungsi CRUD = route di Express                                  ║
 * ║    • Firebase Admin SDK untuk Firestore (server-side, aman)               ║
 * ║    • Nodemailer (Gmail SMTP) untuk kirim OTP                              ║
 * ║    • Crypto built-in Node.js untuk SHA-256 (cocok dengan client)          ║
 * ║                                                                            ║
 * ║  Cara deploy: firebase deploy --only functions                             ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

"use strict";

// ════════════════════════════════════════════════════════════
// IMPORT DEPENDENCIES
// ════════════════════════════════════════════════════════════
const functions   = require("firebase-functions");
const admin       = require("firebase-admin");
const express     = require("express");
const cors        = require("cors");
const crypto      = require("crypto");
const nodemailer  = require("nodemailer");

// ════════════════════════════════════════════════════════════
// INISIALISASI FIREBASE ADMIN SDK
// ════════════════════════════════════════════════════════════
admin.initializeApp();
const db = admin.firestore();

// ════════════════════════════════════════════════════════════
// KONSTANTA COLLECTION NAMES — SINKRON DENGAN index_firebase.html
// ════════════════════════════════════════════════════════════
const COL = {
  INVENTORY:     "inventory",      // doc ID = SKU
  BARANG_MASUK:  "barangMasuk",    // auto ID
  BARANG_KELUAR: "barangKeluar",   // auto ID, field trxId shared per transaksi
  KONTAK:        "kontak",         // auto ID
  USERS:         "users",          // doc ID = username
  LOGS:          "logs",           // auto ID
  OTP_CODES:     "otpCodes",       // doc ID = sanitized(email)
};

// ════════════════════════════════════════════════════════════
// ENV CONFIG — set via: firebase functions:config:set
//   firebase functions:config:set email.user="akun@gmail.com"
//   firebase functions:config:set email.pass="app-password-gmail"
//   firebase functions:config:set email.from="UD DUTA PANGAN <akun@gmail.com>"
//   firebase functions:config:set app.secret="random-secret-key-panjang"
// ════════════════════════════════════════════════════════════
const cfg = {
  emailUser: (functions.config().email && functions.config().email.user) || process.env.EMAIL_USER || "",
  emailPass: (functions.config().email && functions.config().email.pass) || process.env.EMAIL_PASS || "",
  emailFrom: (functions.config().email && functions.config().email.from) || process.env.EMAIL_FROM || "UD DUTA PANGAN <noreply@dutapangan.com>",
  appSecret:  (functions.config().app   && functions.config().app.secret)  || process.env.APP_SECRET  || "duta-pangan-secret-2025",
};

// ════════════════════════════════════════════════════════════
// EXPRESS APP SETUP
// ════════════════════════════════════════════════════════════
const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "2mb" }));

// ─── Middleware: verifikasi X-App-Secret header (opsional tapi recommended) ───
// Frontend harus mengirim header: "X-App-Secret": <nilai yang sama di config>
// Ini mencegah request langsung dari luar app
function verifySecret(req, res, next) {
  const secret = req.headers["x-app-secret"];
  if (!secret || secret !== cfg.appSecret) {
    return res.status(403).json({ success: false, message: "Akses ditolak: secret tidak valid." });
  }
  next();
}

// Aktifkan verifySecret untuk semua route kecuali health check
app.use("/health", (req, res) => res.json({ status: "OK", ts: new Date().toISOString() }));
app.use(verifySecret);

// ════════════════════════════════════════════════════════════
// UTILITAS
// ════════════════════════════════════════════════════════════

/** SHA-256 — identik dengan crypto.subtle di browser */
function sha256(str) {
  return crypto.createHash("sha256").update(String(str), "utf8").digest("hex");
}

/** Timestamp string WIB */
function tsWIB() {
  return new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
}

/** Buat No Faktur/TrxId */
function genId(prefix) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const yy = String(now.getFullYear()).slice(-2);
  const stamp = yy + pad(now.getMonth()+1) + pad(now.getDate()) +
                pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
  return `${prefix}-${stamp}`;
}

/** Kirim response sukses */
const ok  = (res, data={}, msg="OK") => res.json({ success: true,  message: msg, ...data });
/** Kirim response error */
const err = (res, msg="Terjadi kesalahan.", code=400) => res.status(code).json({ success: false, message: msg });

// ════════════════════════════════════════════════════════════
// NODEMAILER — SMTP GMAIL (atau SMTP lain)
// ════════════════════════════════════════════════════════════
function createTransport() {
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: cfg.emailUser, pass: cfg.emailPass },
  });
}

async function sendOtpEmail(toEmail, userName, otpCode) {
  const transporter = createTransport();
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px;background:#fff;border-radius:12px;border:1px solid #e2e8f0">
      <div style="text-align:center;margin-bottom:24px">
        <h1 style="color:#00C853;font-size:28px;font-weight:900;letter-spacing:2px;margin:0">DUTA PANGAN</h1>
        <p style="color:#718096;font-size:13px;margin:4px 0 0">SISTEM INVENTORY</p>
      </div>
      <h2 style="color:#2C3E50;font-size:20px;font-weight:700">Reset Password</h2>
      <p style="color:#4A5568">Halo <strong>${userName}</strong>,</p>
      <p style="color:#4A5568">Kami menerima permintaan reset password untuk akun Anda. Gunakan kode OTP berikut:</p>
      <div style="text-align:center;margin:28px 0">
        <div style="display:inline-block;background:linear-gradient(135deg,#00C853,#009688);color:#fff;
                    font-size:38px;font-weight:900;letter-spacing:12px;padding:20px 36px;
                    border-radius:12px;box-shadow:0 8px 24px rgba(0,200,83,.3)">${otpCode}</div>
      </div>
      <div style="background:#FFF8E1;border:1px solid #FFE082;border-radius:8px;padding:12px 16px;margin-bottom:20px">
        <p style="margin:0;color:#F57F17;font-size:13px;font-weight:600">
          ⏱ Kode ini berlaku selama <strong>10 menit</strong> dan hanya dapat digunakan sekali.
        </p>
      </div>
      <p style="color:#718096;font-size:13px">Jika Anda tidak meminta reset password, abaikan email ini.</p>
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0">
      <p style="color:#A0AEC0;font-size:11px;text-align:center">
        UD Duta Pangan — Taman Surya Kencana, Sidoarjo<br>
        Email ini dikirim otomatis, harap tidak membalas.
      </p>
    </div>`;
  await transporter.sendMail({
    from: cfg.emailFrom,
    to:   toEmail,
    subject: `[OTP] ${otpCode} — Reset Password UD Duta Pangan`,
    html,
    text: `Kode OTP Anda: ${otpCode}\nBerlaku 10 menit.\n\n— UD Duta Pangan`,
  });
}

// ════════════════════════════════════════════════════════════
// LOG WRITER
// ════════════════════════════════════════════════════════════
async function writeLog(user, activity, detail) {
  try {
    await db.collection(COL.LOGS).add({
      waktu:    admin.firestore.FieldValue.serverTimestamp(),
      waktuStr: tsWIB(),
      user:     String(user || "System"),
      activity: String(activity),
      detail:   String(detail),
    });
  } catch (e) {
    functions.logger.warn("writeLog error:", e.message);
  }
}

// ════════════════════════════════════════════════════════════
// ██████╗  ██████╗ ██╗   ██╗████████╗███████╗███████╗
// ██╔══██╗██╔═══██╗██║   ██║╚══██╔══╝██╔════╝██╔════╝
// ██████╔╝██║   ██║██║   ██║   ██║   █████╗  ███████╗
// ██╔══██╗██║   ██║██║   ██║   ██║   ██╔══╝  ╚════██║
// ██║  ██║╚██████╔╝╚██████╔╝   ██║   ███████╗███████║
// ╚═╝  ╚═╝ ╚═════╝  ╚═════╝    ╚═╝   ╚══════╝╚══════╝
// ════════════════════════════════════════════════════════════

// ────────────────────────────────────────────────────────────
// HEALTH CHECK
// ────────────────────────────────────────────────────────────
app.get("/", (req, res) => res.json({
  app:     "UD Duta Pangan Backend API",
  version: "2.0.0-firebase",
  status:  "running",
  ts:      tsWIB(),
}));

// ────────────────────────────────────────────────────────────
// 1. AUTENTIKASI — LOGIN
// POST /auth/login  { username, password }
// ────────────────────────────────────────────────────────────
app.post("/auth/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return err(res, "Username dan password wajib diisi.");

  try {
    const snap = await db.collection(COL.USERS).doc(String(username).trim()).get();
    if (!snap.exists) return err(res, "Username tidak ditemukan!", 401);

    const d = snap.data();
    if (d.password !== sha256(password)) return err(res, "Password salah!", 401);

    const user = {
      id:       snap.id,
      username: snap.id,
      fullName: d.namaLengkap || snap.id,
      role:     d.role        || "Staff",
      email:    d.email       || "",
    };

    await writeLog(user.fullName, "Login", "Berhasil masuk ke sistem.");
    return ok(res, { user }, "Login Berhasil!");
  } catch (e) {
    functions.logger.error("login:", e);
    return err(res, "Gagal memproses login: " + e.message, 500);
  }
});

// ────────────────────────────────────────────────────────────
// 2. OTP — REQUEST KODE RESET PASSWORD
// POST /auth/request-otp  { email }
// ────────────────────────────────────────────────────────────
app.post("/auth/request-otp", async (req, res) => {
  const { email } = req.body;
  if (!email) return err(res, "Email wajib diisi.");

  try {
    // Cari user berdasarkan email
    const snap = await db.collection(COL.USERS).where("email", "==", email.trim()).limit(1).get();
    if (snap.empty) return err(res, "Email tidak terdaftar di sistem!", 404);

    const userDoc  = snap.docs[0];
    const userName = userDoc.data().namaLengkap || userDoc.id;

    // Generate OTP 6 digit acak
    const otpCode = String(Math.floor(100000 + Math.random() * 900000));
    const otpHash = sha256(otpCode);
    const expiry  = new Date(Date.now() + 10 * 60 * 1000); // +10 menit
    const otpKey  = email.replace(/[^a-zA-Z0-9]/g, "_");

    // Simpan hash OTP ke Firestore (bukan plaintext)
    await db.collection(COL.OTP_CODES).doc(otpKey).set({
      email,
      otpHash,
      expiry:   admin.firestore.Timestamp.fromDate(expiry),
      used:     false,
      username: userDoc.id,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Kirim email via Nodemailer
    await sendOtpEmail(email, userName, otpCode);
    await writeLog(userName, "Request OTP", "Permintaan reset password via email.");

    return ok(res, {}, "Kode OTP berhasil dikirim ke " + email + "!");
  } catch (e) {
    functions.logger.error("request-otp:", e);
    return err(res, "Gagal kirim OTP: " + e.message, 500);
  }
});

// ────────────────────────────────────────────────────────────
// 3. OTP — VERIFIKASI & RESET PASSWORD
// POST /auth/verify-otp  { email, otp, newPassword }
// ────────────────────────────────────────────────────────────
app.post("/auth/verify-otp", async (req, res) => {
  const { email, otp, newPassword } = req.body;
  if (!email || !otp || !newPassword) return err(res, "Semua field wajib diisi.");
  if (String(otp).length !== 6)       return err(res, "Kode OTP harus 6 digit.");
  if (newPassword.length < 6)         return err(res, "Password minimal 6 karakter.");

  try {
    const otpKey = email.replace(/[^a-zA-Z0-9]/g, "_");
    const otpDoc = await db.collection(COL.OTP_CODES).doc(otpKey).get();

    if (!otpDoc.exists) return err(res, "Kode OTP tidak ditemukan. Ulangi dari awal.", 404);

    const d   = otpDoc.data();
    const now = admin.firestore.Timestamp.now();

    if (d.used)                              return err(res, "OTP sudah digunakan. Minta kode baru!", 410);
    if (now.seconds > d.expiry.seconds)      return err(res, "OTP sudah kadaluarsa (10 menit)! Minta kode baru.", 410);
    if (sha256(otp) !== d.otpHash)           return err(res, "Kode OTP salah!", 401);

    // Update password
    const newHash = sha256(newPassword);
    await db.collection(COL.USERS).doc(d.username).update({ password: newHash });

    // Tandai OTP sudah terpakai
    await db.collection(COL.OTP_CODES).doc(otpKey).update({ used: true });

    await writeLog(d.username, "Reset Password", "Password direset berhasil via OTP email.");
    return ok(res, {}, "Password berhasil direset! Silakan login dengan password baru.");
  } catch (e) {
    functions.logger.error("verify-otp:", e);
    return err(res, "Gagal verifikasi OTP: " + e.message, 500);
  }
});

// ────────────────────────────────────────────────────────────
// 4. DASHBOARD — GET SUMMARY + LIST INVENTORI
// GET /dashboard
// ────────────────────────────────────────────────────────────
app.get("/dashboard", async (req, res) => {
  try {
    const [invSnap, masukSnap, keluarSnap] = await Promise.all([
      db.collection(COL.INVENTORY).orderBy("namaBarang").get(),
      db.collection(COL.BARANG_MASUK).get(),
      db.collection(COL.BARANG_KELUAR).get(),
    ]);

    let inventoryList = [], totalItems = 0, totalStock = 0, totalIn = 0, totalOut = 0;

    invSnap.forEach((doc) => {
      const d = doc.data();
      totalItems++;
      const stk = Number(d.stok) || 0;
      totalStock += stk;
      inventoryList.push({
        id:         doc.id,
        code:       doc.id,
        name:       d.namaBarang  || "",
        brand:      d.brand       || "",
        gramasi:    d.gramasi     || "",
        varian:     d.varian      || "",
        stock:      stk,
        useKarton:  d.pakaiKarton !== false,
        settingPcs: Number(d.settingPcs) || 1,
        sellPrice:  Number(d.hargaJual)  || 0,
        buyPrice:   Number(d.hargaBeli)  || 0,
        unit:       d.satuan      || "",
      });
    });

    masukSnap.forEach((doc) => { totalIn  += Number(doc.data().jumlah) || 0; });
    keluarSnap.forEach((doc) => { totalOut += Number(doc.data().jumlah) || 0; });

    return ok(res, { inventoryList, totalItems, totalStock, totalIn, totalOut });
  } catch (e) {
    functions.logger.error("dashboard:", e);
    return err(res, e.message, 500);
  }
});

// ────────────────────────────────────────────────────────────
// 5. DROPDOWN DATA (untuk form select di frontend)
// GET /dropdown
// ────────────────────────────────────────────────────────────
app.get("/dropdown", async (req, res) => {
  try {
    const [invSnap, konSnap] = await Promise.all([
      db.collection(COL.INVENTORY).orderBy("namaBarang").get(),
      db.collection(COL.KONTAK).orderBy("nama").get(),
    ]);

    const items = [], outlets = [], salesmen = [];

    invSnap.forEach((doc) => {
      const d = doc.data();
      const sku = doc.id;
      const parts = [d.brand, d.gramasi, d.varian].filter(Boolean);
      let fullName = d.namaBarang || "";
      if (parts.length) fullName += " — " + parts.join(" ");
      items.push({
        id:         sku,
        code:       sku,
        name:       d.namaBarang  || "",
        fullName:   fullName.trim(),
        sellPrice:  Number(d.hargaJual)  || 0,
        buyPrice:   Number(d.hargaBeli)  || 0,
        stock:      Number(d.stok)       || 0,
        useKarton:  d.pakaiKarton !== false,
        settingPcs: Number(d.settingPcs) || 1,
      });
    });

    konSnap.forEach((doc) => {
      const d = doc.data();
      if (d.kategori === "Salesman") salesmen.push(d.nama);
      else outlets.push(d.nama);
    });

    return ok(res, { items, outlets, salesmen });
  } catch (e) {
    functions.logger.error("dropdown:", e);
    return err(res, e.message, 500);
  }
});

// ════════════════════════════════════════════════════════════
// MASTER BARANG (INVENTORY)
// ════════════════════════════════════════════════════════════

// GET /inventory
app.get("/inventory", async (req, res) => {
  try {
    const snap = await db.collection(COL.INVENTORY).orderBy("namaBarang").get();
    const data = snap.docs.map((doc) => {
      const d = doc.data();
      return {
        id:         doc.id,
        code:       doc.id,
        name:       d.namaBarang  || "",
        brand:      d.brand       || "",
        gramasi:    d.gramasi     || "",
        varian:     d.varian      || "",
        unit:       d.satuan      || "",
        buyPrice:   Number(d.hargaBeli)  || 0,
        sellPrice:  Number(d.hargaJual)  || 0,
        stock:      Number(d.stok)       || 0,
        useKarton:  d.pakaiKarton !== false,
        settingPcs: Number(d.settingPcs) || 1,
        lastUpdate: d.lastUpdate ? d.lastUpdate.toDate().toLocaleString("id-ID") : "",
      };
    });
    return ok(res, { data });
  } catch (e) {
    return err(res, e.message, 500);
  }
});

// POST /inventory  { obj:{code,name,brand,...}, user }
app.post("/inventory", async (req, res) => {
  const { obj, user } = req.body;
  if (!obj || !obj.name) return err(res, "Nama barang wajib diisi.");

  const sku = (obj.code || "").trim() || ("SKU-" + Date.now());
  try {
    const existing = await db.collection(COL.INVENTORY).doc(sku).get();
    if (existing.exists) return err(res, "SKU sudah dipakai! Gunakan kode lain.");

    await db.collection(COL.INVENTORY).doc(sku).set({
      namaBarang:  String(obj.name).trim(),
      brand:       String(obj.brand    || "").trim(),
      gramasi:     String(obj.gramasi  || "").trim(),
      varian:      String(obj.varian   || "").trim(),
      satuan:      String(obj.unit     || "").trim(),
      hargaBeli:   Number(obj.buyPrice)  || 0,
      hargaJual:   Number(obj.sellPrice) || 0,
      stok:        Number(obj.stock)     || 0,
      pakaiKarton: obj.useKarton !== false,
      settingPcs:  Number(obj.settingPcs) || 1,
      lastUpdate:  admin.firestore.FieldValue.serverTimestamp(),
      createdAt:   admin.firestore.FieldValue.serverTimestamp(),
    });

    await writeLog(user, "Tambah Barang", `Menambah Master: ${obj.name} (${sku})`);
    return ok(res, { sku }, "Master Barang berhasil ditambahkan!");
  } catch (e) {
    functions.logger.error("add-inventory:", e);
    return err(res, e.message, 500);
  }
});

// PUT /inventory/:sku  { obj:{...}, user }
app.put("/inventory/:sku", async (req, res) => {
  const oldSku = req.params.sku;
  const { obj, user } = req.body;
  if (!obj || !obj.name) return err(res, "Nama barang wajib diisi.");

  try {
    const ref  = db.collection(COL.INVENTORY).doc(oldSku);
    const snap = await ref.get();
    if (!snap.exists) return err(res, "Barang tidak ditemukan (SKU: " + oldSku + ").", 404);

    const newSku = (obj.code || "").trim() || oldSku;
    const updates = {
      namaBarang:  String(obj.name).trim(),
      brand:       String(obj.brand    || "").trim(),
      gramasi:     String(obj.gramasi  || "").trim(),
      varian:      String(obj.varian   || "").trim(),
      satuan:      String(obj.unit     || "").trim(),
      hargaBeli:   Number(obj.buyPrice)  || 0,
      hargaJual:   Number(obj.sellPrice) || 0,
      pakaiKarton: obj.useKarton !== false,
      settingPcs:  Number(obj.settingPcs) || 1,
      lastUpdate:  admin.firestore.FieldValue.serverTimestamp(),
      // CATATAN: stok TIDAK diubah di sini — hanya diubah via transaksi masuk/keluar
    };

    if (newSku !== oldSku) {
      // SKU berubah: copy ke doc baru, hapus lama
      const currentData = snap.data();
      await db.collection(COL.INVENTORY).doc(newSku).set({
        ...currentData,
        ...updates,
      });
      await ref.delete();
    } else {
      await ref.update(updates);
    }

    await writeLog(user, "Edit Barang", `Mengedit Master: ${obj.name} (${newSku})`);
    return ok(res, { sku: newSku }, "Data barang berhasil diperbarui!");
  } catch (e) {
    functions.logger.error("update-inventory:", e);
    return err(res, e.message, 500);
  }
});

// DELETE /inventory/:sku  { user }
app.delete("/inventory/:sku", async (req, res) => {
  const sku = req.params.sku;
  const { user } = req.body;
  try {
    const snap = await db.collection(COL.INVENTORY).doc(sku).get();
    if (!snap.exists) return err(res, "Barang tidak ditemukan.", 404);
    const nama = snap.data().namaBarang || sku;
    await db.collection(COL.INVENTORY).doc(sku).delete();
    await writeLog(user, "Hapus Barang", `Hapus permanen SKU: ${sku} (${nama})`);
    return ok(res, {}, "Barang berhasil dihapus secara permanen!");
  } catch (e) {
    return err(res, e.message, 500);
  }
});

// ════════════════════════════════════════════════════════════
// BARANG MASUK
// ════════════════════════════════════════════════════════════

// GET /barang-masuk?limit=200
app.get("/barang-masuk", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 200, 500);
  try {
    const [masukSnap, invSnap] = await Promise.all([
      db.collection(COL.BARANG_MASUK).orderBy("createdAt", "desc").limit(limit).get(),
      db.collection(COL.INVENTORY).get(),
    ]);

    // Buat lookup map SKU → data barang
    const invMap = {};
    invSnap.forEach((d) => { invMap[d.id] = d.data(); });

    const data = masukSnap.docs.map((doc) => {
      const d = doc.data();
      const m = invMap[d.sku] || {};
      return {
        id:             doc.id,
        transactionId:  d.fakturId    || doc.id,
        date:           d.tanggal     || "",
        itemCode:       d.sku         || "",
        itemName:       d.namaBarang  || "",
        quantity:       Number(d.jumlah) || 0,
        jenisTransaksi: d.jenisTransaksi || "-",
        keterangan:     d.keterangan  || "-",
        inputBy:        d.inputBy     || "",
        brand:          m.brand       || "-",
        gramasi:        m.gramasi     || "",
        varian:         m.varian      || "",
      };
    });
    return ok(res, { data });
  } catch (e) {
    return err(res, e.message, 500);
  }
});

// POST /barang-masuk  { t:{date,itemCode,itemName,quantity,jenisTransaksi,keterangan}, user }
app.post("/barang-masuk", async (req, res) => {
  const { t, user } = req.body;
  if (!t || !t.itemCode) return err(res, "Kode SKU barang wajib diisi.");
  const qty = parseInt(t.quantity) || 0;
  if (qty <= 0) return err(res, "Jumlah tidak boleh 0.");

  try {
    const fakturId = genId("IN");
    const batch    = db.batch();

    // 1. Catat ke collection Barang Masuk
    const masukRef = db.collection(COL.BARANG_MASUK).doc();
    batch.set(masukRef, {
      fakturId,
      tanggal:        String(t.date       || ""),
      sku:            String(t.itemCode),
      namaBarang:     String(t.itemName   || ""),
      jumlah:         qty,
      jenisTransaksi: String(t.jenisTransaksi || "Hasil Produksi"),
      keterangan:     String(t.keterangan || "-"),
      inputBy:        String(user         || ""),
      createdAt:      admin.firestore.FieldValue.serverTimestamp(),
    });

    // 2. Tambah stok di Inventory (atomic)
    const invRef = db.collection(COL.INVENTORY).doc(t.itemCode);
    batch.update(invRef, {
      stok:       admin.firestore.FieldValue.increment(qty),
      lastUpdate: admin.firestore.FieldValue.serverTimestamp(),
    });

    await batch.commit();
    await writeLog(user, "Barang Masuk", `Terima ${qty} pcs ${t.itemName} (${fakturId})`);
    return ok(res, { fakturId }, "Transaksi Masuk berhasil disimpan & stok diperbarui!");
  } catch (e) {
    functions.logger.error("add-barang-masuk:", e);
    return err(res, e.message, 500);
  }
});

// DELETE /barang-masuk/:docId  { user }
app.delete("/barang-masuk/:docId", async (req, res) => {
  const docId = req.params.docId;
  const { user } = req.body;
  try {
    const snap = await db.collection(COL.BARANG_MASUK).doc(docId).get();
    if (!snap.exists) return err(res, "Transaksi tidak ditemukan.", 404);

    const d   = snap.data();
    const qty = Number(d.jumlah) || 0;
    const batch = db.batch();

    // 1. Hapus catatan masuk
    batch.delete(db.collection(COL.BARANG_MASUK).doc(docId));
    // 2. Kembalikan stok
    batch.update(db.collection(COL.INVENTORY).doc(d.sku), {
      stok:       admin.firestore.FieldValue.increment(-qty),
      lastUpdate: admin.firestore.FieldValue.serverTimestamp(),
    });

    await batch.commit();
    await writeLog(user, "Hapus Brg Masuk", `Hapus & kembalikan stok ${d.sku} (${qty} pcs)`);
    return ok(res, {}, "Transaksi dihapus & stok dikembalikan!");
  } catch (e) {
    return err(res, e.message, 500);
  }
});

// ════════════════════════════════════════════════════════════
// BARANG KELUAR / SURAT LOADING
// ════════════════════════════════════════════════════════════

// GET /barang-keluar?limit=300
app.get("/barang-keluar", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 300, 500);
  try {
    const [keluarSnap, invSnap] = await Promise.all([
      db.collection(COL.BARANG_KELUAR).orderBy("createdAt", "desc").limit(limit).get(),
      db.collection(COL.INVENTORY).get(),
    ]);

    const invMap = {};
    invSnap.forEach((d) => { invMap[d.id] = d.data(); });

    const data = keluarSnap.docs.map((doc) => {
      const d = doc.data();
      const m = invMap[d.sku] || {};
      const qty   = Number(d.jumlah)     || 0;
      const total = Number(d.totalNilai) || 0;
      return {
        id:            doc.id,
        transactionId: d.trxId      || doc.id,
        date:          d.tanggal    || "",
        itemCode:      d.sku        || "",
        itemName:      d.namaBarang || "",
        quantity:      qty,
        tujuan:        d.tujuan     || "",
        total:         total,
        price:         qty > 0 ? Math.round(total / qty) : 0,
        catatan:       d.catatanStruk || "-",
        diskon:        Number(d.diskon) || 0,
        inputBy:       d.inputBy    || "",
        brand:         m.brand      || "-",
        gramasi:       m.gramasi    || "",
        varian:        m.varian     || "",
      };
    });
    return ok(res, { data });
  } catch (e) {
    return err(res, e.message, 500);
  }
});

// POST /barang-keluar/loading  { payload:{date,tujuan,catatan,diskon,items:[{code,name,qty,price}]}, user }
app.post("/barang-keluar/loading", async (req, res) => {
  const { payload, user } = req.body;
  if (!payload || !payload.tujuan)     return err(res, "Nama tujuan wajib diisi.");
  if (!payload.items || !payload.items.length) return err(res, "Keranjang masih kosong!");

  try {
    const trxId  = genId("LOAD");
    const diskon = parseInt(payload.diskon) || 0;
    const batch  = db.batch();

    for (const item of payload.items) {
      const qty       = parseInt(item.qty)   || 0;
      const price     = parseInt(item.price) || 0;
      if (qty <= 0) continue;

      // Catat ke Barang Keluar
      const ref = db.collection(COL.BARANG_KELUAR).doc();
      batch.set(ref, {
        trxId,
        tanggal:        String(payload.date   || ""),
        sku:            String(item.code),
        namaBarang:     String(item.name      || ""),
        jumlah:         qty,
        tujuan:         String(payload.tujuan),
        totalNilai:     qty * price,
        catatanStruk:   String(payload.catatan || "-"),
        diskon,
        jenisTransaksi: "Loading Barang",
        inputBy:        String(user || ""),
        createdAt:      admin.firestore.FieldValue.serverTimestamp(),
      });

      // Potong stok (atomic)
      batch.update(db.collection(COL.INVENTORY).doc(item.code), {
        stok:       admin.firestore.FieldValue.increment(-qty),
        lastUpdate: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    await batch.commit();
    await writeLog(
      user,
      "Surat Loading",
      `Membuat Loading ${trxId} (${payload.items.length} item) → ${payload.tujuan}`
    );
    return ok(res, { trxId }, "Surat Loading berhasil disimpan!");
  } catch (e) {
    functions.logger.error("loading:", e);
    return err(res, e.message, 500);
  }
});

// DELETE /barang-keluar/:docId  { user }
app.delete("/barang-keluar/:docId", async (req, res) => {
  const docId = req.params.docId;
  const { user } = req.body;
  try {
    const snap = await db.collection(COL.BARANG_KELUAR).doc(docId).get();
    if (!snap.exists) return err(res, "Item tidak ditemukan.", 404);

    const d   = snap.data();
    const qty = Number(d.jumlah) || 0;
    const batch = db.batch();

    batch.delete(db.collection(COL.BARANG_KELUAR).doc(docId));
    batch.update(db.collection(COL.INVENTORY).doc(d.sku), {
      stok:       admin.firestore.FieldValue.increment(qty),
      lastUpdate: admin.firestore.FieldValue.serverTimestamp(),
    });

    await batch.commit();
    await writeLog(user, "Hapus Brg Keluar", `Batalkan item ${d.sku} dari ${d.trxId}`);
    return ok(res, {}, "Item dihapus & stok dikembalikan!");
  } catch (e) {
    return err(res, e.message, 500);
  }
});

// GET /barang-keluar/invoice/:trxId
app.get("/barang-keluar/invoice/:trxId", async (req, res) => {
  const trxId = req.params.trxId;
  try {
    const snap = await db.collection(COL.BARANG_KELUAR).where("trxId", "==", trxId).get();
    if (snap.empty) return err(res, "Invoice tidak ditemukan.", 404);

    const result = {
      info:       { date: "", tujuan: "-", catatan: "-", diskon: 0 },
      items:      [],
      subtotal:   0,
      totalAkhir: 0,
    };

    snap.forEach((doc) => {
      const d = doc.data();
      if (!result.info.date) {
        result.info = {
          date:    d.tanggal     || "",
          tujuan:  d.tujuan      || "-",
          catatan: d.catatanStruk || "-",
          diskon:  Number(d.diskon) || 0,
        };
      }
      const qty   = Number(d.jumlah)     || 0;
      const total = Number(d.totalNilai) || 0;
      result.items.push({
        name:  d.namaBarang || "-",
        qty,
        price: qty > 0 ? Math.round(total / qty) : 0,
        total,
      });
      result.subtotal += total;
    });

    result.totalAkhir = result.subtotal - result.info.diskon;
    return ok(res, { invoice: result });
  } catch (e) {
    return err(res, e.message, 500);
  }
});

// ════════════════════════════════════════════════════════════
// USERS (AKUN SISTEM)
// ════════════════════════════════════════════════════════════

// GET /users  (password TIDAK dikembalikan)
app.get("/users", async (req, res) => {
  try {
    const snap = await db.collection(COL.USERS).get();
    const data = snap.docs.map((doc) => {
      const d = doc.data();
      return {
        id:       doc.id,
        username: doc.id,
        fullName: d.namaLengkap || doc.id,
        role:     d.role        || "",
        email:    d.email       || "",
      };
    });
    return ok(res, { data });
  } catch (e) {
    return err(res, e.message, 500);
  }
});

// POST /users  { u:{username,password,fullName,role,email}, user:logUser }
app.post("/users", async (req, res) => {
  const { u, user } = req.body;
  if (!u || !u.username) return err(res, "Username wajib diisi.");
  if (!u.password)       return err(res, "Password wajib diisi untuk akun baru.");

  const username = String(u.username).trim().toLowerCase();
  try {
    const existing = await db.collection(COL.USERS).doc(username).get();
    if (existing.exists) return err(res, "Username sudah digunakan!");

    await db.collection(COL.USERS).doc(username).set({
      password:    sha256(u.password),
      namaLengkap: String(u.fullName || "").trim(),
      role:        String(u.role     || "Staff").trim(),
      email:       String(u.email    || "").trim().toLowerCase(),
      createdAt:   admin.firestore.FieldValue.serverTimestamp(),
    });

    await writeLog(user, "Tambah User", `Membuat akun: ${username}`);
    return ok(res, { username }, "Akun berhasil ditambahkan!");
  } catch (e) {
    return err(res, e.message, 500);
  }
});

// PUT /users/:username  { u:{fullName,role,email,password?}, user:logUser }
app.put("/users/:username", async (req, res) => {
  const username = req.params.username;
  const { u, user } = req.body;
  if (!u) return err(res, "Data update tidak ada.");

  try {
    const ref  = db.collection(COL.USERS).doc(username);
    const snap = await ref.get();
    if (!snap.exists) return err(res, "User tidak ditemukan.", 404);

    const updates = {
      namaLengkap: String(u.fullName || "").trim(),
      role:        String(u.role     || "Staff").trim(),
      email:       String(u.email    || "").trim().toLowerCase(),
      updatedAt:   admin.firestore.FieldValue.serverTimestamp(),
    };

    // Update password hanya jika diisi
    if (u.password && String(u.password).trim() !== "") {
      updates.password = sha256(u.password);
    }

    await ref.update(updates);
    await writeLog(user, "Edit User", `Update data akun: ${username}`);
    return ok(res, {}, "Data akun berhasil diperbarui!");
  } catch (e) {
    return err(res, e.message, 500);
  }
});

// DELETE /users/:username  { user:logUser }
app.delete("/users/:username", async (req, res) => {
  const username = req.params.username;
  const { user } = req.body;
  if (username === user) return err(res, "Tidak bisa menghapus akun Anda sendiri!", 400);

  try {
    const snap = await db.collection(COL.USERS).doc(username).get();
    if (!snap.exists) return err(res, "User tidak ditemukan.", 404);
    await db.collection(COL.USERS).doc(username).delete();
    await writeLog(user, "Hapus User", `Hapus akun: ${username}`);
    return ok(res, {}, "Akun berhasil dihapus!");
  } catch (e) {
    return err(res, e.message, 500);
  }
});

// ════════════════════════════════════════════════════════════
// KONTAK (RELASI BISNIS)
// ════════════════════════════════════════════════════════════

// GET /kontak
app.get("/kontak", async (req, res) => {
  try {
    const snap = await db.collection(COL.KONTAK).orderBy("nama").get();
    const data = snap.docs.map((doc) => {
      const d = doc.data();
      return { id: doc.id, nama: d.nama || "", kategori: d.kategori || "", hp: d.hp || "", alamat: d.alamat || "" };
    });
    return ok(res, { data });
  } catch (e) {
    return err(res, e.message, 500);
  }
});

// POST /kontak  { k:{nama,kategori,hp,alamat}, user }
app.post("/kontak", async (req, res) => {
  const { k, user } = req.body;
  if (!k || !k.nama) return err(res, "Nama relasi wajib diisi.");
  try {
    const ref = await db.collection(COL.KONTAK).add({
      nama:      String(k.nama).trim(),
      kategori:  String(k.kategori || "").trim(),
      hp:        String(k.hp       || "").trim(),
      alamat:    String(k.alamat   || "").trim(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await writeLog(user, "Tambah Relasi", `Menambah kontak: ${k.nama} (${k.kategori})`);
    return ok(res, { id: ref.id }, "Data relasi berhasil ditambahkan!");
  } catch (e) {
    return err(res, e.message, 500);
  }
});

// PUT /kontak/:id  { k:{nama,kategori,hp,alamat}, user }
app.put("/kontak/:id", async (req, res) => {
  const id = req.params.id;
  const { k, user } = req.body;
  if (!k || !k.nama) return err(res, "Nama relasi wajib diisi.");
  try {
    const snap = await db.collection(COL.KONTAK).doc(id).get();
    if (!snap.exists) return err(res, "Relasi tidak ditemukan.", 404);
    await db.collection(COL.KONTAK).doc(id).update({
      nama:     String(k.nama).trim(),
      kategori: String(k.kategori || "").trim(),
      hp:       String(k.hp       || "").trim(),
      alamat:   String(k.alamat   || "").trim(),
    });
    await writeLog(user, "Edit Relasi", `Update kontak: ${k.nama}`);
    return ok(res, {}, "Data relasi berhasil diperbarui!");
  } catch (e) {
    return err(res, e.message, 500);
  }
});

// DELETE /kontak/:id  { user }
app.delete("/kontak/:id", async (req, res) => {
  const id = req.params.id;
  const { user } = req.body;
  try {
    const snap = await db.collection(COL.KONTAK).doc(id).get();
    if (!snap.exists) return err(res, "Relasi tidak ditemukan.", 404);
    const nama = snap.data().nama || id;
    await db.collection(COL.KONTAK).doc(id).delete();
    await writeLog(user, "Hapus Relasi", `Hapus kontak: ${nama}`);
    return ok(res, {}, "Relasi berhasil dihapus!");
  } catch (e) {
    return err(res, e.message, 500);
  }
});

// ════════════════════════════════════════════════════════════
// LOGS (RIWAYAT SISTEM)
// ════════════════════════════════════════════════════════════

// GET /logs?limit=300
app.get("/logs", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 300, 500);
  try {
    const snap = await db.collection(COL.LOGS).orderBy("waktu", "desc").limit(limit).get();
    const data = snap.docs.map((doc) => {
      const d = doc.data();
      const ts = d.waktu ? d.waktu.toDate().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }) : (d.waktuStr || "");
      return { time: ts, user: d.user || "", activity: d.activity || "", detail: d.detail || "" };
    });
    return ok(res, { data });
  } catch (e) {
    return err(res, e.message, 500);
  }
});

// DELETE /logs  { user }  — hapus semua log
app.delete("/logs", async (req, res) => {
  const { user } = req.body;
  try {
    const snap = await db.collection(COL.LOGS).get();
    const batchSize = 400;
    const docs = snap.docs;
    for (let i = 0; i < docs.length; i += batchSize) {
      const batch = db.batch();
      docs.slice(i, i + batchSize).forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
    await writeLog(user, "Hapus Log", "Membersihkan seluruh riwayat sistem.");
    return ok(res, {}, "Riwayat sistem berhasil dibersihkan!");
  } catch (e) {
    return err(res, e.message, 500);
  }
});

// ════════════════════════════════════════════════════════════
// REKAP PENJUALAN
// GET /rekap?bulan=7&tahun=2025
// ════════════════════════════════════════════════════════════
app.get("/rekap", async (req, res) => {
  const bulan = parseInt(req.query.bulan);
  const tahun = parseInt(req.query.tahun);
  if (!bulan || !tahun) return err(res, "Parameter bulan dan tahun wajib diisi.");

  try {
    const startDate = new Date(tahun, bulan - 1, 1);
    const endDate   = new Date(tahun, bulan,     1);
    const startStr  = startDate.toISOString().split("T")[0]; // "2025-07-01"
    const endStr    = endDate.toISOString().split("T")[0];   // "2025-08-01"

    const snap = await db.collection(COL.BARANG_KELUAR)
      .where("tanggal", ">=", startStr)
      .where("tanggal", "<",  endStr)
      .get();

    const rSales = {}, rMutasi = {};

    snap.forEach((doc) => {
      const d   = doc.data();
      const brg = d.namaBarang || "-";
      const qty = Number(d.jumlah)     || 0;
      const tot = Number(d.totalNilai) || 0;
      const tjn = d.tujuan            || "-";

      if (!rSales[brg]) rSales[brg] = { qty: 0, omset: 0 };
      rSales[brg].qty   += qty;
      rSales[brg].omset += tot;

      if (!rMutasi[tjn]) rMutasi[tjn] = { totalQty: 0, rincian: {} };
      rMutasi[tjn].totalQty          += qty;
      rMutasi[tjn].rincian[brg]       = (rMutasi[tjn].rincian[brg] || 0) + qty;
    });

    const sales = Object.keys(rSales)
      .map((k) => ({ nama: k, data: rSales[k] }))
      .sort((a, b) => b.data.omset - a.data.omset)
      .slice(0, 10);

    const mutasi = Object.keys(rMutasi)
      .map((k) => ({
        outlet:      k,
        totalQty:    rMutasi[k].totalQty,
        rincianText: Object.keys(rMutasi[k].rincian)
          .map((x) => `${x}(${rMutasi[k].rincian[x]})`)
          .join(", "),
      }))
      .sort((a, b) => b.totalQty - a.totalQty)
      .slice(0, 10);

    return ok(res, { sales, mutasi });
  } catch (e) {
    functions.logger.error("rekap:", e);
    return err(res, e.message, 500);
  }
});

// ════════════════════════════════════════════════════════════
// PUBLIC STOCK — akses publik tanpa auth (untuk cek stok luar)
// GET /public/stock
// ════════════════════════════════════════════════════════════
app.get("/public/stock", async (req, res) => {
  try {
    const snap = await db.collection(COL.INVENTORY).orderBy("namaBarang").get();
    const data = snap.docs.map((doc) => {
      const d = doc.data();
      return {
        name:       d.namaBarang  || "",
        brand:      d.brand       || "",
        gramasi:    d.gramasi     || "",
        varian:     d.varian      || "",
        stock:      Number(d.stok) || 0,
        useKarton:  d.pakaiKarton !== false,
        settingPcs: Number(d.settingPcs) || 1,
      };
    });
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

// ─── 404 handler ───
app.use((req, res) => res.status(404).json({ success: false, message: `Route tidak ditemukan: ${req.method} ${req.path}` }));

// ─── Error handler global ───
app.use((error, req, res, _next) => {
  functions.logger.error("Unhandled error:", error);
  res.status(500).json({ success: false, message: "Internal Server Error: " + error.message });
});

// ════════════════════════════════════════════════════════════
// EXPORT FIREBASE CLOUD FUNCTION
// Satu fungsi "api" yang membungkus seluruh Express router.
// URL: https://<region>-<project>.cloudfunctions.net/api
// ════════════════════════════════════════════════════════════
exports.api = functions
  .region("asia-southeast1") // Singapore — paling dekat Indonesia
  .runWith({
    timeoutSeconds: 60,
    memory: "256MB",
  })
  .https.onRequest(app);

// ════════════════════════════════════════════════════════════
// SCHEDULED FUNCTION — Otomatis bersihkan OTP kadaluarsa setiap jam
// ════════════════════════════════════════════════════════════
exports.cleanExpiredOTP = functions
  .region("asia-southeast1")
  .pubsub.schedule("every 60 minutes")
  .onRun(async () => {
    const now  = admin.firestore.Timestamp.now();
    const snap = await db.collection(COL.OTP_CODES)
      .where("expiry", "<", now)
      .get();

    if (snap.empty) return null;

    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    functions.logger.info(`Cleaned ${snap.size} expired OTP records.`);
    return null;
  });
