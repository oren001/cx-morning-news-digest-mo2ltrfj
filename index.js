import { fetchArticle } from './lib/scraper.js';
import { extractClaims, clusterClaims, scoreConsensus, detectControversy } from './lib/claims.js';
import { callLLM, generateRestylePrompt } from './lib/llm.js';
import { saveResults, getResults, generateJobId } from './lib/cache.js';

const MAX_URLS = 10;
const STYLES = ['factual', 'optimistic', 'kid-friendly', 'analytical'];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/') {
      return new Response(getHTML(), { headers: { 'Content-Type': 'text/html' } });
    }
    if (request.method === 'POST' && url.pathname === '/api/analyze') {
      return handleAnalyze(request, env);
    }
    if (request.method === 'POST' && url.pathname === '/api/restyle') {
      return handleRestyle(request, env);
    }
    if (request.method === 'GET' && url.pathname.startsWith('/api/status/')) {
      return handleStatus(url.pathname.split('/').pop(), env);
    }
    return new Response('Not Found', { status: 404 });
  }
};

async function handleAnalyze(request, env) {
  try {
    const { urls, apiKey } = await request.json();

    if (!apiKey?.trim()) return jsonResponse({ error: 'OpenRouter API key is required' }, 400);
    if (!Array.isArray(urls) || urls.length === 0) return jsonResponse({ error: 'URLs array is required' }, 400);
    if (urls.length > MAX_URLS) return jsonResponse({ error: `Maximum ${MAX_URLS} URLs allowed` }, 400);

    const jobId = generateJobId();
    const articles = await Promise.all(urls.map(async url => ({ url, ...await fetchArticle(url) })));
    const successfulArticles = articles.filter(a => !a.error);
    const failedArticles = articles.filter(a => a.error);

    if (successfulArticles.length === 0) {
      return jsonResponse({ error: 'Failed to scrape any articles successfully' }, 400);
    }

    const claims = await extractClaims(successfulArticles, apiKey);
    const clusters = clusterClaims(claims);
    const consensus = scoreConsensus(clusters);
    const controversy = detectControversy(clusters);

    // Build per-source omission list: which consensus claims did each source NOT mention
    const omittedBySource = {};
    successfulArticles.forEach(a => { omittedBySource[a.url] = []; });
    consensus.forEach(item => {
      const mentionedUrls = new Set(item.sources.map(s => s.url));
      successfulArticles.forEach(a => {
        if (!mentionedUrls.has(a.url)) omittedBySource[a.url].push(item.claim);
      });
    });
    const omissions = Object.entries(omittedBySource)
      .filter(([, claims]) => claims.length > 0)
      .map(([url, omittedClaims]) => ({
        source: successfulArticles.find(a => a.url === url)?.title || url,
        url,
        omittedClaims,
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
      sources: successfulArticles.map(a => ({ url: a.url, title: a.title })),
    };

    await saveResults(jobId, results, env.DIGEST_CACHE);
    return jsonResponse({ jobId, results });
  } catch (error) {
    console.error('Analyze error:', error);
    return jsonResponse({ error: error.message || 'Analysis failed' }, 500);
  }
}

async function handleRestyle(request, env) {
  try {
    const { jobId, style, apiKey } = await request.json();

    if (!apiKey?.trim()) return jsonResponse({ error: 'OpenRouter API key is required' }, 400);
    if (!jobId) return jsonResponse({ error: 'Job ID is required' }, 400);
    if (!STYLES.includes(style)) return jsonResponse({ error: `Style must be one of: ${STYLES.join(', ')}` }, 400);

    const results = await getResults(jobId, env.DIGEST_CACHE);
    if (!results) return jsonResponse({ error: 'Job not found or expired' }, 404);

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
    const results = await getResults(jobId, env.DIGEST_CACHE);
    if (!results) return jsonResponse({ status: 'not_found' }, 404);
    return jsonResponse({ status: 'completed', results });
  } catch (error) {
    return jsonResponse({ error: error.message || 'Status check failed' }, 500);
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
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
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #fff; color: #1a1a1a; line-height: 1.6; }
    .container { max-width: 1100px; margin: 0 auto; padding: 20px; }
    .header { text-align: center; margin-bottom: 40px; padding: 40px 20px; border-bottom: 2px solid #e0e0e0; }
    .header h1 { font-family: Georgia, serif; font-size: 2.5rem; font-weight: 700; margin-bottom: 10px; }
    .header p { font-size: 1.1rem; color: #666; }
    .input-section { background: #f9f9f9; padding: 30px; border-radius: 8px; margin-bottom: 30px; border: 1px solid #e0e0e0; }
    .input-section h2 { font-family: Georgia, serif; font-size: 1.5rem; margin-bottom: 15px; }
    .api-notice { background: #fff3cd; border: 1px solid #ffc107; padding: 12px 15px; border-radius: 6px; margin-bottom: 20px; font-size: 0.9rem; color: #856404; }
    textarea, input[type="text"] { width: 100%; padding: 12px; font-size: 1rem; border: 2px solid #ddd; border-radius: 6px; margin-bottom: 15px; }
    textarea { min-height: 180px; font-family: monospace; resize: vertical; }
    textarea:focus, input[type="text"]:focus { outline: none; border-color: #4CAF50; }
    .url-count { font-size: 0.9rem; color: #666; margin-bottom: 15px; }
    .btn-primary { padding: 12px 30px; font-size: 1rem; font-weight: 600; border: none; border-radius: 6px; cursor: pointer; background: #4CAF50; color: white; transition: background 0.2s; }
    .btn-primary:hover { background: #45a049; }
    .btn-primary:disabled { background: #ccc; cursor: not-allowed; }
    .spinner { display: inline-block; width: 18px; height: 18px; border: 3px solid #f3f3f3; border-top-color: #4CAF50; border-radius: 50%; animation: spin 1s linear infinite; vertical-align: middle; margin-right: 8px; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .error-msg { background: #ffebee; color: #c62828; padding: 12px 18px; border-radius: 6px; border-left: 4px solid #c62828; margin-bottom: 20px; }
    .loading-center { text-align: center; padding: 40px; color: #666; }
    #results-container { margin-top: 40px; }
    .timestamp { text-align: center; color: #999; font-size: 0.9rem; margin-bottom: 20px; }
    .style-selector { display: flex; justify-content: center; gap: 10px; margin-bottom: 30px; flex-wrap: wrap; }
    .style-pill { padding: 10px 20px; border: 2px solid #ddd; background: white; border-radius: 20px; cursor: pointer; font-size: 0.95rem; font-weight: 500; transition: all 0.2s; }
    .style-pill:hover { border-color: #4CAF50; background: #f0f9f0; }
    .style-pill-active { background: #4CAF50; color: white; border-color: #4CAF50; }
    .results-grid { display: grid; gap: 25px; margin-bottom: 30px; }
    .section-card { background: white; border: 1px solid #e0e0e0; border-radius: 8px; padding: 25px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }
    .section-card h2 { font-family: Georgia, serif; font-size: 1.4rem; margin-bottom: 18px; padding-bottom: 10px; border-bottom: 2px solid #e0e0e0; }
    .claim-item { margin-bottom: 18px; padding-bottom: 18px; border-bottom: 1px solid #f0f0f0; }
    .claim-item:last-child { border-bottom: none; margin-bottom: 0; padding-bottom: 0; }
    .claim-text { margin-bottom: 8px; font-size: 1.05rem; line-height: 1.7; }
    .badge { display: inline-block; padding: 3px 10px; border-radius: 10px; font-size: 0.82rem; font-weight: 600; margin-right: 8px; }
    .badge-consensus { background: #e8f5e9; color: #2e7d32; }
    .badge-controversy { background: #fff3e0; color: #ef6c00; }
    .badge-omission { background: #f5f5f5; color: #757575; }
    .source-line { font-size: 0.88rem; color: #666; margin-top: 6px; }
    .summary-box { background: #f9f9f9; padding: 25px; border-radius: 8px; border-left: 4px solid #4CAF50; margin-bottom: 20px; font-size: 1.05rem; line-height: 1.8; white-space: pre-wrap; }
    .copy-btn { display: block; margin: 15px auto; padding: 10px 28px; background: #2196F3; color: white; border: none; border-radius: 6px; font-size: 1rem; font-weight: 600; cursor: pointer; }
    .copy-btn:hover { background: #0b7dda; }
    .conflict-item { margin-bottom: 10px; padding-left: 14px; border-left: 3px solid #ff9800; }
    @media (max-width: 768px) {
      .header h1 { font-size: 2rem; }
      .style-selector { flex-direction: column; }
      .style-pill { text-align: center; }
    }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel">
    const { useState } = React;
    const MAX_URLS = 10;
    const STYLES = ['factual', 'optimistic', 'kid-friendly', 'analytical'];
    const STYLE_LABELS = { factual: 'Factual & Dry', optimistic: 'Optimistic', 'kid-friendly': 'Kid-Friendly', analytical: 'Deep Analytical' };

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
        setError(''); setResults(null); setSummary('');
        if (!apiKey.trim()) { setError('Please enter your OpenRouter API key'); return; }
        const urlList = urls.split('\\n').map(u => u.trim()).filter(Boolean);
        if (urlList.length === 0) { setError('Please enter at least one URL'); return; }
        if (urlList.length > MAX_URLS) { setError(\`Maximum \${MAX_URLS} URLs allowed\`); return; }
        setLoading(true);
        try {
          const response = await fetch('/api/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ urls: urlList, apiKey }),
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || 'Analysis failed');
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
        setSelectedStyle(style); setLoading(true); setError('');
        try {
          const response = await fetch('/api/restyle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jobId, style, apiKey }),
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || 'Restyle failed');
          setSummary(data.summary);
        } catch (err) {
          setError(err.message);
        } finally {
          setLoading(false);
        }
      };

      const copyToClipboard = (text) => navigator.clipboard.writeText(text).then(() => alert('Copied!')).catch(() => alert('Failed to copy'));

      return (
        <div className="container">
          <div className="header">
            <h1>Personal Morning Digest</h1>
            <p>Find consensus, controversy, and omissions across news sources</p>
          </div>

          <div className="input-section">
            <h2>Paste Article URLs</h2>
            <div className="api-notice">
              <strong>OpenRouter API Key required</strong> — get yours at <a href="https://openrouter.ai/keys" target="_blank">openrouter.ai/keys</a>
            </div>
            <input type="text" placeholder="sk-or-..." value={apiKey} onChange={e => setApiKey(e.target.value)} />
            <textarea
              placeholder={\`One URL per line (max \${MAX_URLS})\\n\\nhttps://example.com/article1\\nhttps://example.com/article2\`}
              value={urls}
              onChange={e => setUrls(e.target.value)}
            />
            <div className="url-count">{urls.split('\\n').filter(u => u.trim()).length} URLs</div>
            <button className="btn-primary" onClick={handleAnalyze} disabled={loading}>
              {loading ? <><span className="spinner"></span>Analyzing...</> : 'Analyze Articles'}
            </button>
          </div>

          {error && <div className="error-msg">{error}</div>}

          {loading && !results && (
            <div className="loading-center">
              <span className="spinner"></span>
              Scraping and analyzing — this may take 30–60 seconds.
            </div>
          )}

          {results && (
            <div id="results-container">
              <div className="timestamp">
                Analysis at {new Date(results.timestamp).toLocaleString()} &nbsp;·&nbsp;
                {results.successfulUrls}/{results.totalUrls} sources processed
              </div>

              {results.failedUrls > 0 && (
                <div className="error-msg">
                  <strong>Failed to scrape {results.failedUrls} URL(s):</strong>
                  <ul style={{marginTop:8,marginLeft:20}}>
                    {results.failedSources.map((f,i) => <li key={i}>{f.url}: {f.error}</li>)}
                  </ul>
                </div>
              )}

              <div className="style-selector">
                {STYLES.map(style => (
                  <button key={style}
                    className={\`style-pill \${selectedStyle === style ? 'style-pill-active' : ''}\`}
                    onClick={() => handleStyleChange(style)}>
                    {STYLE_LABELS[style]}
                  </button>
                ))}
              </div>

              {summary && (
                <>
                  <div className="summary-box">{summary}</div>
                  <button className="copy-btn" onClick={() => copyToClipboard(summary)}>Copy Summary</button>
                </>
              )}

              <div className="results-grid">
                <div className="section-card">
                  <h2>✅ High Consensus</h2>
                  {results.consensus.length === 0
                    ? <p style={{color:'#999'}}>No claims with high consensus found</p>
                    : results.consensus.map((item, i) => (
                      <div key={i} className="claim-item">
                        <div className="claim-text">
                          <span className="badge badge-consensus">{item.agreementCount}/{results.successfulUrls} sources</span>
                          {item.claim}
                        </div>
                        <div className="source-line">Mentioned by: {item.sources.map(s => s.title || s.url).join(', ')}</div>
                      </div>
                    ))
                  }
                </div>

                <div className="section-card">
                  <h2>⚠️ Controversy & Disagreement</h2>
                  {results.controversy.length === 0
                    ? <p style={{color:'#999'}}>No controversial claims detected</p>
                    : results.controversy.map((item, i) => (
                      <div key={i} className="claim-item">
                        <div className="claim-text">
                          <span className="badge badge-controversy">Conflicting</span>
                          <strong>Topic:</strong> {item.topic}
                        </div>
                        <div style={{marginTop:10}}>
                          {item.conflictingClaims.map((c, j) => (
                            <div key={j} className="conflict-item">
                              <div>{c.claim}</div>
                              <div className="source-line">Source: {c.source}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))
                  }
                </div>

                <div className="section-card">
                  <h2>○ Notable Omissions</h2>
                  {results.omissions.length === 0
                    ? <p style={{color:'#999'}}>No significant omissions detected</p>
                    : results.omissions.map((item, i) => (
                      <div key={i} className="claim-item">
                        <div className="claim-text">
                          <span className="badge badge-omission">Omitted by</span>
                          <strong>{item.source}</strong>
                        </div>
                        <div className="source-line">
                          Did not mention:
                          <ul style={{marginLeft:20,marginTop:4}}>
                            {item.omittedClaims.slice(0,5).map((c,j) => <li key={j}>{c}</li>)}
                          </ul>
                          {item.omittedClaims.length > 5 && <em>...and {item.omittedClaims.length - 5} more</em>}
                        </div>
                      </div>
                    ))
                  }
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
