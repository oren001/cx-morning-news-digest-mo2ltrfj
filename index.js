```javascript
import { fetchArticle } from './lib/scraper.js';
import { extractClaims, clusterClaims, scoreConsensus, detectControversy } from './lib/claims.js';
import { callLLM, generateRestylePrompt } from './lib/llm.js';
import { saveResults, getResults, generateJobId } from './lib/cache.js';

const MAX_URLS = 10;
const CACHE_TTL_SECONDS = 3600;
const STYLES = ['factual', 'optimistic', 'kid-friendly', 'analytical'];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    if (request.method === 'GET' && url.pathname === '/') {
      return new Response(getHTML(), {
        headers: { 'Content-Type': 'text/html' }
      });
    }
    
    if (request.method === 'POST' && url.pathname === '/api/analyze') {
      return handleAnalyze(request, env);
    }
    
    if (request.method === 'POST' && url.pathname === '/api/restyle') {
      return handleRestyle(request, env);
    }
    
    if (request.method === 'GET' && url.pathname.startsWith('/api/status/')) {
      const jobId = url.pathname.split('/').pop();
      return handleStatus(jobId, env);
    }
    
    return new Response('Not Found', { status: 404 });
  }
};

async function handleAnalyze(request, env) {
  try {
    const { urls, apiKey } = await request.json();
    
    if (!apiKey || !apiKey.trim()) {
      return jsonResponse({ error: 'OpenRouter API key is required' }, 400);
    }
    
    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return jsonResponse({ error: 'URLs array is required' }, 400);
    }
    
    if (urls.length > MAX_URLS) {
      return jsonResponse({ error: `Maximum ${MAX_URLS} URLs allowed` }, 400);
    }
    
    const jobId = generateJobId();
    
    const articles = await Promise.all(
      urls.map(async (url) => {
        const result = await fetchArticle(url);
        return { url, ...result };
      })
    );
    
    const successfulArticles = articles.filter(a => !a.error);
    const failedArticles = articles.filter(a => a.error);
    
    if (successfulArticles.length === 0) {
      return jsonResponse({ error: 'Failed to scrape any articles successfully' }, 400);
    }
    
    const claims = await extractClaims(successfulArticles, apiKey);
    const clusters = clusterClaims(claims);
    const consensus = scoreConsensus(clusters, successfulArticles.length);
    const controversy = detectControversy(clusters, successfulArticles.length);
    
    const omittedBySource = {};
    successfulArticles.forEach(article => {
      omittedBySource[article.url] = [];
    });
    
    consensus.forEach(cluster => {
      const mentionedSources = new Set(cluster.sources.map(s => s.url));
      successfulArticles.forEach(article => {
        if (!mentionedSources.has(article.url)) {
          omittedBySource[article.url].push(cluster.claim);
        }
      });
    });
    
    const omissions = Object.entries(omittedBySource)
      .filter(([_, claims]) => claims.length > 0)
      .map(([url, claims]) => ({
        source: successfulArticles.find(a => a.url === url)?.title || url,
        url,
        omittedClaims: claims
      }));
    
    const results = {
      jobId,
      timestamp: new Date().toISOString(),
      totalUrls: urls.length,
      successfulUrls: successfulArticles.length,
      failedUrls: failedArticles.length,
      failedSources: failedArticles.map(a => ({ url: a.url, error: a.error })),
      consensus,
      controversy,
      omissions,
      sources: successfulArticles.map(a => ({ url: a.url, title: a.title }))
    };
    
    await saveResults(jobId, results, env.CACHE);
    
    return jsonResponse({ jobId, results });
  } catch (error) {
    console.error('Analyze error:', error);
    return jsonResponse({ error: error.message || 'Analysis failed' }, 500);
  }
}

async function handleRestyle(request, env) {
  try {
    const { jobId, style, apiKey } = await request.json();
    
    if (!apiKey || !apiKey.trim()) {
      return jsonResponse({ error: 'OpenRouter API key is required' }, 400);
    }
    
    if (!jobId) {
      return jsonResponse({ error: 'Job ID is required' }, 400);
    }
    
    if (!style || !STYLES.includes(style)) {
      return jsonResponse({ error: `Style must be one of: ${STYLES.join(', ')}` }, 400);
    }
    
    const results = await getResults(jobId, env.CACHE);
    if (!results) {
      return jsonResponse({ error: 'Job not found or expired' }, 404);
    }
    
    const prompt = generateRestylePrompt(results, style);
    const summary = await callLLM(prompt, apiKey);
    
    return jsonResponse({ summary, style });
  } catch (error) {
    console.error('Restyle error:', error);
    return jsonResponse({ error: error.message || 'Restyle failed' }, 500);
  }
}

async function handleStatus(jobId, env) {
  try {
    const results = await getResults(jobId, env.CACHE);
    if (!results) {
      return jsonResponse({ status: 'not_found' }, 404);
    }
    return jsonResponse({ status: 'completed', results });
  } catch (error) {
    console.error('Status error:', error);
    return jsonResponse({ error: error.message || 'Status check failed' }, 500);
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function getHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Personal Morning Digest</title>
  <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: #ffffff;
      color: #1a1a1a;
      line-height: 1.6;
    }
    
    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
    }
    
    .header {
      text-align: center;
      margin-bottom: 40px;
      padding: 40px 20px;
      border-bottom: 2px solid #e0e0e0;
    }
    
    .header h1 {
      font-family: Georgia, "Times New Roman", serif;
      font-size: 2.5rem;
      font-weight: 700;
      margin-bottom: 10px;
      color: #1a1a1a;
    }
    
    .header p {
      font-size: 1.1rem;
      color: #666;
    }
    
    .input-section {
      background: #f9f9f9;
      padding: 30px;
      border-radius: 8px;
      margin-bottom: 30px;
      border: 1px solid #e0e0e0;
    }
    
    .input-section h2 {
      font-family: Georgia, "Times New Roman", serif;
      font-size: 1.5rem;
      margin-bottom: 15px;
    }
    
    #api-key-notice {
      background: #fff3cd;
      border: 1px solid #ffc107;
      padding: 15px;
      border-radius: 6px;
      margin-bottom: 20px;
      font-size: 0.9rem;
      color: #856404;
    }
    
    #api-key-notice strong {
      display: block;
      margin-bottom: 5px;
    }
    
    #url-textarea {
      width: 100%;
      min-height: 200px;
      padding: 15px;
      font-family: monospace;
      font-size: 0.95rem;
      border: 2px solid #ddd;
      border-radius: 6px;
      resize: vertical;
      margin-bottom: 15px;
    }
    
    #url-textarea:focus {
      outline: none;
      border-color: #4CAF50;
    }
    
    .url-list {
      font-size: 0.9rem;
      color: #666;
      margin-bottom: 15px;
    }
    
    input[type="text"] {
      width: 100%;
      padding: 12px;
      font-size: 1rem;
      border: 2px solid #ddd;
      border-radius: 6px;
      margin-bottom: 15px;
    }
    
    input[type="text"]:focus {
      outline: none;
      border-color: #4CAF50;
    }
    
    .btn-primary, .btn-secondary {
      padding: 12px 30px;
      font-size: 1rem;
      font-weight: 600;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.2s;
    }
    
    .btn-primary {
      background: #4CAF50;
      color: white;
    }
    
    .btn-primary:hover {
      background: #45a049;
    }
    
    .btn-primary:disabled {
      background: #ccc;
      cursor: not-allowed;
    }
    
    .btn-secondary {
      background: #2196F3;
      color: white;
      margin-left: 10px;
    }
    
    .btn-secondary:hover {
      background: #0b7dda;
    }
    
    .loading-spinner {
      display: inline-block;
      width: 20px;
      height: 20px;
      border: 3px solid #f3f3f3;
      border-top: 3px solid #4CAF50;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      vertical-align: middle;
      margin-right: 10px;
    }
    
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    
    #loading-indicator {
      text-align: center;
      padding: 40px;
      font-size: 1.1rem;
      color: #666;
    }
    
    .error-message {
      background: #ffebee;
      color: #c62828;
      padding: 15px 20px;
      border-radius: 6px;
      border-left: 4px solid #c62828;
      margin-bottom: 20px;
    }
    
    #results-container {
      margin-top: 40px;
    }
    
    .timestamp {
      text-align: center;
      color: #999;
      font-size: 0.9rem;
      margin-bottom: 20px;
    }
    
    #style-selector {
      display: flex;
      justify-content: center;
      gap: 10px;
      margin-bottom: 30px;
      flex-wrap: wrap;
    }
    
    .style-pill {
      padding: 10px 20px;
      border: 2px solid #ddd;
      background: white;
      border-radius: 20px;
      cursor: pointer;
      font-size: 0.95rem;
      font-weight: 500;
      transition: all 0.2s;
    }
    
    .style-pill:hover {
      border-color: #4CAF50;
      background: #f0f9f0;
    }
    
    .style-pill-active {
      background: #4CAF50;
      color: white;
      border-color: #4CAF50;
    }
    
    .results-grid {
      display: grid;
      gap: 30px;
      margin-bottom: 30px;
    }
    
    .section-card {
      background: white;
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      padding: 25px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.05);
    }
    
    .section-card h2 {
      font-family: Georgia, "Times New Roman", serif;
      font-size: 1.5rem;
      margin-bottom: 20px;
      padding-bottom: 10px;
      border-bottom: 2px solid #e0e0e0;
    }
    
    .claim-item {
      margin-bottom: 20px;
      padding-bottom: 20px;
      border-bottom: 1px solid #f0f0f0;
    }
    
    .claim-item:last-child {
      border-bottom: none;
      margin-bottom: 0;
      padding-bottom: 0;
    }
    
    .claim-item p {
      margin-bottom: 10px;
      font-size: 1.05rem;
      line-height: 1.7;
    }
    
    .consensus-badge, .controversy-badge, .omission-badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 0.85rem;
      font-weight: 600;
      margin-right: 10px;
    }
    
    .consensus-badge {
      background: #e8f5e9;
      color: #2e7d32;
    }
    
    .controversy-badge {
      background: #fff3e0;
      color: #ef6c00;
    }
    
    .omission-badge {
      background: #f5f5f5;
      color: #757575;
    }
    
    .source-attribution {
      font-size: 0.9rem;
      color: #666;
      margin-top: 8px;
    }
    
    .source-attribution strong {
      color: #333;
    }
    
    .summary-text {
      background: #f9f9f9;
      padding: 25px;
      border-radius: 8px;
      border-left: 4px solid #4CAF50;
      margin-bottom: 20px;
      font-size: 1.05rem;
      line-height: 1.8;
      white-space: pre-wrap;
    }
    
    .copy-btn {
      display: block;
      margin: 20px auto;
      padding: 12px 30px;
      background: #2196F3;
      color: white;
      border: none;
      border-radius: 6px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }
    
    .copy-btn:hover {
      background: #0b7dda;
    }
    
    @media (max-width: 768px) {
      .container {
        padding: 10px;
      }
      
      .header h1 {
        font-size: 2rem;
      }
      
      .input-section {
        padding: 20px;
      }
      
      #style-selector {
        flex-direction: column;
      }
      
      .style-pill {
        width: 100%;
        text-align: center;
      }
    }
  </style>
</head>
<body>
  <div id="root"></div>
  
  <script type="text/babel">
    const { useState } = React;
    
    const MAX_URLS = 10;
    const STYLES = ['factual', 'optimistic', 'kid-friendly', 'analytical'];
    
    function App() {
      const [urls, setUrls] = useState('');
      const [apiKey, setApiKey] = useState('');
      const [loading, setLoading] = useState(false);
      const [error, setError] = useState('');
      const [results, setResults] = useState(null);
      const [jobId, setJobId] = useState('');
      const [selectedStyle, setSelectedStyle] = useState('factual');
      const [summary, setSummary] = useState('');
      
      const handleAnalyze = async () => {
        setError('');
        setResults(null);
        setSummary('');
        
        if (!apiKey.trim()) {
          setError('Please enter your OpenRouter API key');
          return;
        }
        
        const urlList = urls.split('\\n')
          .map(u => u.trim())
          .filter(u => u.length > 0);
        
        if (urlList.length === 0) {
          setError('Please enter at least one URL');
          return;
        }
        
        if (urlList.length > MAX_URLS) {
          setError(\`Maximum \${MAX_URLS} URLs allowed\`);
          return;
        }
        
        setLoading(true);
        
        try {
          const response = await fetch('/api/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ urls: urlList, apiKey })
          });
          
          const data = await response.json();
          
          if (!response.ok) {
            throw new Error(data.error || 'Analysis failed');
          }
          
          setResults(data.results);
          setJobId(data.jobId);
        } catch (err) {
          setError(err.message);
        } finally {
          setLoading(false);
        }
      };
      
      const handleStyleChange = async (style) => {
        if (!jobId || !results) return;
        
        setSelectedStyle(style);
        setLoading(true);
        setError('');
        
        try {
          const response = await fetch('/api/restyle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jobId, style, apiKey })
          });
          
          const data = await response.json();
          
          if (!response.ok) {
            throw new Error(data.error || 'Restyle failed');
          }
          
          setSummary(data.summary);
        } catch (err) {
          setError(err.message);
        } finally {
          setLoading(false);
        }
      };
      
      const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text).then(() => {
          alert('Summary copied to clipboard!');
        }).catch(() => {
          alert('Failed to copy to clipboard');
        });
      };
      
      return (
        <div className="container">
          <div className="header">
            <h1>Personal Morning Digest</h1>
            <p>Analyze news articles to find consensus, controversy, and omissions</p>
          </div>
          
          <div className="input-section">
            <h2>Enter News URLs</h2>
            
            <div id="api-key-notice">
              <strong>OpenRouter API Key Required</strong>
              Get your API key from <a href="https://openrouter.ai/keys" target="_blank">openrouter.ai/keys</a>
            </div>
            
            <input
              type="text"
              placeholder="Enter your OpenRouter API key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            
            <textarea
              id="url-textarea"
              placeholder={\`Paste news article URLs here (one per line, max \${MAX_URLS})\\n\\nhttps://example.com/article1\\nhttps://example.com/article2\\n...\`}
              value={urls}
              onChange={(e) => setUrls(e.target.value)}
            />
            
            <div className="url-list">
              {urls.split('\\n').filter(u => u.trim()).length} URLs entered
            </div>
            
            <button
              id="analyze-btn"
              className="btn-primary"
              onClick={handleAnalyze}
              disabled={loading}
            >
              {loading ? <><span className="loading-spinner"></span>Analyzing...</> : 'Analyze Articles'}
            </button>
          </div>
          
          {error && (
            <div id="error-container">
              <div className="error-message">{error}</div>
            </div>
          )}
          
          {loading && !results && (
            <div id="loading-indicator">
              <div className="loading-spinner"></div>
              <p>Scraping and analyzing articles... This may take a minute.</p>
            </div>
          )}
          
          {results && (
            <div id="results-container">
              <div id="timestamp-display" className="timestamp">
                Analysis completed at {new Date(results.timestamp).toLocaleString()}
                <br />
                Successfully analyzed {results.successfulUrls} of {results.totalUrls} URLs
              </div>
              
              {results.failedUrls > 0 && (
                <div className="error-message">
                  <strong>Failed to scrape {results.failedUrls} URL(s):</strong>
                  <ul style={{marginTop: '10px', marginLeft: '20px'}}>
                    {results.failedSources.map((fail, idx) => (
                      <li key={idx}>{fail.url}: {fail.error}</li>
                    ))}
                  </ul>
                </div>
              )}
              
              <div id="style-selector">
                {STYLES.map(style => (
                  <button
                    key={style}
                    className={\`style-pill \${selectedStyle === style ? 'style-pill-active' : ''}\`}
                    onClick={() => handleStyleChange(style)}
                  >
                    {style.charAt(0).toUpperCase() + style.slice(1).replace('-', ' ')}
                  </button>
                ))}
              </div>
              
              {summary && (
                <>
                  <div className="summary-text">{summary}</div>
                  <button
                    id="copy-summary-btn"
                    className="copy-btn"
                    onClick={() => copyToClipboard(summary)}
                  >
                    Copy Summary to Clipboard
                  </button>
                </>
              )}
              
              <div className="results-grid">
                <div id="consensus-section" className="section-card">
                  <h2>High Consensus</h2>
                  {results.consensus.length === 0 ? (
                    <p style={{color: '#999'}}>No claims with high consensus found</p>
                  ) : (
                    results.consensus.map((item, idx) => (
                      <div key={idx} className="claim-item">
                        <p>
                          <span className="consensus-badge">
                            {item.agreementCount}/{results.successfulUrls} sources
                          </span>
                          {item.claim}
                        </p>
                        <div className="source-attribution">
                          <strong>Mentioned by:</strong> {item.sources.map(s => s.title).join(', ')}
                        </div>
                      </div>
                    ))
                  )}
                </div>
                
                <div id="controversy-section" className="section-card">
                  <h2>Controversy & Disagreement</h2>
                  {results.controversy.length === 0 ? (
                    <p style={{color: '#999'}}>No controversial claims detected</p>
                  ) : (
                    results.controversy.map((item, idx) => (
                      <div key={idx} className="claim-item">
                        <p>
                          <span className="controversy-badge">Conflicting</span>
                          <strong>Topic:</strong> {item.topic}
                        </p>
                        <div style={{marginTop: '10px'}}>
                          {item.conflictingClaims.map((claim, cIdx) => (
                            <div key={cIdx} style={{marginBottom: '10px', paddingLeft: '15px', borderLeft: '3px solid #ff9800'}}>
                              <p>{claim.claim}</p>
                              <div className="source-attribution">
                                <strong>Source:</strong> {claim.source}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </div>
                
                <div id="omissions-section" className="section-card">
                  <h2>Notable Omissions</h2>
                  {results.omissions.length === 0 ? (
                    <p style={{color: '#999'}}>No significant omissions detected</p>
                  ) : (
                    results.omissions.map((item, idx) => (
                      <div key={idx} className="claim-item">
                        <p>
                          <span className="omission-badge">Omitted</span>
                          <strong>{item.source}</strong>
                        </p>
                        <div className="source-attribution">
                          <strong>Did not mention:</strong>
                          <ul style={{marginTop: '5px', marginLeft: '20px'}}>
                            {item.omittedClaims.slice(0, 5).map((claim, cIdx) => (
                              <li key={cIdx}>{claim}</li>
                            ))}
                          </ul>
                          {item.omittedClaims.length > 5 && (
                            <span style={{fontStyle: 'italic'}}>...and {item.omittedClaims.length - 5} more</span>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      );
    }
    
    ReactDOM.render(<App />, document.getElementById('root'));
  </script>
</body>
</html>`;
}
```