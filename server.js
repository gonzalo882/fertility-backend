const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Fertility MVP Backend is running' });
});
app.get('/debug/env', (req, res) => {
  res.json({
    hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
    hasAzureKey: !!process.env.AZURE_DI_KEY,
    hasAzureEndpoint: !!process.env.AZURE_DI_ENDPOINT,
  });
});




// ===== OCR (Azure Document Intelligence) =====
const AZURE_DI_ENDPOINT = process.env.AZURE_DI_ENDPOINT;
const AZURE_DI_KEY = process.env.AZURE_DI_KEY;
const AZURE_API_VERSION = '2024-11-30';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

app.post('/api/ocr', upload.single('file'), async (req, res) => {
  try {
    if (!AZURE_DI_ENDPOINT || !AZURE_DI_KEY) {
      return res.status(500).json({ error: 'Missing Azure DI env vars' });
    }
    if (!req.file?.buffer) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const endpoint = AZURE_DI_ENDPOINT.replace(/\/$/, '');
    const submitUrl =
      `${endpoint}/documentintelligence/documentModels/prebuilt-read:analyze` +
      `?api-version=${AZURE_API_VERSION}`;

    // 1) Submit (returns 202 + operation-location)
    const submitResp = await fetch(submitUrl, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': AZURE_DI_KEY,
        'Content-Type': req.file.mimetype || 'application/pdf',
      },
      body: req.file.buffer,
    });

    if (submitResp.status !== 202) {
      const txt = await submitResp.text();
      return res.status(500).json({
        error: 'Azure DI submit failed',
        status: submitResp.status,
        details: txt,
      });
    }

    const opLocation = submitResp.headers.get('operation-location');
    if (!opLocation) {
      return res.status(500).json({ error: 'Missing Operation-Location' });
    }

    // 2) Poll until succeeded
    let finalData = null;
    for (let i = 0; i < 120; i++) {
      await sleep(1500);

      const pollResp = await fetch(opLocation, {
        headers: { 'Ocp-Apim-Subscription-Key': AZURE_DI_KEY },
      });

      const data = await pollResp.json();

      if (data.status === 'succeeded') {
        finalData = data;
        break;
      }
      if (data.status === 'failed') {
        return res.status(500).json({ error: 'Azure DI failed', details: data });
      }
    }

    if (!finalData) {
      return res.status(504).json({ error: 'Azure DI timeout' });
    }

    const text = finalData?.analyzeResult?.content || '';
    return res.json({ text });
  } catch (e) {
    return res
      .status(500)
      .json({ error: 'Azure DI exception', details: String(e) });
  }
});

// ===== Analyze (Anthropic Claude) =====
app.post('/api/analyze', async (req, res) => {
  try {
    const { text } = req.body;
    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!text || !String(text).trim()) {
      return res.status(400).json({ error: 'No text provided' });
    }

    if (!apiKey) {
      return res.status(400).json({ error: 'No API key provided' });
    }

    const MEDICAL_PROMPT = `ROLE: You are an Expert Assistant in Reproductive Medicine Documentation (ART/IVF).

OBJECTIVE: Extract clinically relevant information from medical documents and generate a FIRST VISIT NOTE (COMPACT FORMAT).

OUTPUT FORMAT (MANDATORY):

DATA STRUCTURE: FIRST VISIT NOTE (COMPACT)

1. HEADER AND IDENTIFICATION
REF: [PATIENT_ID] | Date: [DD/MM/YYYY]
PATIENT: [NAME] ([AGE] years) | PARTNER: [NAME] ([AGE] years)
REASON/SUMMARY: [SHORT FREE TEXT]

2. BACKGROUND (Compact Format)
PATIENT (Female):
Obs: G[N] P[N] A[N] | TPAL: [T-P-A-L] | Miscarriages: [DATES and WEEKS]
Gynecology: Cycle: [DAYS/DURATION] | Allergies: [TXT] | Toxics: [TXT]
Medical/Surgical: [RELEVANT HISTORY]

PARTNER (Male/Female):
Previous children: [N] | Allergies: [TXT] | Toxics: [TXT]
Medical/Surgical: [RELEVANT HISTORY]

3. PREVIOUS TREATMENTS (Synthetic View)
[PREVIOUS CYCLE INFORMATION IF AVAILABLE]

4. TESTS PERFORMED (Linear Format)
Basic and Serology: [AVAILABLE DATA]
Ovarian Reserve and Hormonal: [AVAILABLE DATA]
Male Factor: [AVAILABLE DATA]
Imaging and Uterus: [AVAILABLE DATA]

5. ADVANCED AND SPECIAL STUDIES
[AVAILABLE DATA OR "ND" IF NONE]

6. PLAN AND DIAGNOSTIC ORIENTATION
Main Diagnosis: [TEXT]
Proposed Plan: [TEXT]
Pending Tests: [LIST]

RULES:
- Do not invent data. If missing → "ND"
- Dates: DD/MM/YYYY
- Keep compact format (1-2 lines per section)`;

    console.log('Calling Claude API...');

    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: `${MEDICAL_PROMPT}\n\nAnalyze the following medical document:\n\n${text}`,
          },
        ],
      }),
    });

    if (!claudeResponse.ok) {
      const errorText = await claudeResponse.text();
      return res.status(500).json({
        error: 'Failed to analyze document',
        details: `Claude API error: ${claudeResponse.status} - ${errorText}`,
      });
    }

    const claudeData = await claudeResponse.json();
    const report = claudeData?.content?.[0]?.text ?? '';

    console.log('Analysis complete');

    return res.json({
      success: true,
      report,
    });
  } catch (error) {
    console.error('Analysis error:', error);
    return res.status(500).json({
      error: 'Failed to analyze document',
      details: String(error.message || error),
    });
  }
});

app.listen(PORT, () => {
  console.log(`\n🏥 Fertility Backend Server running on port ${PORT}`);
  console.log(`\n✅ Health check: http://localhost:${PORT}/health`);
  console.log(`✅ OCR endpoint: POST http://localhost:${PORT}/api/ocr`);
  console.log(`✅ Analysis endpoint: POST http://localhost:${PORT}/api/analyze\n`);
});
