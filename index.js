require("dotenv").config();
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

// ========================================
// CONFIGURATION - THIN CLIENT ORCHESTRATOR
// ========================================
const BACKEND_URL = process.env.BACKEND_URL || "https://0f0b-34-16-150-20.ngrok-free.app";
const RAG_SERVICE_URL = process.env.RAG_SERVICE_URL;

// Authorized phone numbers
const AUTHORIZED_NUMBERS = process.env.AUTHORIZED_NUMBERS
	? process.env.AUTHORIZED_NUMBERS.split(",").map((num) => num.trim())
	: [];

console.log("🔐 Authorized numbers:", AUTHORIZED_NUMBERS);
if (AUTHORIZED_NUMBERS.length === 0) {
	console.log(
		"🔓 Authorization DISABLED - Bot akan menerima pesan dari SEMUA nomor"
	);
} else {
	console.log(
		`🔒 Authorization ENABLED - Bot hanya menerima pesan dari ${AUTHORIZED_NUMBERS.length} nomor yang diizinkan`
	);
}

// WhatsApp Status tracking
let whatsappStatus = {
	status: 'DISCONNECTED', // DISCONNECTED, CONNECTING, QR_READY, AUTHENTICATING, CONNECTED, ERROR
	qrCode: null,
	info: null,
	loadingPercent: 0,
	loadingMessage: '',
	error: null
};

let isInitializing = false;

// Initialize WhatsApp Client dengan LocalAuth untuk menyimpan session
const client = new Client({
	authStrategy: new LocalAuth({
		clientId: "whatsapp-chatbot-unified",
	}),
	puppeteer: {
		headless: true,
		args: [
			"--no-sandbox",
			"--disable-setuid-sandbox",
			"--disable-dev-shm-usage",
			"--disable-accelerated-2d-canvas",
			"--no-first-run",
			"--no-zygote",
			"--single-process",
			"--disable-gpu",
		],
	},
});

// QR Code untuk WhatsApp
client.on("qr", (qr) => {
	console.log("📱 QR Code generated for WhatsApp connection");
	console.log("⏰ QR Code akan expire dalam 20 detik...");
	
	// Generate QR code as data URL for frontend
	const QRCode = require('qrcode');
	QRCode.toDataURL(qr, { width: 256 }, (err, url) => {
		if (err) {
			console.error('Error generating QR code:', err);
			whatsappStatus.qrCode = null;
		} else {
			whatsappStatus.qrCode = url;
		}
	});
	
	whatsappStatus.status = 'QR_READY';
	whatsappStatus.error = null;
	
	// Auto-expire QR code after 20 seconds
	setTimeout(() => {
		if (whatsappStatus.status === 'QR_READY') {
			console.log("⏰ QR Code expired, generating new one...");
			whatsappStatus.qrCode = null;
		}
	}, 20000);
	
	// Display QR in terminal too
	qrcode.generate(qr, { small: true });
});

// Event ketika client sedang loading
client.on("loading_screen", (percent, message) => {
	console.log(`🔄 Loading: ${percent}% - ${message}`);
	whatsappStatus.loadingPercent = percent;
	whatsappStatus.loadingMessage = message;
	whatsappStatus.status = 'CONNECTING';
});

// Event ketika authenticating
client.on("authenticated", (session) => {
	console.log("✅ WhatsApp berhasil terotentikasi!");
	console.log("💾 Session tersimpan untuk penggunaan selanjutnya");
	whatsappStatus.status = 'AUTHENTICATING';
	whatsappStatus.error = null;
});

// Event ketika authentication gagal
client.on("auth_failure", (msg) => {
	console.error("❌ Authentication gagal:", msg);
	console.log("🔄 Silakan restart aplikasi dan scan QR code ulang");
	whatsappStatus.status = 'ERROR';
	whatsappStatus.error = 'Authentication failed: ' + msg;
	whatsappStatus.qrCode = null;
});

