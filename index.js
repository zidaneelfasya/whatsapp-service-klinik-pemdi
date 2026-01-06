require("dotenv").config();
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const express = require("express");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const axios = require("axios");

const app = express();
app.use(express.json());

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const MODEL_NAME = "gemini-1.5-flash";

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
const userSessions = new Map();

// Chat status constants
const CHAT_STATUS = {
	INACTIVE: "inactive",
	WAITING_COMMAND: "waiting_command",
	ACTIVE: "active",
	WAITING_FEEDBACK: "waiting_feedback",
};

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

// Fungsi untuk mendapatkan konteks dari RAG service
async function getContextFromRAG(message) {
	try {
		const response = await axios.post(
			`${process.env.RAG_SERVICE_URL}/admin/context/searchtest/`,
			{
				message: message,
			}
		);
		return response.data.results;
	} catch (error) {
		console.error("❌ Error mengakses RAG service:", error.message);
		return [];
	}
}

// Fungsi untuk generate response menggunakan Gemini
async function generateResponse(message, contextualChunks) {
	try {
		const combinedContext = contextualChunks.join("\n\n---\n\n");

		const prompt = `Kamu adalah asisten cerdas yang menjawab pertanyaan hanya berdasarkan informasi yang diberikan dari dokumen internal. berikan jawaban profesional yang panjang. Jika jawabannya tidak ditemukan di dokumen, katakan dengan jujur bahwa kamu tidak tahu atau informasinya tidak tersedia.

=== Informasi Konteks ===
${combinedContext}
=======================

Pertanyaan:
${message}

Berdasarkan informasi konteks di atas, jawablah pertanyaan dengan jelas dan detail:`;

		const model = genAI.getGenerativeModel({ model: MODEL_NAME });
		const result = await model.generateContent([prompt]);
		const response = await result.response;

		return response.text();
	} catch (error) {
		console.error("❌ Error generating response:", error.message);
		throw error;
	}
}

