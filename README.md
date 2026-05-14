# DESTTEK — Knowledge Base Platform

Güvenli, Dockerize edilmiş, Node.js + SQLite tabanlı bilgi tabanı.

---

## Klasör Yapısı

```
desttek/
├── backend/          # Node.js + Express + SQLite
│   ├── src/
│   │   ├── index.js          # Uygulama giriş noktası
│   │   ├── db.js             # Veritabanı katmanı
│   │   ├── routes/
│   │   │   ├── api.js        # Public API (read-only)
│   │   │   └── admin.js      # Admin API (CRUD + backup)
│   │   ├── middleware/
│   │   │   ├── auth.js       # JWT doğrulama
│   │   │   ├── audit.js      # İşlem loglama
│   │   │   └── validate.js   # Girdi doğrulama
│   │   └── utils/logger.js   # Winston logger
│   ├── .env.example          # Ortam değişkenleri şablonu
│   └── Dockerfile
├── frontend/index.html       # Public site (arama + okuma)
├── admin/index.html          # Admin panel (CRUD)
├── docker-compose.yml
└── README.md
```

---

## Yerel Geliştirme (Docker ile)

### 1. Projeyi klonla / indir

```bash
cd desttek/backend
cp .env.example .env
```

### 2. .env dosyasını düzenle

```bash
# Güvenli JWT secret üret:
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# .env dosyasını aç ve şunları değiştir:
JWT_SECRET=<üretilen_secret>
ADMIN_USERNAME=senin_kullanici_adin
ADMIN_PASSWORD=GuvenliSifre123!
ALLOWED_ORIGINS=http://localhost:3000
```

### 3. Docker ile başlat

```bash
# Projenin kök dizininde:
docker-compose up -d

# Logları izle:
docker-compose logs -f
```

### 4. Erişim

| Adres | Açıklama |
|-------|----------|
| `http://localhost:3000` | Public site |
| `http://localhost:3000/panel` | Admin panel |
| `http://localhost:3000/health` | Health check |

---

## Render.com'a Deploy

### 1. GitHub'a push et

```bash
git init
git add .
git commit -m "initial commit"
git remote add origin https://github.com/KULLANICI/desttek.git
git push -u origin main
```

### 2. Render'da yeni Web Service oluştur

- **Dashboard** → New → **Web Service**
- Repo'yu bağla
- Şu ayarları gir:

| Alan | Değer |
|------|-------|
| Root Directory | `backend` |
| Environment | `Docker` |
| Instance Type | Free |
| Health Check Path | `/health` |

### 3. Environment Variables ekle (Render dashboard'da)

```
NODE_ENV=production
JWT_SECRET=<64 karakterlik random string>
ADMIN_USERNAME=<kullanici_adin>
ADMIN_PASSWORD=<güçlü_şifre>
ALLOWED_ORIGINS=https://your-app.onrender.com
DB_PATH=./data/desttek.db
APP_NAME=DESTTEK
```

### 4. Disk (Persistent Storage) ekle

- **Add Disk** → Mount Path: `/app/data` → Size: 1GB (free tier'da yeterli)

> ⚠️ Disk olmadan SQLite verileri deploy'da sıfırlanır!

---

## Yedekleme

### Admin panel'den (en kolay)
- Admin panel → **DB Backup** butonu → `.db` dosyasını indir

### cURL ile

```bash
# Token al
TOKEN=$(curl -s -X POST https://your-app.onrender.com/admin/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"sifre"}' | jq -r '.token')

# DB yedekle
curl -H "Authorization: Bearer $TOKEN" \
  https://your-app.onrender.com/admin/backup \
  -o "backup-$(date +%Y%m%d).db"

# JSON export al
curl -H "Authorization: Bearer $TOKEN" \
  https://your-app.onrender.com/admin/export \
  -o "export-$(date +%Y%m%d).json"
```

### Yedekten geri yükleme
1. Admin panel → **Import** → export `.json` dosyasını seç

---

## Güvenlik Özellikleri

| Katman | Özellik |
|--------|---------|
| **Transport** | HTTPS (Render otomatik sağlar) |
| **Auth** | JWT HS256, 8 saat TTL |
| **Brute force** | Login endpoint'te 10 deneme/15dk rate limit |
| **SQL Injection** | Tüm sorgular prepared statement |
| **XSS** | Helmet CSP, tüm output escaped |
| **CORS** | Sadece izin verilen origin'ler |
| **Girdi doğrulama** | express-validator, tüm endpoint'lerde |
| **Audit log** | Her admin işlemi loglanır |
| **Şifre** | bcrypt cost=12 |
| **Container** | Non-root user (desttek:1001) |
| **Headers** | Helmet.js — XSS, clickjacking, MIME sniffing koruması |
| **Timing attack** | Login'de her zaman bcrypt çalışır |
| **User enumeration** | Yanlış kullanıcı/şifrede aynı hata mesajı |

---

## API Endpoints

### Public (rate limit: 200/15dk)
```
GET  /api/categories
GET  /api/categories/:id/records
GET  /api/records/:id
GET  /api/search?q=...
GET  /health
```

### Admin (JWT gerekli, rate limit: 50/15dk)
```
POST   /admin/auth/login
POST   /admin/auth/verify

GET    /admin/categories
POST   /admin/categories
PUT    /admin/categories/:id
DELETE /admin/categories/:id

GET    /admin/categories/:id/records
POST   /admin/categories/:id/records
GET    /admin/records/:id
PUT    /admin/records/:id
PUT    /admin/records/:id/full     ← Tüm alanları kaydet
DELETE /admin/records/:id

POST   /admin/records/:id/fields
PUT    /admin/fields/:id
DELETE /admin/fields/:id

GET    /admin/export               ← JSON export
GET    /admin/backup               ← SQLite dosyası
POST   /admin/import               ← JSON import
GET    /admin/audit                ← İşlem geçmişi
```

---

## Uygulama Adını Değiştirme

`.env` dosyasında:
```
APP_NAME=YENİİSİM
```

Restart yeterli. Frontend otomatik okur.

---

## Claude Code ile Geliştirme

```bash
npm install -g @anthropic/claude-code
cd desttek
claude
```

Örnek komutlar:
- `"Backend testleri ekle"`
- `"Admin panele audit log sayfası ekle"`  
- `"XLSX export özelliği ekle"`
