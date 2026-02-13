# 🏗️ Arsitektur Chatbot - LLM-Based Decision Routing

## 📋 Overview

Chatbot ini menggunakan **LLM-based decision routing** yang meniru cara berpikir manusia dalam mengklasifikasikan intent user, menggantikan pendekatan keyword-based if-else yang kaku.

---

## 🎯 Arsitektur 3-Layer

```
┌─────────────────────────────────────────────────┐
│           USER MESSAGE INPUT                    │
└─────────────────┬───────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────┐
│     LAYER 1: DECISION ROUTER (LLM)              │
│     • Analyze intent dengan LLM                 │
│     • Output: NO_RAG | RAG | CLARIFY            │
│     • TIDAK menjawab user                       │
└─────────────────┬───────────────────────────────┘
                  │
        ┌─────────┴─────────┬──────────┐
        │                   │          │
        ▼                   ▼          ▼
   ┌─────────┐       ┌──────────┐  ┌──────────┐
   │ NO_RAG  │       │   RAG    │  │ CLARIFY  │
   └────┬────┘       └─────┬────┘  └─────┬────┘
        │                  │             │
        ▼                  ▼             │
┌──────────────┐   ┌──────────────┐    │
│  LAYER 2:    │   │  LAYER 2:    │    │
│  Response    │   │  RAG         │    │
│  Without RAG │   │  Retrieval   │    │
└──────┬───────┘   └──────┬───────┘    │
       │                  │             │
       │                  ▼             │
       │          ┌──────────────┐     │
       │          │  LAYER 3:    │     │
       │          │  Response    │     │
       │          │  With RAG    │     │
       │          └──────┬───────┘     │
       │                 │             │
       └─────────────────┴─────────────┘
                         │
                         ▼
              ┌──────────────────┐
              │  FINAL RESPONSE  │
              └──────────────────┘
```

---

## 🔄 Flow Diagram Detail

### 1️⃣ **Decision Router Flow**

```javascript
User Message → LLM Decision Maker
                     ↓
              Classify Intent
                     ↓
        ┌────────────┼────────────┐
        ↓            ↓            ↓
    NO_RAG         RAG        CLARIFY
  (Sapaan,    (Pertanyaan    (Pertanyaan
  small talk,  spesifik      ambigu butuh
  terima kasih) klinik)      klarifikasi)
```

### 2️⃣ **Response Generation Flow**

**Path A: NO_RAG**
```
Message → generateResponseWithoutRAG()
            → LLM with conversational prompt
              → Natural, friendly response
```

**Path B: RAG**
```
Message → getContextFromRAG()
            → Retrieve relevant context
              → generateResponseWithRAG(message, context)
                  → LLM with context-aware prompt
                    → Factual response based on knowledge base
```

**Path C: CLARIFY**
```
Message → generateClarificationResponse()
            → LLM with clarification prompt
              → Ask for more specific information
```

---

## 🧠 Decision Router: Prompt Engineering

### **Prinsip Prompt Decision Maker:**

1. **Single Responsibility**: Hanya klasifikasi, tidak menjawab
2. **Clear Examples**: Berikan contoh konkret untuk setiap kategori
3. **Constrained Output**: Output terbatas (NO_RAG | RAG | CLARIFY)
4. **Fast & Efficient**: Prompt singkat untuk latency rendah

### **Struktur Prompt:**

```
Role Definition
    ↓
Classification Categories
    ↓
Clear Examples (5-7 per category)
    ↓
User Message Input
    ↓
Output Constraint (single word)
```

---

## 🛡️ Anti-Halusinasi Strategy

### **Problem**: LLM cenderung mengarang jawaban jika tidak ada konteks

### **Solution**:

1. **No Context = Honest Admission**
   ```javascript
   if (!contextualChunks || contextualChunks.length === 0) {
       return "Maaf, informasi tersebut belum tersedia...";
   }
   ```

2. **Explicit Instruction**
   - Prompt: "Jawab HANYA berdasarkan informasi yang ada"
   - Prompt: "JANGAN mengarang informasi yang tidak ada"

3. **Context Validation**
   - Cek kualitas RAG retrieval
   - Fallback ke honest response jika confidence rendah