// Handler pesan WhatsApp
client.on("message", async (msg) => {
	const incomingText = msg.body.trim();
	const sender = msg.from;

	console.log(`📩 Pesan masuk dari ${sender}: ${incomingText}`);

	// 🔐 AUTHORIZATION CHECK - Cek apakah user diotorisasi
	if (!isAuthorizedUser(sender)) {
		console.log(
			`🚫 Akses ditolak untuk ${sender} - Tidak dalam daftar authorized users`
		);
		// Tidak mengirim balasan apapun, hanya log dan return
		return;
	}

	// Get atau create user session
	if (!userSessions.has(sender)) {
		userSessions.set(sender, { status: CHAT_STATUS.INACTIVE });
	}

	const userSession = userSessions.get(sender);

	try {
		// 🚀 TRIGGER CHECK - Cek apakah pesan adalah trigger untuk memulai chatbot
		if (userSession.status === CHAT_STATUS.INACTIVE) {
			// Hanya aktifkan chatbot jika pesan adalah "/klinik_pemdi"
			if (incomingText.toLowerCase() === "/klinik_pemdi") {
				userSession.status = CHAT_STATUS.WAITING_COMMAND;
				userSessions.set(sender, userSession);

				// Kirim pesan selamat datang dengan pilihan
				const menuMessage = `Selamat datang di layanan chatbot Klinik PEMDI! 👋

Silakan pilih salah satu opsi berikut dengan mengetik angka atau teks:

1️⃣ *Bertanya tentang Klinik PEMDI* (ketik: 1 atau tanya)
2️⃣ *Tidak Memerlukan Layanan* (ketik: 2 atau tidak)

Contoh: ketik "1" untuk mulai bertanya`;

				await client.sendMessage(sender, menuMessage);
				console.log(
					`🔔 Chatbot diaktifkan untuk ${sender} dengan trigger /klinik_pemdi`
				);
				return;
			} else {
				// Jika bukan trigger command, abaikan pesan
				console.log(
					`⚪ Pesan diabaikan dari ${sender} - Bukan trigger command /klinik_pemdi`
				);
				return;
			}
		}

		// 1. Handle command untuk mengaktifkan chatbot (setelah trigger)
		if (userSession.status === CHAT_STATUS.WAITING_COMMAND) {
			const lowerText = incomingText.toLowerCase();

			// Handle pilihan 1: Bertanya tentang Klinik PEMDI
			if (
				lowerText === "1" ||
				lowerText === "tanya" ||
				lowerText.includes("tanya")
			) {
				userSession.status = CHAT_STATUS.ACTIVE;
				userSessions.set(sender, userSession);

				await msg.reply(
					"Silakan bertanya tentang kebutuhan Anda terkait Klinik PEMDI. Saya siap membantu! 😊"
				);
				console.log(`✅ Chatbot diaktifkan untuk ${sender} - mode tanya`);
				return;
			}
			// Handle pilihan 2: Tidak Memerlukan Layanan
			else if (
				lowerText === "2" ||
				lowerText === "tidak" ||
				lowerText.includes("tidak")
			) {
				// Jika user memilih tidak memerlukan layanan
				await msg.reply("Terima kasih telah menggunakan layanan kami! 🙏");

				userSession.status = CHAT_STATUS.INACTIVE;
				userSessions.set(sender, userSession);

				console.log(
					`👋 Session berakhir untuk ${sender} - User tidak menggunakan layanan`
				);
				return;
			} else {
				// Jika user mengetik selain pilihan yang valid, kirim ulang menu
				const menuMessage = `Mohon pilih salah satu opsi yang tersedia:

1️⃣ *Bertanya tentang Klinik PEMDI* (ketik: 1 atau tanya)
2️⃣ *Tidak Memerlukan Layanan* (ketik: 2 atau tidak)

Contoh: ketik "1" untuk mulai bertanya`;

				await client.sendMessage(sender, menuMessage);
				console.log(`🔄 Menu pilihan dikirim ulang ke ${sender}`);
				return;
			}
		}

		// 2. Handle feedback response
		if (userSession.status === CHAT_STATUS.WAITING_FEEDBACK) {
			const lowerText = incomingText.toLowerCase();

			// Cek respons negatif TERLEBIH DAHULU
			if (
				lowerText.includes("tidak puas") ||
				lowerText.includes("tidak") ||
				lowerText.includes("kurang") ||
				lowerText === "2" ||
				lowerText === "no" ||
				lowerText === "n"
			) {
				await msg.reply(
					"Mohon maaf atas ketidakpuasan Anda. Silakan isi feedback di Google Form: https://aws.amazon.com/id/what-is/retrieval-augmented-generation"
				);

				// Reset session - chatbot berakhir
				userSession.status = CHAT_STATUS.INACTIVE;
				userSessions.set(sender, userSession);

				console.log(`✅ Session berakhir untuk ${sender} - User tidak puas`);
				return;
			}
			// Baru cek respons positif
			else if (
				lowerText.includes("ya, puas") ||
				lowerText === "ya" ||
				lowerText === "puas" ||
				lowerText === "1" ||
				lowerText === "yes" ||
				lowerText === "y"
			) {
				await msg.reply(
					"Terima kasih telah menggunakan layanan chatbot klinik pemdi"
				);

				// Reset session - chatbot berakhir
				userSession.status = CHAT_STATUS.INACTIVE;
				userSessions.set(sender, userSession);

				console.log(`✅ Session berakhir untuk ${sender} - User puas`);
				return;
			} else {
				// Jika user mengirim pesan lain saat waiting feedback, ingatkan
				const feedbackMessage = `Silakan pilih salah satu opsi feedback yang tersedia:

1️⃣ *Ya, puas* (ketik: ya atau 1)
2️⃣ *Tidak puas* (ketik: tidak atau 2)

Silakan berikan feedback Anda`;

				await client.sendMessage(sender, feedbackMessage);
				return;
			}
		}

		// 3. Handle pertanyaan chatbot (hanya jika status ACTIVE)
		if (userSession.status === CHAT_STATUS.ACTIVE) {
			try {
				// Dapatkan konteks dari RAG
				const contextualChunks = await getContextFromRAG(incomingText);

				// Generate response menggunakan Gemini
				const reply = await generateResponse(incomingText, contextualChunks);

				// Kirim balasan utama
				await msg.reply(reply);

				// Kirim feedback menggunakan pesan teks
				const feedbackMessage = `Apakah anda puas dengan jawabannya?

1️⃣ *Ya, puas* (ketik: ya atau 1)
2️⃣ *Tidak puas* (ketik: tidak atau 2)

Silakan pilih salah satu opsi di atas`;

				await client.sendMessage(sender, feedbackMessage);

				// Update status ke waiting feedback
				userSession.status = CHAT_STATUS.WAITING_FEEDBACK;
				userSessions.set(sender, userSession);

				console.log(`✅ Balasan terkirim ke ${sender}, menunggu feedback`);
				return;
			} catch (error) {
				console.error(
					`❌ Error saat memproses pertanyaan dari ${sender}:`,
					error.message
				);
				await msg.reply(
					"Maaf, terjadi kesalahan saat memproses pertanyaan Anda. Silakan coba lagi."
				);

				userSession.status = CHAT_STATUS.INACTIVE;
				userSessions.set(sender, userSession);
				return;
			}
		}

		// 4. Jika chatbot tidak aktif dan bukan pemicu, abaikan pesan
		if (userSession.status === CHAT_STATUS.INACTIVE) {
			console.log(`⚪ Pesan diabaikan dari ${sender} - Chatbot tidak aktif`);
			return;
		}
	} catch (err) {
		console.error(`❌ Gagal memproses pesan dari ${sender}`, err.message);

		// Reset session jika terjadi error
		userSession.status = CHAT_STATUS.INACTIVE;
		userSessions.set(sender, userSession);

		await msg.reply(
			"Maaf, terjadi kesalahan. Silakan coba lagi dengan mengirim pesan apa saja untuk memulai ulang."
		);
	}
});

// REST API Endpoints untuk testing dan debugging

// Endpoint untuk testing chat API (seperti coba_chatbot)
app.post("/api/chat", async (req, res) => {
	const { message } = req.body;
	if (!message) {
		return res.status(400).json({ error: "Message is required" });
	}

	try {
		// Dapatkan konteks dari RAG
		const contextualChunks = await getContextFromRAG(message);

		// Generate response menggunakan Gemini
		const reply = await generateResponse(message, contextualChunks);

		res.json({ reply: reply });
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
	console.log(`🔧 Untuk mengaktifkan chatbot, kirim pesan: /klinik_pemdi`);
});
