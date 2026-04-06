require("dotenv").config();
const readline = require("readline");
const axios = require("axios");

// ========================================
// CONFIGURATION - THIN CLIENT ORCHESTRATOR
// ========================================
const BACKEND_URL = process.env.BACKEND_URL || "https://0f0b-34-16-150-20.ngrok-free.app";
const RAG_SERVICE_URL = process.env.RAG_SERVICE_URL;

// ⚠️ CRITICAL ARCHITECTURE PRINCIPLE:
// Node.js = ORCHESTRATOR ONLY
// NO PROMPTS. NO LLM LOGIC. NO BUSINESS RULES.
// All intelligence lives in FastAPI backend.

// Terminal colors untuk output
const colors = {
	reset: "\x1b[0m",
	bright: "\x1b[1m",
	dim: "\x1b[2m",
	red: "\x1b[31m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	blue: "\x1b[34m",
	magenta: "\x1b[35m",
	cyan: "\x1b[36m",
	white: "\x1b[37m",
	bgBlue: "\x1b[44m",
	bgGreen: "\x1b[42m",
};

console.log(`${colors.cyan}${colors.bright}
╔══════════════════════════════════════════════════════════╗
║                                                          ║
║     🤖 WHATSAPP CHATBOT - ORCHESTRATOR v2.0 🤖          ║
║        (Backend-First Architecture)                      ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
${colors.reset}`);

console.log(`${colors.yellow}📋 Architecture: Orchestrator-only (no prompts in Node.js)${colors.reset}`);
console.log(`${colors.cyan}🔗 Backend API: ${BACKEND_URL}${colors.reset}`);
console.log(`${colors.cyan}🔗 RAG Service: ${RAG_SERVICE_URL}${colors.reset}`);
console.log(`${colors.dim}💡 Ketik 'exit' atau 'quit' untuk keluar${colors.reset}\n`);

// ========================================
// BACKEND API CLIENT - THIN WRAPPER
// ========================================

/**
 * Call /decision endpoint for intent classification
 * Returns: { decision: "NO_RAG" | "RAG" | "CLARIFY" }
 */
async function getDecision(message) {
	try {
		console.log(`${colors.dim}   → POST ${BACKEND_URL}/decision${colors.reset}`);
		
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
		handleBackendError(error, "/decision");
		throw error;
	}
}

/**
 * Call /generate endpoint for response generation
 * Returns: { reply: "string" }
 */
async function generateResponse(message, mode, context = null) {
	try {
		console.log(`${colors.dim}   → POST ${BACKEND_URL}/generate (mode=${mode})${colors.reset}`);
		
		const requestBody = {
			message: message,
			mode: mode
		};
		
		// Add context only for RAG mode
		if (mode === "RAG" && context) {
			requestBody.context = context;
		}
		// console.log(`message: ${message}`);
		// console.log(`context: ${JSON.stringify(context)}`);

		const response = await axios.post(`${BACKEND_URL}/generate`, requestBody, {
			headers: { 'Content-Type': 'application/json' }
		});

		if (response.data && response.data.reply) {
			return response.data.reply;
		}

		throw new Error("Invalid response format from /generate");

	} catch (error) {
		handleBackendError(error, "/generate");
		throw error;
	}
}

/**
 * Fetch context from RAG service
 * This is the ONLY external service call from Node.js
 */
async function getContextFromRAG(message) {
    try {
        console.log(`${colors.dim}   → Fetching context from RAG service...${colors.reset}`);
        
        const response = await axios.post(
            `${RAG_SERVICE_URL}/admin/context/search/`,
            { query: message } // <- Ubah "message" menjadi "query" di sini
        );
        
        if (response.data && response.data.results) {
            console.log(`${colors.dim}   → Found ${response.data.results.length} context chunks${colors.reset}`);
            return response.data.results.map(item => item.content);
        }
        
        return [];
        
    } catch (error) {
        console.error(`${colors.red}   ❌ RAG service error: ${error.message}${colors.reset}`);
        return []; // Return empty context on error
    }
}

// ========================================
// ERROR HANDLING
// ========================================

function handleBackendError(error, endpoint) {
	if (error.code === 'ECONNREFUSED') {
		console.error(`${colors.red}   ❌ Cannot connect to backend at ${BACKEND_URL}${colors.reset}`);
		console.error(`${colors.yellow}   ⚠️  Make sure FastAPI service is running${colors.reset}`);
	} else if (error.response) {
		console.error(`${colors.red}   ❌ Backend error (${endpoint}): ${error.response.status}${colors.reset}`);
		if (error.response.data) {
			console.error(`${colors.dim}   ${JSON.stringify(error.response.data)}${colors.reset}`);
		}
	} else {
		console.error(`${colors.red}   ❌ ${endpoint} error: ${error.message}${colors.reset}`);
	}
}

function getServiceUnavailableMessage() {
	return "Maaf, layanan chatbot sedang tidak tersedia saat ini. 😔\n\n" +
	       "Silakan:\n" +
	       "• Coba lagi beberapa saat\n" +
	       "• Atau kunjungi: http://klinikpemdig.layanan.go.id/konsultasi-form\n\n" +
	       "Tim kami akan segera membantu Anda! 🙏";
}

// ========================================
// MAIN ORCHESTRATION LOGIC
// ========================================

/**
 * Main message processing orchestrator
 * 
 * Flow:
 * 1. Call /decision to classify intent
 * 2. If RAG → fetch context from RAG service
 * 3. Call /generate with appropriate mode and context
 * 4. Return reply to user
 * 
 * ⚠️ NO PROMPT LOGIC HERE - all in backend
 */
async function processMessage(message) {
	if (!message || message.trim() === "") {
		return;
	}

	console.log(`\n${colors.blue}${colors.bright}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
	console.log(`${colors.green}👤 USER:${colors.reset} ${message}`);
	console.log(`${colors.blue}${colors.bright}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);

	try {
		// ========================================
		// STEP 1: DECISION ROUTING (Backend)
		// ========================================
		console.log(`${colors.magenta}🧠 Step 1: Intent Classification${colors.reset}`);
		const decision = await getDecision(message);
		console.log(`${colors.magenta}📍 Decision Result: ${decision}${colors.reset}`);

		let context = null;
		
		// ========================================
		// STEP 2: RAG CONTEXT RETRIEVAL (if needed)
		// ========================================
		if (decision === "RAG") {
			console.log(`${colors.cyan}🔍 Step 2: Fetching RAG Context${colors.reset}`);
			context = await getContextFromRAG(message);
			
			if (!context || context.length === 0) {
				console.log(`${colors.yellow}   ⚠️  No context found, backend will handle gracefully${colors.reset}`);
			}
		} else {
			console.log(`${colors.cyan}💬 Step 2: Skipped (${decision} mode doesn't need RAG)${colors.reset}`);
		}
		
		// ========================================
		// STEP 3: RESPONSE GENERATION (Backend)
		// ========================================
		console.log(`${colors.magenta}✨ Step 3: Generating Response (mode=${decision})${colors.reset}`);
		const reply = await generateResponse(message, decision, context);
		
		// ========================================
		// STEP 4: DELIVER TO USER
		// ========================================
		console.log(`\n${colors.green}${colors.bright}🤖 BOT:${colors.reset} ${reply}`);
		console.log(`${colors.blue}${colors.bright}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}\n`);

	} catch (error) {
		// Graceful error handling
		console.error(`${colors.red}❌ Orchestration Error: ${error.message}${colors.reset}`);
		
		const fallbackMessage = getServiceUnavailableMessage();
		console.log(`\n${colors.green}${colors.bright}🤖 BOT:${colors.reset} ${fallbackMessage}`);
		console.log(`${colors.blue}${colors.bright}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}\n`);
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

rl.prompt();

rl.on("line", async (input) => {
	const message = input.trim();

	if (message.toLowerCase() === "exit" || message.toLowerCase() === "quit") {
		console.log(`\n${colors.yellow}👋 Terima kasih telah menggunakan chatbot!${colors.reset}`);
		console.log(`${colors.dim}Sampai jumpa! 🙏${colors.reset}\n`);
		process.exit(0);
	}

	await processMessage(message);
	rl.prompt();
});

rl.on("SIGINT", () => {
	console.log(`\n\n${colors.yellow}👋 Terima kasih telah menggunakan chatbot!${colors.reset}`);
	console.log(`${colors.dim}Sampai jumpa! 🙏${colors.reset}\n`);
	process.exit(0);
});

process.on("uncaughtException", (error) => {
	console.error(`${colors.red}❌ Uncaught Exception: ${error.message}${colors.reset}`);
});

process.on("unhandledRejection", (error) => {
	console.error(`${colors.red}❌ Unhandled Rejection: ${error.message}${colors.reset}`);
});

// ========================================
// STARTUP HEALTH CHECK
// ========================================

async function checkBackendHealth() {
	try {
		console.log(`${colors.yellow}🔍 Checking backend health...${colors.reset}`);
		
		const response = await axios.get(`${BACKEND_URL}/health`);
		
		if (response.data && response.data.status === "healthy") {
			console.log(`${colors.green}✅ Backend is healthy and ready!${colors.reset}`);
			return true;
		}
		
		console.log(`${colors.yellow}⚠️  Backend responded but not healthy${colors.reset}`);
		return false;
		
	} catch (error) {
		console.log(`${colors.red}❌ Cannot connect to backend at ${BACKEND_URL}${colors.reset}`);
		console.log(`${colors.yellow}⚠️  Make sure FastAPI service is running:${colors.reset}`);
		console.log(`${colors.dim}   python app.py${colors.reset}`);
		console.log(`${colors.dim}   or${colors.reset}`);
		console.log(`${colors.dim}   docker run -d -p 8000:8000 llm-service${colors.reset}\n`);
		return false;
	}
}

// Display startup info
(async () => {
	const isHealthy = await checkBackendHealth();
	
	console.log(`${colors.green}✅ Orchestrator ready!${colors.reset}`);
	console.log(`${colors.cyan}📊 Architecture Info:${colors.reset}`);
	console.log(`${colors.dim}   • Node.js Role: Orchestrator ONLY${colors.reset}`);
	console.log(`${colors.dim}   • Decision Making: ${BACKEND_URL}/decision${colors.reset}`);
	console.log(`${colors.dim}   • Response Generation: ${BACKEND_URL}/generate${colors.reset}`);
	console.log(`${colors.dim}   • RAG Service: ${RAG_SERVICE_URL}${colors.reset}`);
	console.log(`${colors.yellow}💡 Tips:${colors.reset}`);
	console.log(`${colors.dim}   • Semua prompt ada di backend Python${colors.reset}`);
	console.log(`${colors.dim}   • Node.js hanya routing dan orchestration${colors.reset}`);
	console.log(`${colors.dim}   • Ketik "exit" atau "quit" untuk keluar${colors.reset}\n`);
	
	if (!isHealthy) {
		console.log(`${colors.yellow}⚠️  Backend not available. Messages will show error responses.${colors.reset}\n`);
	}
})();
