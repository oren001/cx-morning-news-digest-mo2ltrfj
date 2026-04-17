# Personal Morning Digest - עיתון אישי

A Cloudflare Worker application that scrapes multiple news sources, extracts factual claims, identifies consensus vs controversy, and presents results in user-selected tones.

## Features

- **Multi-Source Analysis**: Input 5-10 news article URLs for comparative analysis
- **Claim Extraction**: AI-powered extraction of factual claims from each article
- **Consensus Detection**: Identifies which claims multiple sources agree on
- **Controversy Tracking**: Highlights claims where sources disagree
- **Omission Analysis**: Notes which sources didn't mention certain topics
- **Multiple Presentation Styles**: Factual/Dry, Optimistic, Kid-Friendly, Deep Analytical
- **Smart Caching**: Results cached for 1 hour to enable instant tone switching
- **Clean UI**: Professional news reader aesthetic with clear visual hierarchy

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure OpenRouter API Key

This application requires an OpenRouter API key for claim extraction and tone transformation.

#### Option A: Local Development (.env file)

Create a `.env` file in the root directory:

```bash
cp .env.example .env
```

Edit `.env` and add your OpenRouter API key:

```
OPENROUTER_API_KEY=your_actual_key_here
```

#### Option B: Production Deployment (Cloudflare Dashboard)

After deploying, you **must** add the API key via Cloudflare Dashboard:

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Select your account → Workers & Pages
3. Click on your deployed worker
4. Go to Settings → Variables and Secrets
5. Add environment variable:
   - Name: `OPENROUTER_API_KEY`
   - Value: Your OpenRouter API key
   - Type: Secret (encrypted)
6. Click "Save and Deploy"

