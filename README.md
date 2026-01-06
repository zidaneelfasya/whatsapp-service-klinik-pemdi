# WhatsApp Chatbot Unified - Klinik PEMDI

Aplikasi WhatsApp chatbot terintegrasi yang menggabungkan layanan WhatsApp dan LLM (Large Language Model) menggunakan Google Gemini untuk menjawab pertanyaan terkait Klinik PEMDI.

## Fitur

- 🤖 **Chatbot Cerdas**: Menggunakan Google Gemini AI untuk generate jawaban
- 📱 **WhatsApp Integration**: Terintegrasi langsung dengan WhatsApp Web
- 🔍 **RAG (Retrieval-Augmented Generation)**: Mengambil konteks relevan dari dokumen internal
- 💬 **Session Management**: Mengelola sesi percakapan per user
- 📊 **Feedback System**: Sistem feedback kepuasan user
- 🔧 **REST API**: Endpoint untuk testing dan debugging
- 🔐 **Authorization**: Hanya user yang diotorisasi yang dapat menggunakan bot

## Prasyarat

1. Node.js (versi 14 atau lebih baru)
2. WhatsApp account untuk scanning QR code
3. Google Gemini API key
4. RAG service berjalan di port 8000 (untuk konteks dokumen)

## Instalasi

1. **Clone dan setup aplikasi:**
   ```bash
   cd whatsapp-chatbot-unified
   npm install
   ```

2. **Konfigurasi environment variables:**
   Edit file `.env` dan sesuaikan:
   ```
   GEMINI_API_KEY=your_gemini_api_key_here
   PORT=3000
   RAG_SERVICE_URL=http://localhost:8000
   AUTHORIZED_NUMBERS=6282123129426
   ```
   
   **Catatan Authorization:**
   - Untuk multiple numbers, pisahkan dengan koma: `6282123129426,6281234567890`
   - Nomor harus dalam format internasional tanpa tanda + (contoh: 6282123129426)
   - Saat testing, hanya nomor yang terdaftar yang bisa menggunakan bot

3. **Jalankan aplikasi:**
   ```bash
   # Development mode
   npm run dev
   
   # Production mode
   npm start
   ```

4. **Scan QR code di terminal untuk menghubungkan WhatsApp**

## Cara Penggunaan

### WhatsApp Bot Flow:

1. **User mengirim pesan pertama** → Bot menampilkan menu pilihan
2. **User memilih opsi:**
   - `1` atau `jawab` → Menjawab pertanyaan yang tadi dikirim
   - `2` atau `tanya` → Mode bertanya hal baru
   - `3` atau `tidak` → Tidak menggunakan layanan
3. **Bot memproses** → Mengambil konteks dari RAG + generate jawaban dengan Gemini
4. **User memberikan feedback** → Bot mengakhiri sesi atau meminta feedback

### REST API Endpoints:

- `POST /api/chat` - Testing chat functionality
- `POST /api/chat/context` - Mendapatkan konteks dari RAG
- `POST /send-message` - Kirim pesan manual
- `GET /sessions` - Lihat semua sesi aktif
- `POST /reset-session` - Reset sesi tertentu
- `GET /health` - Health check
- `GET /authorized-users` - Lihat daftar nomor yang diotorisasi
- `POST /add-authorized-user` - Tambah nomor ke authorized list (untuk testing)

### Contoh API Usage:

```bash
# Test chat
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Apa itu Klinik PEMDI?"}'

# Health check
curl http://localhost:3000/health

# Lihat authorized users
curl http://localhost:3000/authorized-users

# Tambah authorized user (untuk testing)
curl -X POST http://localhost:3000/add-authorized-user \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber": "6281234567890"}'
```

## Struktur Aplikasi

```
whatsapp-chatbot-unified/
├── index.js          # Main application file
├── package.json      # Dependencies and scripts
├── .env             # Environment variables
└── README.md        # Documentation
```

## Dependencies

- **whatsapp-web.js**: WhatsApp Web client
- **@google/generative-ai**: Google Gemini AI SDK
- **express**: Web framework untuk REST API
- **axios**: HTTP client untuk RAG service
- **qrcode-terminal**: QR code display di terminal
- **dotenv**: Environment variables management

## Troubleshooting

1. **QR Code tidak muncul**: Pastikan terminal mendukung display QR code
2. **Error koneksi RAG**: Pastikan RAG service berjalan di port 8000
3. **Error Gemini API**: Periksa API key di file .env
4. **WhatsApp disconnect**: Scan ulang QR code jika diperlukan
5. **Bot tidak merespons**: Pastikan nomor WhatsApp ada di AUTHORIZED_NUMBERS
6. **Authorization error**: Cek format nomor di .env (tanpa tanda + dan spasi)

## Status Chat

- `INACTIVE`: User belum memulai chat
- `WAITING_COMMAND`: Menunggu user memilih menu
- `ACTIVE`: User sedang bertanya
- `WAITING_FEEDBACK`: Menunggu feedback dari user

## Catatan

- Aplikasi ini menggabungkan fungsionalitas dari `coba_chatbot` dan `whapify`
- RAG service harus berjalan terpisah di port 8000
- Session disimpan di memory (akan hilang saat restart)
- Untuk production, pertimbangkan menggunakan database untuk session storage