// Event ketika client ready
client.on("ready", () => {
	console.log("✅ WhatsApp Client siap digunakan!");
	console.log("📱 Bot telah terhubung dan siap menerima pesan");

	// Update status to connected
	whatsappStatus.status = 'CONNECTED';
	whatsappStatus.qrCode = null;
	whatsappStatus.error = null;
	whatsappStatus.loadingPercent = 100;
	whatsappStatus.loadingMessage = 'Connected successfully';
	
	// Get client info
	client.info.then((info) => {
		whatsappStatus.info = info;
		console.log("📊 Client info:", info);
	});

	// Log info client
	client.getState().then((state) => {
		console.log("📊 Status koneksi:", state);
	});

	// Test dengan mengirim pesan ke diri sendiri (opsional)
	if (process.env.TEST_NUMBER) {
		client
			.sendMessage(
				`${process.env.TEST_NUMBER}@c.us`,
				"🤖 Bot telah aktif dan siap melayani!"
			)
			.then(() => console.log("✅ Test message sent"))
			.catch((err) => console.log("⚠️ Test message failed:", err.message));
	}
});

// Event ketika client disconnect
client.on("disconnected", (reason) => {
	console.log("❌ WhatsApp Client terputus:", reason);
	console.log("🔄 Mencoba reconnect...");
	whatsappStatus.status = 'DISCONNECTED';
	whatsappStatus.qrCode = null;
	whatsappStatus.info = null;
	whatsappStatus.error = 'Disconnected: ' + reason;
});

// Event untuk error handling
client.on("error", (error) => {
	console.error("❌ WhatsApp Client error:", error);
	whatsappStatus.status = 'ERROR';
	whatsappStatus.error = error.message || 'Unknown error occurred';
});

// Timeout untuk initialization
// Optional: Auto-initialize if environment variable is set
if (process.env.AUTO_INIT_WHATSAPP === 'true') {
	console.log("🚀 Auto-initializing WhatsApp Client...");
	isInitializing = true;
	whatsappStatus.status = 'CONNECTING';
	client.initialize();
	
	// Reset initializing flag after timeout
	setTimeout(() => {
		isInitializing = false;
	}, 60000);
} else {
	console.log("⏸️ WhatsApp Client ready for manual initialization via /initialize endpoint");
	console.log("💡 Use POST /initialize to start WhatsApp connection");
}
// Simple conversation tracking (optional, untuk fitur lanjutan seperti context memory)
const userSessions = new Map();

// Fungsi untuk cek apakah nomor diotorisasi
function isAuthorizedUser(phoneNumber) {
	// Jika tidak ada authorized numbers (kosong), izinkan semua nomor
	if (AUTHORIZED_NUMBERS.length === 0) {
		console.log(
			`🔓 Authorization disabled (no authorized numbers set) - allowing all users`
		);
		return true;
	}

	// Ekstrak nomor dari format WhatsApp (contoh: 6282123129426@c.us)
	const cleanNumber = phoneNumber.replace("@c.us", "").replace("@g.us", "");

	// Cek apakah nomor ada di daftar authorized
	const isAuthorized = AUTHORIZED_NUMBERS.some((authNum) => {
		// Hapus karakter non-digit untuk perbandingan yang lebih fleksibel
		const cleanAuthNum = authNum.replace(/\D/g, "");
		const cleanIncomingNum = cleanNumber.replace(/\D/g, "");

		return (
			cleanIncomingNum.includes(cleanAuthNum) ||
			cleanAuthNum.includes(cleanIncomingNum)
		);
	});

	console.log(
		`🔍 Checking authorization for ${cleanNumber}: ${
			isAuthorized ? "✅ AUTHORIZED" : "❌ NOT AUTHORIZED"
		}`
	);
	return isAuthorized;
}

// ========================================
// BACKEND API CLIENT - THIN WRAPPER
// ========================================

async function getDecision(message) {
	try {
		console.log(`   → POST ${BACKEND_URL}/decision`);
		
		const response = await axios.post(`${BACKEND_URL}/decision`, {
			message: message
		}, {
			headers: { 'Content-Type': 'application/json' }
		});

		if (response.data && response.data.decision) {
			return response.data.decision;
		}

		throw new Error("Invalid response format from /decision");
	} catch (error) {
		console.error(`   ❌ /decision error:`, error.message);
		throw error;
	}
}