---

## ⚡ Optimization: Token Efficiency

### **Decision Router**
- ✅ Prompt ringkas (~150 tokens)
- ✅ Output 1 kata (NO_RAG/RAG/CLARIFY)
- ✅ Latency rendah untuk user experience

### **Response Generation**
- ✅ Reuse model instance
- ✅ Prompt struktural jelas
- ✅ Batasi panjang output (2-6 kalimat)

### **Best Practices:**
```javascript
// ❌ BURUK: Create model setiap kali
async function badApproach() {
    const model1 = genAI.getGenerativeModel(...);
    const model2 = genAI.getGenerativeModel(...);
}

// ✅ BAIK: Reuse model instance
const model = genAI.getGenerativeModel({ model: MODEL_NAME });
async function goodApproach() {
    const result = await model.generateContent([prompt]);
}
```

---

## 📊 Comparison: Before vs After

### **BEFORE (Keyword-based)**
```javascript
// ❌ Rigid, tidak natural
if (keywords.includes('halo')) return false;
if (keywords.includes('layanan')) return true;
// Problem: "halo, layanan apa saja?" → ambigu
```

### **AFTER (LLM-based)**
```javascript
// ✅ Context-aware, menyerupai manusia
decision = await decisionRouter("halo, layanan apa saja?");
// Output: RAG (memahami intent utama adalah pertanyaan)
```

---

## 🔧 Configuration & Tuning

### **Model Selection**
- **Decision Router**: Gemini Flash (lightweight, cepat)
- **Response Generation**: Gemini Flash (balance speed & quality)
- **Future**: Pertimbangkan Gemini Pro untuk RAG jika butuh reasoning lebih kompleks

### **Prompt Tuning Checklist**
- [ ] Test dengan 10+ variasi sapaan
- [ ] Test dengan pertanyaan spesifik klinik
- [ ] Test dengan pertanyaan ambigu
- [ ] Validasi output decision consistency
- [ ] Monitor latency dan token usage

---

## 📈 Monitoring & Metrics

### **Key Metrics to Track:**

1. **Decision Accuracy**
   - % correct NO_RAG classification
   - % correct RAG classification
   - % correct CLARIFY classification

2. **Response Quality**
   - User satisfaction score
   - Halusinasi rate (jika ada)
   - Average response length

3. **Performance**
   - Decision latency (target: <500ms)
   - Response generation latency (target: <2s)
   - Token usage per conversation

---

## 🚀 Future Enhancements

### **Phase 2:**
- [ ] Add conversation history context
- [ ] Multi-turn clarification handling
- [ ] User feedback loop for decision accuracy

### **Phase 3:**
- [ ] Fine-tune custom model untuk decision routing
- [ ] A/B testing different prompts
- [ ] Advanced RAG with re-ranking

---

## 📝 Code Example

### **Complete Integration:**

```javascript
// Main handler dengan LLM decision routing
async function processMessage(message) {
    // 1. Decision Layer
    const decision = await decisionRouter(message);
    
    // 2. Response Generation Layer
    let reply;
    switch (decision) {
        case 'NO_RAG':
            reply = await generateResponseWithoutRAG(message);
            break;
        case 'RAG':
            const context = await getContextFromRAG(message);
            reply = await generateResponseWithRAG(message, context);
            break;
        case 'CLARIFY':
            reply = await generateClarificationResponse(message);
            break;
    }
    
    return reply;
}
```

---

## 🎓 Best Practices Summary

1. **Decision Router hanya klasifikasi, tidak menjawab**
2. **Prompt harus clear dengan contoh konkret**
3. **Validasi output untuk menghindari decision error**
4. **No context = honest admission (anti-halusinasi)**
5. **Monitor token usage dan latency**
6. **Gunakan prompt engineering untuk efisiensi**
7. **Test dengan edge cases secara berkala**

---

## 📚 References

- Gemini API Documentation
- RAG Best Practices
- Prompt Engineering Guide
- Anti-Halusinasi Strategies

---

**Last Updated**: 2026-02-12
**Version**: 1.0.0
**Author**: Senior AI Engineering Team