**Get an OpenRouter API key**: Visit [openrouter.ai](https://openrouter.ai) and sign up for an account.

### 3. Create KV Namespace

Create a KV namespace for caching results:

```bash
npx wrangler kv:namespace create DIGEST_CACHE
```

Copy the namespace ID from the output and update `wrangler.toml` if needed (should already be configured).

### 4. Deploy

```bash
npx wrangler deploy
```

Your worker will be available at: `https://personal-digest.<your-subdomain>.workers.dev`

### 5. Local Development

```bash
npm run dev
```

Access at: `http://localhost:8787`

## Usage Guide

### Web Interface

1. **Enter URLs**: Paste 5-10 news article URLs (one per line) in the text area
2. **Add API Key**: Enter your OpenRouter API key in the provided field
3. **Click Analyze**: Processing takes 30-60 seconds depending on article count
4. **View Results**: Results are organized into three sections:
   - **High Consensus**: Claims agreed upon by multiple sources (green badges)
   - **Controversy**: Claims where sources disagree (orange badges)
   - **Omissions**: Topics mentioned by only some sources (gray badges)
5. **Change Style**: Click any presentation style pill to regenerate the summary
6. **Copy Summary**: Use the copy button to save the full analysis to clipboard

### API Endpoints

#### POST /api/analyze

Scrapes URLs, extracts claims, and performs consensus analysis.

**Request:**
```json
{
  "urls": [
    "https://example.com/article1",
    "https://example.com/article2"
  ],
  "apiKey": "your_openrouter_api_key"
}
```

**Response:**
```json
{
  "jobId": "1234567890abc",
  "results": {
    "consensus": [
      {
        "claim": "The policy was announced today",
        "sources": ["Source A", "Source B"],
        "confidence": 0.95
      }
    ],
    "controversy": [
      {
        "claim": "Impact will be significant",
        "positions": [
          {"source": "Source A", "stance": "positive"},
          {"source": "Source B", "stance": "negative"}
        ]
      }
    ],
    "omissions": [
      {
        "topic": "Economic impact",
        "mentionedBy": ["Source A"],
        "omittedBy": ["Source B"]
      }
    ],
    "summary": "Full text summary...",
    "timestamp": "2025-01-15T10:30:00Z",
    "style": "factual"
  }
}
```

#### POST /api/restyle

Regenerates summary in a different presentation style using cached analysis.

**Request:**
```json
{
  "jobId": "1234567890abc",
  "style": "optimistic",
  "apiKey": "your_openrouter_api_key"
}
```

**Response:**
```json
{
  "summary": "Regenerated summary in optimistic tone..."
}
```

**Available styles:**
- `factual`: Dry, just-the-facts presentation
- `optimistic`: Positive, hopeful framing
- `kid-friendly`: Simple language, educational approach
- `analytical`: Deep dive with context and implications

#### GET /api/status/:jobId

Check status of cached analysis results.

**Response:**
```json
{
  "status": "complete",
  "results": { /* AnalysisResults object */ }
}
```

## Architecture Overview

### File Structure

```
├── index.js           # Main Worker entry point & HTML template
├── lib/
│   ├── scraper.js     # URL fetching and HTML parsing
│   ├── claims.js      # Claim extraction and clustering
│   ├── llm.js         # OpenRouter API wrapper
│   └── cache.js       # KV storage utilities
├── wrangler.toml      # Cloudflare Worker configuration
├── package.json       # Dependencies and scripts
└── README.md          # This file
```

### Data Flow

1. **URL Input**: User submits 5-10 news article URLs
2. **Scraping**: Worker fetches each URL and parses HTML with Cheerio
3. **Claim Extraction**: OpenRouter LLM extracts factual claims from article text
4. **Clustering**: Similar claims grouped using keyword overlap analysis
5. **Consensus Scoring**: Calculate how many sources agree on each claim
6. **Controversy Detection**: Identify claims where sources disagree
7. **Caching**: Results stored in KV for 1 hour with unique jobId
8. **Presentation**: Summary generated in selected style
9. **Restyle**: User can instantly switch tones using cached analysis

### Technology Stack

- **Runtime**: Cloudflare Workers (edge computing)
- **HTML Parsing**: Cheerio (server-side jQuery-like API)
- **AI Processing**: OpenRouter API (LLM access)
- **Caching**: Cloudflare KV (key-value storage)
- **Frontend**: React via CDN, inline CSS and JavaScript

### Key Constants

```javascript
MAX_URLS = 10                    // Maximum URLs per analysis
CACHE_TTL_SECONDS = 3600         // 1 hour cache duration
API_TIMEOUT_MS = 30000           // 30 second timeout for API calls
SCRAPE_TIMEOUT_MS = 10000        // 10 second timeout per URL
```

## Troubleshooting

### Common Scraping Issues

#### Problem: "Failed to fetch article"

**Causes:**
- Site uses JavaScript rendering (Worker can't execute JS)
- CORS restrictions or anti-bot protection
- Paywall or login required
- Invalid URL or site offline

**Solutions:**
- Try alternative news sources without paywalls
- Look for RSS feeds or API endpoints instead
- Use sites with static HTML content
- Verify URL is accessible in a browser

#### Problem: "Extracted content is empty"

**Causes:**
- Article selector couldn't find main content
- Page structure doesn't match expected HTML patterns
- Content loaded via JavaScript after initial render

**Solutions:**
- Site may not be compatible with static scraping
- Try different news sources with standard article structures
- Check if site has an API or RSS feed

#### Problem: "Request timeout"

**Causes:**
- Site is slow to respond
- Too many URLs submitted at once
- OpenRouter API is slow or overloaded

**Solutions:**
- Reduce number of URLs (try 5 instead of 10)
- Try again during off-peak hours
- Check OpenRouter status page

### API Key Issues

#### Problem: "Invalid API key" or 401 errors

**Solutions:**
1. Verify key is correctly copied from OpenRouter dashboard
2. Check key has sufficient credits/quota
3. Ensure key is set as encrypted secret in Cloudflare (not plain text)
4. Redeploy worker after adding environment variable

#### Problem: "API rate limit exceeded"

**Solutions:**
- OpenRouter has rate limits per key tier
- Wait a few minutes before retrying
- Consider upgrading OpenRouter plan for higher limits
- Use caching - restyle operations don't count against limits

### Performance Tips

1. **Use fewer URLs**: Start with 5 URLs for faster processing
2. **Leverage caching**: Style changes are instant after initial analysis
3. **Bookmark results**: Save jobId to access cached results within 1 hour
4. **Choose fast sources**: Some news sites respond faster than others

### Error Messages Reference

| Error Message | Meaning | Action |
|--------------|---------|--------|
| "Invalid URL format" | URL syntax incorrect | Check URL is complete with https:// |
| "Too many URLs (max 10)" | Exceeded limit | Remove some URLs |
| "API key required" | Missing OpenRouter key | Add key to request |
| "Failed to extract claims" | LLM processing error | Check API key and credits |
| "Job not found" | Invalid/expired jobId | Analysis expired or never existed |
| "Scraping failed for all URLs" | All fetches failed | Check URLs and network connectivity |

## Development Scripts

```bash
npm run dev      # Start local development server
npm run deploy   # Deploy to Cloudflare Workers
npm run tail     # View live logs from deployed worker
```

## Limitations & Constraints

- **English only**: MVP supports English language articles only
- **Static content**: Cannot scrape JavaScript-rendered content
- **Rate limits**: Subject to OpenRouter API rate limits
- **Paywalls**: Cannot access subscription-only content
- **Processing time**: Analysis takes 30-60 seconds for 10 URLs
- **Cache duration**: Results expire after 1 hour
- **URL limit**: Maximum 10 URLs per analysis to prevent timeouts

## Privacy & Data Handling

- Article content is **not stored permanently** (only cached for 1 hour)
- API keys are **encrypted** when stored as Cloudflare secrets
- No user accounts or personal data collection
- Results are accessible only via jobId (not indexed)
- Cached data automatically expires after 1 hour

## Support & Contributing

For issues, feature requests, or contributions:
1. Check existing troubleshooting section
2. Verify API key and KV namespace configuration
3. Check Cloudflare Workers logs: `npm run tail`
4. Review OpenRouter API status and quotas

## License

MIT License - Free to use and modify

---

**Created with ❤️ for better news consumption**