async function generateResponse(message, mode, context = null) {
	try {
		console.log(`   → POST ${BACKEND_URL}/generate (mode=${mode})`);
		
		const requestBody = {
			message: message,
			mode: mode
		};		
		if (mode === "RAG" && context) {
			requestBody.context = context;
		}

		const response = await axios.post(`${BACKEND_URL}/generate`, requestBody, {
			headers: { 'Content-Type': 'application/json' }
		});

		if (response.data && response.data.reply) {
			return response.data.reply;
		}

		throw new Error("Invalid response format from /generate");
	} catch (error) {
		console.error(`   ❌ /generate error:`, error.message);
		throw error;
	}
}

async function getContextFromRAG(message) {
    try {
        console.log(`   → Fetching context from RAG service...`);
        const response = await axios.post(
            `${RAG_SERVICE_URL}/admin/context/search/`,
            { query: message }
        );
        
        if (response.data && response.data.results) {
            console.log(`   → Found ${response.data.results.length} context chunks`);
            return response.data.results.map(item => item.content);
        }
        
        return [];
    } catch (error) {
        console.error(`   ❌ RAG service error:`, error.message);
        return [];
    }
}

// ========================================
// HANDLER PESAN WHATSAPP - INTERACTIVE & NATURAL
// ========================================
client.on("message", async (msg) => {
	const incomingText = msg.body.trim();
	const sender = msg.from;

	console.log(`📩 Pesan masuk dari ${sender}: ${incomingText}`);

	// 🔐 AUTHORIZATION CHECK
	if (!isAuthorizedUser(sender)) {
		console.log(
			`🚫 Akses ditolak untuk ${sender} - Tidak dalam daftar authorized users`
		);
		return;
	}

	// Abaikan pesan grup dan pesan dari bot sendiri
	if (msg.from.includes('@g.us')) {
		console.log(`⚪ Pesan grup diabaikan dari ${sender}`);
		return;
	}

	// Abaikan pesan yang terlalu panjang (kemungkinan spam)
	if (incomingText.length > 1000) {
		console.log(`⚠️ Pesan terlalu panjang dari ${sender}`);
		await msg.reply("Maaf, pesan Anda terlalu panjang. Bisa dipersingkat? 😊");
		return;
	}

	try {
		// ========================================
		// STEP 1: DECISION ROUTING (Backend)
		// ========================================
		console.log(`🧠 Step 1: Mengklasifikasi intent untuk ${sender}`);
		const decision = await getDecision(incomingText);
		console.log(`📍 Decision Result: ${decision}`);

		let context = null;
		
		// ========================================
		// STEP 2: RAG CONTEXT RETRIEVAL (if needed)
		// ========================================
		if (decision === "RAG") {
			console.log(`🔍 Step 2: Mengambil Konteks RAG`);
			context = await getContextFromRAG(incomingText);
			if (!context || context.length === 0) {
				console.log(`   ⚠️  No context found, backend will handle gracefully`);
			}
		} else {
			console.log(`💬 Step 2: Skipped (${decision} mode doesn't need RAG)`);
		}
		
		// ========================================
		// STEP 3: RESPONSE GENERATION (Backend)
		// ========================================
		console.log(`✨ Step 3: Menghasilkan Response (mode=${decision})`);
		const reply = await generateResponse(incomingText, decision, context);

		// Kirim balasan
		await msg.reply(reply);
		console.log(`✅ Balasan terkirim ke ${sender}`);

		// Optional: Track conversation (untuk fitur lanjutan seperti context memory)
		if (!userSessions.has(sender)) {
			userSessions.set(sender, { messageCount: 0, lastMessageTime: Date.now() });
		}
		const session = userSessions.get(sender);
		session.messageCount++;
		session.lastMessageTime = Date.now();
		userSessions.set(sender, session);

	} catch (err) {
		console.error(`❌ Gagal memproses pesan dari ${sender}:`, err.message);
		
		// Kirim pesan error yang friendly
		await msg.reply(
			"Maaf, sepertinya ada gangguan sebentar. Bisa coba tanya lagi? 🙏"
		);
	}
});

