# Fertility Backend API

Backend server for Medical Report Analyzer MVP

## Endpoints

- `GET /health` - Health check
- `POST /api/ocr` - Extract text from PDF/image
- `POST /api/analyze` - Analyze text with Claude AI

## Local Development

```bash
npm install
npm start
```

Server runs on http://localhost:3001

## Deploy to Railway

### Option 1: GitHub (Recommended)

1. Create GitHub repo
2. Push code
3. Go to railway.app
4. "New Project" → "Deploy from GitHub"
5. Select repo
6. Deploy automatically!

### Option 2: Railway CLI

```bash
npm install -g @railway/cli
railway login
railway init
railway up
```

## Environment Variables

None required! API keys sent from frontend.

## Testing

```bash
# Health check
curl http://localhost:3001/health

# OCR test
curl -X POST -F "file=@test.pdf" http://localhost:3001/api/ocr
```
