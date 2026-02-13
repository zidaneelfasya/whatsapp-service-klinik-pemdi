require("dotenv").config();
const readline = require("readline");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const axios = require("axios");

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ========================================
// MODEL CONFIGURATION: Pisahkan model untuk efisiensi quota
// ========================================
const DECISION_MODEL = "gemini-2.5-flash-lite";  // Ringan & cepat untuk routing
const RESPONSE_MODEL = "gemini-2.5-flash";        // Kualitas tinggi untuk response

// Terminal colors untuk output yang lebih menarik
const colors = {
	reset: "\x1b[0m",
	bright: "\x1b[1m",
	dim: "\x1b[2m",
	
	// Foreground colors
	red: "\x1b[31m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	blue: "\x1b[34m",
	magenta: "\x1b[35m",
	cyan: "\x1b[36m",
	white: "\x1b[37m",
	
	// Background colors
	bgBlue: "\x1b[44m",
	bgGreen: "\x1b[42m",
};

console.log(`${colors.cyan}${colors.bright}
╔══════════════════════════════════════════════════════════╗
║                                                          ║
║          🤖 WHATSAPP CHATBOT - TESTING MODE 🤖          ║
║                   (Terminal Interface)                   ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
${colors.reset}`);

console.log(`${colors.yellow}📋 Mode Testing: Chatbot siap menerima input dari terminal${colors.reset}`);
console.log(`${colors.dim}💡 Ketik 'exit' atau 'quit' untuk keluar${colors.reset}\n`);

// ========================================
// QUOTA ERROR HANDLER
// ========================================
/**
 * Deteksi dan handle quota error dari Gemini API
 * Return user-friendly message untuk quota exceeded
 */
function isQuotaError(error) {
	return error && error.message && (
		error.message.includes('429') || 
		error.message.includes('Too Many Requests') ||
		error.message.includes('quota') ||
		error.message.includes('Quota exceeded')
	);
}

function getQuotaExceededMessage() {
	return "Maaf, sistem kami sedang mengalami keterbatasan kapasitas saat ini. 😔\n\n" +
	       "Hal ini terjadi karena volume penggunaan yang tinggi. Kami mohon maaf atas ketidaknyamanan ini.\n\n" +
	       "Silakan:\n" +
	       "• Coba lagi beberapa saat lagi (sekitar 1-2 menit)\n" +
	       "• Atau kunjungi form konsultasi langsung: http://klinikpemdig.layanan.go.id/konsultasi-form\n\n" +
	       "Tim kami akan segera membantu Anda! 🙏";
}

// ========================================
// DECISION ROUTER: LLM-based intent classification
// ========================================
// Decision types yang dihasilkan router
const DECISION_TYPES = {
	NO_RAG: 'NO_RAG',       // Sapaan, small talk, percakapan umum
	RAG: 'RAG',             // Pertanyaan membutuhkan knowledge base
	CLARIFY: 'CLARIFY'      // Pertanyaan ambigu butuh klarifikasi
};

/**
 * Decision Router menggunakan LLM untuk klasifikasi intent
 * HANYA mengembalikan decision type, TIDAK menjawab user
 * Menggunakan DECISION_MODEL yang lebih ringan untuk efisiensi quota
 */
async function decisionRouter(message) {
	try {
		// Prompt yang dioptimasi untuk decision making cepat dan akurat
		const decisionPrompt = `Kamu adalah intent classifier untuk chatbot Klinik PEMDI.

**DOMAIN CONTEXT:**
Klinik PEMDI = Program konsultasi SPBE (Sistem Pemerintahan Berbasis Elektronik) untuk instansi pemerintah.
BUKAN klinik kesehatan. BUKAN layanan medis.

**TUGAS:**
Klasifikasi intent user. Jawab HANYA: NO_RAG, RAG, atau CLARIFY.

**KATEGORI:**

1. NO_RAG (Percakapan sosial, tidak butuh knowledge base)
   • Sapaan: halo, hai, selamat pagi/siang/sore
   • Terima kasih: makasih, thanks, terima kasih
   • Small talk: apa kabar, gimana
   • Pertanyaan tentang bot: siapa kamu, bot apa ini
   • Konfirmasi: ok, oke, baik, siap, ya

2. RAG (Pertanyaan spesifik tentang SPBE/konsultasi pemerintah)
   • Layanan SPBE: sistem informasi, digitalisasi, e-government
   • Konsultasi pemerintah: asistensi teknis, pendampingan
   • Regulasi: peraturan, kebijakan, standar
   • Prosedur: cara daftar, syarat, alur konsultasi
   • Informasi teknis: jadwal, kontak, dokumen

3. CLARIFY (Pertanyaan terlalu vague, butuh klarifikasi)
   • Terlalu umum: "info dong", "bantu saya", "gimana"
   • Tidak jelas maksudnya: "itu bagaimana", "terus"
   • Ambigu tanpa konteks: "bisa bantu?", "ada?"

**CONTOH:**
User: "Halo" → NO_RAG
User: "Layanan konsultasi SPBE apa saja?" → RAG
User: "Bagaimana cara daftar konsultasi?" → RAG
User: "Info dong" → CLARIFY
User: "Terima kasih" → NO_RAG
User: "Bantu saya" → CLARIFY
User: "Apa itu SPBE?" → RAG
User: "Berapa biaya konsultasi?" → RAG

**INPUT:**
"${message}"

**OUTPUT (HANYA SATU KATA):**
NO_RAG, RAG, atau CLARIFY`;

		// Gunakan model ringan untuk decision routing
		const model = genAI.getGenerativeModel({ model: DECISION_MODEL });
		const result = await model.generateContent([decisionPrompt]);
		const response = await result.response;
		const decision = response.text().trim().toUpperCase();

		// Validasi output
		if (Object.values(DECISION_TYPES).includes(decision)) {
			return decision;
		}

		// Fallback jika output tidak sesuai
		console.log(`${colors.yellow}   ⚠️  Decision tidak valid: ${decision}, menggunakan RAG sebagai fallback${colors.reset}`);
		return DECISION_TYPES.RAG;

	} catch (error) {
		// Check jika quota error
		if (isQuotaError(error)) {
			console.error(`${colors.red}   ❌ Quota API habis di decision router${colors.reset}`);
			// Return fallback ke RAG (masih bisa pakai RAG dengan context)
			return DECISION_TYPES.RAG;
		}
		
		console.error(`${colors.red}   ❌ Error di decision router: ${error.message}${colors.reset}`);
		// Fallback ke RAG untuk keamanan
		return DECISION_TYPES.RAG;
	}
}

// ========================================
// RESPONSE WITHOUT RAG: Jawaban natural tanpa RAG
// ========================================
async function generateResponseWithoutRAG(message) {
	try {
		// Prompt yang dioptimasi untuk percakapan natural
		const conversationalPrompt = `Kamu adalah asisten digital Klinik PEMDI yang ramah dan profesional.

**IDENTITAS DOMAIN:**
Klinik PEMDI = Program konsultasi SPBE (Sistem Pemerintahan Berbasis Elektronik) untuk instansi pemerintah.
Kami membantu instansi pemerintah dalam transformasi digital dan implementasi SPBE.
BUKAN klinik kesehatan. BUKAN layanan medis.

**PESAN USER:**
"${message}"

**TUGAS:**
Jawab dengan natural seperti customer service profesional:

• Jika SAPAAN → Balas hangat + tawarkan bantuan seputar konsultasi SPBE
• Jika SMALL TALK → Jawab natural + arahkan ke layanan konsultasi pemerintah
• Jika TERIMA KASIH → Jawab ramah + siap membantu lagi
• Jika TANYA BOT → Jelaskan sebagai asisten konsultasi SPBE untuk instansi pemerintah

**ATURAN KETAT:**
✓ Maksimal 2-3 kalimat
✓ Gunakan 1 emoji yang sesuai
✓ Bahasa natural, tidak kaku
✓ Sebutkan identitas: "Klinik PEMDI", "konsultasi SPBE", "instansi pemerintah"
✗ JANGAN sebut: dokter, pasien, kesehatan, medis, rumah sakit
✗ JANGAN sebut: AI, bot, model, sistem
✗ JANGAN terlalu panjang

Jawab sekarang:`;

		// Gunakan model berkualitas tinggi untuk response
		const model = genAI.getGenerativeModel({ model: RESPONSE_MODEL });
		const result = await model.generateContent([conversationalPrompt]);
		const response = await result.response;

		return response.text();
	} catch (error) {
		// Check jika quota error
		if (isQuotaError(error)) {
			console.error(`${colors.red}❌ Quota API habis untuk response generation${colors.reset}`);
			return getQuotaExceededMessage();
		}
		
		console.error(`${colors.red}❌ Error generating simple response: ${error.message}${colors.reset}`);
		// Fallback response
		return "Halo! Ada yang bisa saya bantu? 😊";
	}
}

// ========================================
// RAG SERVICE: Mendapatkan konteks dari RAG
// ========================================
async function getContextFromRAG(message) {
	try {
		console.log(`${colors.dim}   → Mengambil konteks dari RAG service...${colors.reset}`);
		const response = await axios.post(
			`${process.env.RAG_SERVICE_URL}/admin/context/searchtest/`,
			{
				message: message,
			}
		);
		console.log(`${colors.dim}   → Ditemukan ${response.data.results.length} konteks relevan${colors.reset}`);
		return response.data.results;
	} catch (error) {
		console.error(`${colors.red}   ❌ Error mengakses RAG service: ${error.message}${colors.reset}`);
		return [];
	}
}

// ========================================
// RESPONSE WITH RAG: Generate response menggunakan Gemini + RAG
// ========================================
async function generateResponseWithRAG(message, contextualChunks) {
	try {
		// Jika tidak ada konteks dari RAG - ANTI HALUSINASI
		if (!contextualChunks || contextualChunks.length === 0) {
			console.log(`${colors.yellow}   ⚠️  Tidak ada konteks dari RAG, menolak menjawab untuk menghindari halusinasi${colors.reset}`);
			
			// Return fallback dengan link konsultasi
			return "Maaf, informasi tersebut belum tersedia dalam knowledge base saya saat ini. 😔\n\n" +
			       "Untuk informasi lebih detail, Anda bisa:\n" +
			       "• Menghubungi klinik kami langsung 📞\n" +
			       "• Membuat ticket konsultasi: http://klinikpemdig.layanan.go.id/konsultasi-form\n\n" +
			       "Ada hal lain yang bisa saya bantu? 🙏";
		}

		const combinedContext = contextualChunks.join("\n\n---\n\n");

		const ragPrompt = `Kamu adalah asisten konsultasi SPBE di Klinik PEMDI.

**IDENTITAS DOMAIN:**
Klinik PEMDI = Program konsultasi SPBE untuk instansi pemerintah.
BUKAN klinik kesehatan. BUKAN layanan medis.

**KONTEKS KNOWLEDGE BASE (SATU-SATUNYA SUMBER KEBENARAN):**
${combinedContext}

**PERTANYAAN USER:**
"${message}"

**PROTOKOL MENJAWAB (ANTI-HALUSINASI KETAT):**

✓ WAJIB:
1. Baca konteks dengan SANGAT teliti
2. Jawab HANYA dari informasi yang EKSPLISIT ada di konteks
3. Jika konteks tidak lengkap/tidak menjawab → katakan JUJUR: "Informasi tersebut tidak tersedia dalam knowledge base saya"
4. Gaya: Natural, profesional, seperti konsultan SPBE yang berpengalaman
5. Panjang: 3-5 kalimat (kecuali butuh penjelasan prosedur)
6. Maksimal 5-6 kalimat (kecuali perlu penjelasan detail)
7. Emoji: 1-2 yang sesuai konteks pemerintahan
8. JANGAN sebut: "berdasarkan dokumen", "sistem internal", "database", "RAG", "AI", "model bahasa"
9. Bahasa Indonesia yang santai tapi profesional

✗ DILARANG KERAS:
- Mengarang/menebak informasi yang tidak ada di konteks
- Menyebut: dokter, pasien, kesehatan, medis, penyakit
- Menyebut: "berdasarkan dokumen", "sistem", "database", "RAG", "AI", "model"
- Menggunakan istilah kesehatan (ini konsultasi SPBE, bukan medis!)
- Bahasa terlalu formal/kaku/birokratis

✓ GUNAKAN:
- "Klinik PEMDI", "kami", "layanan konsultasi SPBE"
- "instansi pemerintah", "transformasi digital", "e-government"

Jawab sekarang dengan natural dan faktual:`;

		console.log(`${colors.dim}   → Generating response dengan RAG context...${colors.reset}`);
		const model = genAI.getGenerativeModel({ model: RESPONSE_MODEL });
		const result = await model.generateContent([ragPrompt]);
		const response = await result.response;

		return response.text();
	} catch (error) {
		// Check jika quota error
		if (isQuotaError(error)) {
			console.error(`${colors.red}   ❌ Quota API habis untuk RAG response${colors.reset}`);
			return getQuotaExceededMessage();
		}
		
		console.error(`${colors.red}   ❌ Error generating response with RAG: ${error.message}${colors.reset}`);
		throw error;
	}
}

// ========================================
// RESPONSE WITH CLARIFICATION: Minta klarifikasi domain-guided (TANPA RAG)
// ========================================
async function generateClarificationResponse(message) {
	try {
		// TIDAK memanggil RAG - langsung minta klarifikasi
		console.log(`${colors.dim}   → Generating domain-guided clarification (no RAG)...${colors.reset}`);
		
		const clarificationPrompt = `Kamu adalah asisten Klinik PEMDI yang membantu user mengklarifikasi pertanyaan.

**IDENTITAS DOMAIN:**
Klinik PEMDI = Program konsultasi SPBE untuk instansi pemerintah.
BUKAN klinik kesehatan. BUKAN layanan medis.

**SITUASI:**
User mengirim pertanyaan yang terlalu VAGUE/AMBIGU: "${message}"

**TUGAS:**
Minta klarifikasi dengan cara yang TERARAH ke domain SPBE:

1. Akui bahwa kamu ingin membantu dengan lebih baik
2. Berikan 3-4 contoh pertanyaan spesifik yang bisa ditanyakan
3. Fokus pada topik SPBE/konsultasi pemerintah

**AREA YANG BISA DITANYAKAN:**
✓ Layanan konsultasi SPBE
✓ Prosedur pendaftaran konsultasi
✓ Persyaratan dan dokumen
✓ Jadwal dan kontak
✓ Regulasi dan kebijakan SPBE
✓ Asistensi teknis transformasi digital

**ATURAN:**
✓ Maksimal 4-5 kalimat
✓ Gunakan 1 emoji
✓ Tetap ramah dan membantu
✓ Berikan contoh pertanyaan konkret
✗ JANGAN sebut: dokter, medis, kesehatan, pasien
✗ JANGAN sebut: sistem, database, AI
✗ JANGAN terkesan menolak atau tidak mau membantu

Jawab sekarang dengan ramah dan terarah:`;

		const model = genAI.getGenerativeModel({ model: RESPONSE_MODEL });
		const result = await model.generateContent([clarificationPrompt]);
		const response = await result.response;

		return response.text();
		       
	} catch (error) {
		// Check jika quota error
		if (isQuotaError(error)) {
			console.error(`${colors.red}❌ Quota API habis untuk clarification${colors.reset}`);
			return getQuotaExceededMessage();
		}
		
		console.error(`${colors.red}❌ Error generating clarification: ${error.message}${colors.reset}`);
		// Fallback manual jika LLM error
		return "Maaf, pertanyaan Anda masih terlalu umum. Bisa lebih spesifik? 🤔\n\n" +
		       "Contoh pertanyaan yang bisa saya bantu:\n" +
		       "• Layanan konsultasi SPBE apa saja yang tersedia?\n" +
		       "• Bagaimana cara mendaftar konsultasi?\n" +
		       "• Apa saja persyaratan untuk menggunakan layanan?\n\n" +
		       "Atau kunjungi: http://klinikpemdig.layanan.go.id/konsultasi-form untuk konsultasi langsung. 🙏";
	}
}

// ========================================
// MAIN CHAT HANDLER
// ========================================
async function processMessage(message) {
	if (!message || message.trim() === "") {
		return;
	}

	console.log(`\n${colors.blue}${colors.bright}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
	console.log(`${colors.green}👤 USER:${colors.reset} ${message}`);
	console.log(`${colors.blue}${colors.bright}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);

	try {
		// STEP 1: Decision Routing menggunakan LLM
		console.log(`${colors.magenta}🧠 Analyzing intent with LLM decision router (${DECISION_MODEL})...${colors.reset}`);
		const decision = await decisionRouter(message);
		console.log(`${colors.magenta}📍 Decision: ${decision}${colors.reset}`);

		let reply;

		// STEP 2: Route ke response generator sesuai decision
		switch (decision) {
			case DECISION_TYPES.NO_RAG:
				// PATH 1: Percakapan natural tanpa RAG
				console.log(`${colors.cyan}💬 Mode: Natural Conversation (No RAG)${colors.reset}`);
				reply = await generateResponseWithoutRAG(message);
				break;

			case DECISION_TYPES.RAG:
				// PATH 2: Pertanyaan dengan RAG
				console.log(`${colors.cyan}🔍 Mode: Knowledge-based (RAG Retrieval)${colors.reset}`);
				const contextualChunks = await getContextFromRAG(message);
				reply = await generateResponseWithRAG(message, contextualChunks);
				break;

			case DECISION_TYPES.CLARIFY:
				// PATH 3: Butuh klarifikasi
				console.log(`${colors.cyan}❓ Mode: Clarification Needed${colors.reset}`);
				reply = await generateClarificationResponse(message);
				break;

			default:
				// Fallback (seharusnya tidak terjadi)
				console.log(`${colors.yellow}⚠️  Unknown decision, fallback to RAG${colors.reset}`);
				const fallbackChunks = await getContextFromRAG(message);
				reply = await generateResponseWithRAG(message, fallbackChunks);
		}

		console.log(`\n${colors.green}${colors.bright}🤖 BOT:${colors.reset} ${reply}`);
		console.log(`${colors.blue}${colors.bright}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}\n`);

	} catch (error) {
		// Check jika quota error
		if (isQuotaError(error)) {
			console.error(`${colors.red}❌ Quota Error: ${error.message}${colors.reset}`);
			const quotaMessage = getQuotaExceededMessage();
			console.log(`\n${colors.green}${colors.bright}🤖 BOT:${colors.reset} ${quotaMessage}`);
			console.log(`${colors.blue}${colors.bright}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}\n`);
		} else {
			console.error(`${colors.red}❌ Error: ${error.message}${colors.reset}\n`);
		}
	}
}

// ========================================
// READLINE INTERFACE - TERMINAL INPUT
// ========================================
const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
	prompt: `${colors.bright}${colors.cyan}Anda: ${colors.reset}`,
});