// REST API Endpoints untuk testing dan debugging

// Endpoint untuk testing chat API
app.post("/api/chat", async (req, res) => {
	const { message } = req.body;
	if (!message) {
		return res.status(400).json({ error: "Message is required" });
	}

	try {
		// ========================================
		// STEP 1 & 2: DECISION & CONTEXT
		// ========================================
		const decision = await getDecision(message);
		let context = null;

		if (decision === "RAG") {
			console.log(`🔍 API Chat: Fetching RAG context`);
			context = await getContextFromRAG(message);
		} else {
			console.log(`💬 API Chat: Skipping RAG (${decision})`);
		}

		// ========================================
		// STEP 3: GENERATE RESPONSE
		// ========================================
		console.log(`✨ API Chat: Generating Response (mode=${decision})`);
		const reply = await generateResponse(message, decision, context);

		res.json({ 
			reply: reply,
			mode: decision
		});
	} catch (error) {
		console.error("❌ Error di API chat:", error.message);
		res.status(500).json({
			error: "Internal server error",
			details: error.message,
		});
	}
});

// Endpoint untuk mendapatkan konteks saja
app.post("/api/chat/context", async (req, res) => {
	const { message } = req.body;
	if (!message) {
		return res.status(400).json({ error: "message is required" });
	}

	try {
		const context = await getContextFromRAG(message);
		res.json({ context: context });
	} catch (error) {
		console.error("❌ Error mendapatkan konteks:", error.message);
		res.status(500).json({
			error: "Internal server error",
			details: error.message,
		});
	}
});

// Endpoint kirim pesan manual
app.post("/send-message", async (req, res) => {
	const { receiver, message } = req.body;

	// Cek apakah receiver diotorisasi (hanya jika ada authorized numbers)
	if (AUTHORIZED_NUMBERS.length > 0 && !isAuthorizedUser(receiver)) {
		return res.status(403).json({
			success: false,
			error: "Receiver is not authorized",
		});
	}

	try {
		await client.sendMessage(`${receiver}@c.us`, message);
		res.send({ success: true });
	} catch (err) {
		console.error("❌ Error mengirim pesan:", err.message);
		res.status(500).send({ success: false, error: err.message });
	}
});

