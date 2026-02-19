const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fetch = require('node-fetch');
const FormData = require('form-data');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Fertility MVP Backend is running' });
});

// OCR endpoint
app.post('/api/ocr', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log(`Processing file: ${req.file.originalname}, Size: ${(req.file.size / 1024 / 1024).toFixed(2)}MB`);

    // Create form data for OCR.space
    const formData = new FormData();
    formData.append('file', req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype
    });
    formData.append('language', 'por,eng,spa');
    formData.append('isOverlayRequired', 'false');
    formData.append('detectOrientation', 'true');
    formData.append('scale', 'true');
    formData.append('OCREngine', '2');

    // Call OCR.space API
    const ocrResponse = await fetch('https://api.ocr.space/parse/image', {
      method: 'POST',
      body: formData,
      headers: formData.getHeaders()
    });

    if (!ocrResponse.ok) {
      throw new Error(`OCR API error: ${ocrResponse.status}`);
    }

    const ocrData = await ocrResponse.json();

    if (ocrData.IsErroredOnProcessing) {
      throw new Error(ocrData.ErrorMessage?.[0] || 'OCR processing failed');
    }

    // Extract text from OCR results
    let extractedText = '';
    if (ocrData.ParsedResults && ocrData.ParsedResults.length > 0) {
      ocrData.ParsedResults.forEach((result, index) => {
        if (result.ParsedText) {
          extractedText += `Page ${index + 1}:\n${result.ParsedText}\n\n`;
        }
      });
    }

    if (extractedText.length < 50) {
      return res.status(400).json({ 
        error: 'No text could be extracted from the document' 
      });
    }

    console.log(`Successfully extracted ${extractedText.length} characters`);

    res.json({ 
      success: true, 
      text: extractedText,
      filename: req.file.originalname
    });

  } catch (error) {
    console.error('OCR error:', error);
    res.status(500).json({ 
      error: 'Failed to process document', 
      details: error.message 
    });
  }
});

// Claude API endpoint
app.post('/api/analyze', async (req, res) => {
  try {
    const { text, apiKey } = req.body;

    if (!text) {
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
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: `${MEDICAL_PROMPT}\n\nAnalyze the following medical document:\n\n${text}`
        }]
      })
    });

    if (!claudeResponse.ok) {
      const errorText = await claudeResponse.text();
      throw new Error(`Claude API error: ${claudeResponse.status} - ${errorText}`);
    }

    const claudeData = await claudeResponse.json();
    const report = claudeData.content[0].text;

    console.log('Analysis complete');

    res.json({ 
      success: true, 
      report: report 
    });

  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ 
      error: 'Failed to analyze document', 
      details: error.message 
    });
  }
});

app.listen(PORT, () => {
  console.log(`\n🏥 Fertility Backend Server running on port ${PORT}`);
  console.log(`\n✅ Health check: http://localhost:${PORT}/health`);
  console.log(`✅ OCR endpoint: POST http://localhost:${PORT}/api/ocr`);
  console.log(`✅ Analysis endpoint: POST http://localhost:${PORT}/api/analyze\n`);
});