// Tampilkan prompt awal
rl.prompt();

// Event listener untuk setiap input
rl.on("line", async (input) => {
	const message = input.trim();

	// Check untuk exit commands
	if (message.toLowerCase() === "exit" || message.toLowerCase() === "quit") {
		console.log(`\n${colors.yellow}👋 Terima kasih telah menggunakan chatbot testing mode!${colors.reset}`);
		console.log(`${colors.dim}Sampai jumpa! 🙏${colors.reset}\n`);
		process.exit(0);
	}

	// Process message
	await processMessage(message);

	// Tampilkan prompt lagi
	rl.prompt();
});

// Event listener untuk CTRL+C
rl.on("SIGINT", () => {
	console.log(`\n\n${colors.yellow}👋 Terima kasih telah menggunakan chatbot testing mode!${colors.reset}`);
	console.log(`${colors.dim}Sampai jumpa! 🙏${colors.reset}\n`);
	process.exit(0);
});

// Handle uncaught errors
process.on("uncaughtException", (error) => {
	console.error(`${colors.red}❌ Uncaught Exception: ${error.message}${colors.reset}`);
});

process.on("unhandledRejection", (error) => {
	console.error(`${colors.red}❌ Unhandled Rejection: ${error.message}${colors.reset}`);
});

// Display startup info
console.log(`${colors.green}✅ Chatbot testing mode siap!${colors.reset}`);
console.log(`${colors.cyan}📊 Model Configuration:${colors.reset}`);
console.log(`${colors.dim}   • Decision Router: ${DECISION_MODEL}${colors.reset}`);
console.log(`${colors.dim}   • Response Generation: ${RESPONSE_MODEL}${colors.reset}`);
console.log(`${colors.yellow}💡 Tips:${colors.reset}`);
console.log(`${colors.dim}   • Ketik sapaan untuk test respons natural (contoh: "halo", "hai")${colors.reset}`);
console.log(`${colors.dim}   • Ketik pertanyaan spesifik untuk test RAG (contoh: "layanan apa saja?")${colors.reset}`);
console.log(`${colors.dim}   • Ketik "exit" atau "quit" untuk keluar${colors.reset}\n`);