// Endpoint untuk mengirim pesan ticket
app.post("/api/send-ticket", async (req, res) => {
	const { 
		receiver, 
		ticket, 
		nama, 
		instansi, 
		kota, 
		provinsi, 
		topikKonsultasi, 
		fokusTujuan, 
		uraianKebutuhan, 
		konsultasiLanjut, 
		mekanisme 
	} = req.body;

	// Validasi input
	if (!receiver) {
		return res.status(400).json({
			success: false,
			error: "Receiver phone number is required",
		});
	}

	if (!ticket) {
		return res.status(400).json({
			success: false,
			error: "Ticket string is required",
		});
	}

	// Cek apakah receiver diotorisasi (hanya jika ada authorized numbers)
	// if (AUTHORIZED_NUMBERS.length > 0 && !isAuthorizedUser(receiver)) {
	//     return res.status(403).json({
	//         success: false,
	//         error: 'Receiver is not authorized'
	//     });
	// }

	try {
		// Format pesan ticket yang rapi dan informatif
		let ticketMessage = `🎫 *KONFIRMASI TIKET KONSULTASI*
━━━━━━━━━━━━━━━━━━━━━━━

✅ Konsultasi Anda telah berhasil terdaftar!

📋 *DETAIL TIKET:*
• Nomor Tiket: *${ticket}*`;

		// Tambahkan informasi penting dari form
		if (nama) {
			ticketMessage += `\n• Nama: ${nama}`;
		}
		
		if (instansi) {
			ticketMessage += `\n• Instansi: ${instansi}`;
		}

		if (kota && provinsi) {
			ticketMessage += `\n• Asal: ${kota}, ${provinsi}`;
		}

		// Format topik konsultasi jika ada
		if (topikKonsultasi && Array.isArray(topikKonsultasi) && topikKonsultasi.length > 0) {
			ticketMessage += `\n• Topik: ${topikKonsultasi.slice(0, 2).join(', ')}`;
			if (topikKonsultasi.length > 2) {
				ticketMessage += ` (+${topikKonsultasi.length - 2} lainnya)`;
			}
		}

		if (fokusTujuan) {
			ticketMessage += `\n• Fokus: ${fokusTujuan.length > 50 ? fokusTujuan.substring(0, 50) + '...' : fokusTujuan}`;
		}

		ticketMessage += `\n\n💬 *KEBUTUHAN KONSULTASI:*\n${uraianKebutuhan || 'Tidak ada detail tambahan'}`;

		// Tambahkan info konsultasi lanjut jika ada
		if (konsultasiLanjut === 'Ya' && mekanisme) {
			ticketMessage += `\n\n📞 *KONSULTASI LANJUT:*\nMekanisme: ${mekanisme}`;
		}

		ticketMessage += `\n\n━━━━━━━━━━━━━━━━━━━━━━━
💾 *Simpan tiket ini untuk referensi konsultasi Anda*
🕒 Tim kami akan segera memproses permintaan Anda
📞 Hubungi kami jika ada pertanyaan

Terima kasih! 🙏`;

		// Kirim pesan ke nomor yang dituju
		await client.sendMessage(`${receiver}@c.us`, ticketMessage);

		console.log(`📋 Ticket berhasil dikirim ke ${receiver}: ${ticket}`);

		res.json({
			success: true,
			message: "Ticket berhasil dikirim",
			receiver: receiver,
			ticket: ticket,
			timestamp: new Date().toISOString(),
		});
	} catch (err) {
		console.error("❌ Error mengirim ticket:", err.message);
		res.status(500).json({
			success: false,
			error: "Failed to send ticket",
			details: err.message,
		});
	}
});

// Endpoint untuk cek status session (debugging)
app.get("/sessions", (req, res) => {
	const sessions = {};
	userSessions.forEach((value, key) => {
		sessions[key] = value;
	});
	res.json(sessions);
});

// Endpoint untuk reset session tertentu (debugging)
app.post("/reset-session", (req, res) => {
	const { sender } = req.body;
	if (userSessions.has(sender)) {
		userSessions.set(sender, { status: CHAT_STATUS.INACTIVE });
		res.json({ success: true, message: `Session reset untuk ${sender}` });
	} else {
		res.json({ success: false, message: "Session tidak ditemukan" });
	}
});

// Endpoint untuk initialize WhatsApp connection
app.post("/initialize", (req, res) => {
	if (isInitializing) {
		return res.json({
			success: false,
			message: "WhatsApp sudah dalam proses initialization"
		});
	}

	if (whatsappStatus.status === 'CONNECTED') {
		return res.json({
			success: false,
			message: "WhatsApp sudah terhubung"
		});
	}

	try {
		console.log("🚀 Initializing WhatsApp Client from API...");
		isInitializing = true;
		whatsappStatus.status = 'CONNECTING';
		whatsappStatus.error = null;
		whatsappStatus.qrCode = null;
		
		client.initialize();
		
		// Reset initializing flag after timeout
		setTimeout(() => {
			isInitializing = false;
		}, 60000);

		res.json({
			success: true,
			message: "WhatsApp initialization started"
		});
	} catch (error) {
		console.error("❌ Error initializing WhatsApp:", error);
		isInitializing = false;
		whatsappStatus.status = 'ERROR';
		whatsappStatus.error = error.message;
		
		res.status(500).json({
			success: false,
			error: error.message
		});
	}
});

