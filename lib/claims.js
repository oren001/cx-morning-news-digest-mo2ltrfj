import { callLLM, generateClaimPrompt } from './llm.js';

export async function extractClaims(articles, apiKey) {
  const allClaims = [];

  for (const article of articles) {
    if (article.error) continue;
    try {
      const prompt = generateClaimPrompt(article.content, article.title, article.url);
      const response = await callLLM(prompt, apiKey);
      const claims = parseClaimsFromResponse(response);
      claims.forEach(claim => {
        allClaims.push({ text: claim, source: article.url, sourceTitle: article.title });
      });
    } catch (error) {
      console.error(`Failed to extract claims from ${article.url}:`, error);
    }
  }

  return allClaims;
}

function parseClaimsFromResponse(response) {
  const lines = response.split('\n').filter(line => line.trim());
  const claims = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('-') || trimmed.startsWith('•') || trimmed.startsWith('*')) {
      claims.push(trimmed.substring(1).trim());
    } else if (trimmed.match(/^\d+\./)) {
      claims.push(trimmed.replace(/^\d+\./, '').trim());
    } else if (trimmed.length > 20 && !trimmed.endsWith(':')) {
      claims.push(trimmed);
    }
  }
  return claims.filter(c => c.length > 0);
}

export function clusterClaims(claims) {
  if (claims.length === 0) return [];

  const clusters = [];
  const processed = new Set();

  for (let i = 0; i < claims.length; i++) {
    if (processed.has(i)) continue;
    const cluster = { claims: [claims[i]], indices: [i] };
    processed.add(i);
    for (let j = i + 1; j < claims.length; j++) {
      if (processed.has(j)) continue;
      if (areSimilarClaims(claims[i].text, claims[j].text)) {
        cluster.claims.push(claims[j]);
        cluster.indices.push(j);
        processed.add(j);
      }
    }
    clusters.push(cluster);
  }

  return clusters;
}

function areSimilarClaims(claim1, claim2) {
  const words1 = extractKeywords(claim1);
  const words2 = extractKeywords(claim2);
  if (words1.length === 0 || words2.length === 0) return false;
  const intersection = words1.filter(w => words2.includes(w));
  const union = [...new Set([...words1, ...words2])];
  if (intersection.length / union.length > 0.4) return true;
  return intersection.filter(w => w.length > 5).length >= 2;
}

function extractKeywords(text) {
  const stopWords = new Set([
    'the','a','an','and','or','but','in','on','at','to','for','of','with','by',
    'from','as','is','was','are','were','been','be','have','has','had','do',
    'does','did','will','would','could','should','may','might','must','can',
    'this','that','these','those','i','you','he','she','it','we','they',
    'their','there','said','says','also','more','who','which','when','where',
    'why','how','all','each','every','some','any'
  ]);
  return text.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));
}

// Returns { claim, agreementCount, sources: [{url, title}] }
export function scoreConsensus(clusters) {
  const scored = clusters.map(cluster => {
    const seen = new Set();
    const sources = [];
    for (const c of cluster.claims) {
      if (!seen.has(c.source)) {
        seen.add(c.source);
        sources.push({ url: c.source, title: c.sourceTitle });
      }
    }
    return {
      claim: cluster.claims[0].text,
      agreementCount: sources.length,
      sources,
    };
  });
  scored.sort((a, b) => b.agreementCount - a.agreementCount);
  return scored;
}

// Returns { topic, conflictingClaims: [{claim, source}] }
export function detectControversy(clusters) {
  const controversies = [];
  for (const cluster of clusters) {
    if (cluster.claims.length < 2) continue;
    const claimTexts = cluster.claims.map(c => c.text);
    if (checkForContradiction(claimTexts)) {
      controversies.push({
        topic: summarizeTopic(claimTexts),
        conflictingClaims: cluster.claims.map(c => ({
          claim: c.text,
          source: c.sourceTitle || c.source,
        })),
      });
    }
  }
  return controversies;
}

function checkForContradiction(claimTexts) {
  const pairs = [
    ['increase','decrease'],['rise','fall'],['up','down'],['higher','lower'],
    ['more','less'],['gain','loss'],['positive','negative'],['approve','reject'],
    ['support','oppose'],['agree','disagree'],['confirm','deny'],['yes','no'],
  ];
  for (let i = 0; i < claimTexts.length; i++) {
    for (let j = i + 1; j < claimTexts.length; j++) {
      const t1 = claimTexts[i].toLowerCase();
      const t2 = claimTexts[j].toLowerCase();
      for (const [w1, w2] of pairs) {
        if ((t1.includes(w1) && t2.includes(w2)) || (t1.includes(w2) && t2.includes(w1))) return true;
      }
      const n1 = extractNumbers(t1);
      const n2 = extractNumbers(t2);
      if (n1.length > 0 && n2.length > 0) {
        for (const a of n1) for (const b of n2) {
          if (Math.max(a, b) > 0 && Math.abs(a - b) / Math.max(a, b) > 0.2) return true;
        }
      }
    }
  }
  return false;
}

function extractNumbers(text) {
  const m = text.match(/\d+\.?\d*/g);
  return m ? m.map(Number) : [];
}

function summarizeTopic(claimTexts) {
  const freq = {};
  extractKeywords(claimTexts.join(' ')).forEach(w => { freq[w] = (freq[w] || 0) + 1; });
  return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([w]) => w).join(' ');
}