// Endpoint untuk disconnect WhatsApp
app.post("/disconnect", async (req, res) => {
	try {
		console.log("🔌 Disconnecting WhatsApp Client...");
		
		// Check if client is already disconnected or not ready
		if (whatsappStatus.status === 'DISCONNECTED') {
			return res.json({
				success: true,
				message: "WhatsApp already disconnected"
			});
		}

		// Update status first to prevent multiple disconnect attempts
		whatsappStatus.status = 'DISCONNECTED';
		whatsappStatus.qrCode = null;
		whatsappStatus.info = null;
		whatsappStatus.error = null;
		whatsappStatus.loadingPercent = 0;
		whatsappStatus.loadingMessage = '';

		// Try to destroy client safely
		if (client && client.pupBrowser) {
			try {
				await client.destroy();
			} catch (destroyError) {
				console.log("⚠️ Client destroy error (expected if already closed):", destroyError.message);
			}
		}
		
		res.json({
			success: true,
			message: "WhatsApp disconnected successfully"
		});
	} catch (error) {
		console.error("❌ Error disconnecting WhatsApp:", error);
		
		// Always update status even if disconnect fails
		whatsappStatus.status = 'DISCONNECTED';
		whatsappStatus.qrCode = null;
		whatsappStatus.info = null;
		whatsappStatus.error = error.message;
		
		res.json({
			success: true,
			message: "WhatsApp disconnected (with errors)",
			error: error.message
		});
	}
});

// Health check endpoint dengan status WhatsApp yang detail
app.get("/health", (req, res) => {
	let whatsappConnectionStatus = "disconnected";
	
	if (whatsappStatus.status === 'CONNECTED') {
		whatsappConnectionStatus = "connected";
	} else if (whatsappStatus.status === 'CONNECTING' || whatsappStatus.status === 'AUTHENTICATING') {
		whatsappConnectionStatus = "connecting";
	} else if (whatsappStatus.status === 'QR_READY') {
		whatsappConnectionStatus = "qr_ready";
	}

	res.json({
		status: "ok",
		whatsapp: whatsappConnectionStatus,
		whatsappStatus: whatsappStatus.status,
		qrCode: whatsappStatus.qrCode,
		info: whatsappStatus.info,
		loadingPercent: whatsappStatus.loadingPercent,
		loadingMessage: whatsappStatus.loadingMessage,
		error: whatsappStatus.error,
		authorizedUsers: AUTHORIZED_NUMBERS.length,
		timestamp: new Date().toISOString(),
	});
});

// Endpoint untuk melihat authorized numbers (untuk debugging)
app.get("/authorized-users", (req, res) => {
	res.json({
		authorizedNumbers: AUTHORIZED_NUMBERS,
		total: AUTHORIZED_NUMBERS.length,
	});
});

// Endpoint untuk menambah authorized user (untuk testing)
app.post("/add-authorized-user", (req, res) => {
	const { phoneNumber } = req.body;
	if (!phoneNumber) {
		return res.status(400).json({ error: "Phone number is required" });
	}

	const cleanNumber = phoneNumber.replace(/\D/g, "");
	if (!AUTHORIZED_NUMBERS.includes(cleanNumber)) {
		AUTHORIZED_NUMBERS.push(cleanNumber);
		res.json({
			success: true,
			message: `User ${cleanNumber} ditambahkan ke authorized list`,
			authorizedNumbers: AUTHORIZED_NUMBERS,
		});
	} else {
		res.json({
			success: false,
			message: `User ${cleanNumber} sudah ada di authorized list`,
		});
	}
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
	console.log(`🚀 Server berjalan di port ${PORT}`);
	console.log(`📊 Health check: http://localhost:${PORT}/health`);
	console.log(`💬 Chat API: http://localhost:${PORT}/api/chat`);
	console.log(`📋 Send Ticket API: http://localhost:${PORT}/api/send-ticket`);
	console.log(`📱 Menunggu koneksi WhatsApp...`);
	console.log(`🤖 Chatbot siap! User bisa langsung chat apa saja - chatbot akan menjawab secara natural`);
	console.log(`✨ Chatbot akan otomatis menentukan apakah perlu menggunakan RAG atau tidak`);
});
