```javascript
import { callLLM, generateClaimPrompt } from './llm.js';

export async function extractClaims(articles, apiKey) {
  const allClaims = [];
  
  for (const article of articles) {
    if (article.error) {
      continue;
    }
    
    try {
      const prompt = generateClaimPrompt(article.content);
      const response = await callLLM(prompt, apiKey);
      
      const claims = parseClaimsFromResponse(response);
      
      claims.forEach(claim => {
        allClaims.push({
          text: claim,
          source: article.url,
          sourceTitle: article.title
        });
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
  if (claims.length === 0) {
    return [];
  }
  
  const clusters = [];
  const processed = new Set();
  
  for (let i = 0; i < claims.length; i++) {
    if (processed.has(i)) continue;
    
    const cluster = {
      claims: [claims[i]],
      indices: [i]
    };
    
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
  
  if (words1.length === 0 || words2.length === 0) {
    return false;
  }
  
  const intersection = words1.filter(w => words2.includes(w));
  const union = [...new Set([...words1, ...words2])];
  
  const jaccardSimilarity = intersection.length / union.length;
  
  if (jaccardSimilarity > 0.4) {
    return true;
  }
  
  const sharedImportantWords = intersection.filter(w => w.length > 5).length;
  if (sharedImportantWords >= 2) {
    return true;
  }
  
  return false;
}

function extractKeywords(text) {
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
    'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
    'could', 'should', 'may', 'might', 'must', 'can', 'this', 'that',
    'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they',
    'their', 'there', 'said', 'says', 'also', 'more', 'who', 'which',
    'when', 'where', 'why', 'how', 'all', 'each', 'every', 'some', 'any'
  ]);
  
  const words = text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));
  
  return words;
}

export function scoreConsensus(clusters) {
  const scored = clusters.map(cluster => {
    const sources = [...new Set(cluster.claims.map(c => c.source))];
    const sourceCount = sources.length;
    
    const representativeClaim = cluster.claims[0].text;
    
    return {
      claim: representativeClaim,
      sources: sources,
      sourceCount: sourceCount,
      sourceTitles: cluster.claims.map(c => ({ url: c.source, title: c.sourceTitle }))
    };
  });
  
  scored.sort((a, b) => b.sourceCount - a.sourceCount);
  
  return scored;
}

export function detectControversy(clusters, allArticles) {
  const controversies = [];
  
  for (const cluster of clusters) {
    if (cluster.claims.length < 2) continue;
    
    const claimTexts = cluster.claims.map(c => c.text);
    const hasVariation = checkForContradiction(claimTexts);
    
    if (hasVariation) {
      const sources = cluster.claims.map(c => ({
        url: c.source,
        title: c.sourceTitle,
        claim: c.text
      }));
      
      controversies.push({
        topic: summarizeTopic(claimTexts),
        variations: sources,
        sourceCount: sources.length
      });
    }
  }
  
  return controversies;
}

function checkForContradiction(claimTexts) {
  const contradictionWords = [
    ['increase', 'decrease'],
    ['rise', 'fall'],
    ['up', 'down'],
    ['higher', 'lower'],
    ['more', 'less'],
    ['gain', 'loss'],
    ['positive', 'negative'],
    ['approve', 'reject'],
    ['support', 'oppose'],
    ['agree', 'disagree'],
    ['confirm', 'deny'],
    ['yes', 'no']
  ];
  
  for (let i = 0; i < claimTexts.length; i++) {
    for (let j = i + 1; j < claimTexts.length; j++) {
      const text1 = claimTexts[i].toLowerCase();
      const text2 = claimTexts[j].toLowerCase();
      
      for (const [word1, word2] of contradictionWords) {
        if ((text1.includes(word1) && text2.includes(word2)) ||
            (text1.includes(word2) && text2.includes(word1))) {
          return true;
        }
      }
      
      const numbers1 = extractNumbers(text1);
      const numbers2 = extractNumbers(text2);
      
      if (numbers1.length > 0 && numbers2.length > 0) {
        for (const num1 of numbers1) {
          for (const num2 of numbers2) {
            if (Math.abs(num1 - num2) / Math.max(num1, num2) > 0.2) {
              return true;
            }
          }
        }
      }
    }
  }
  
  return false;
}

function extractNumbers(text) {
  const matches = text.match(/\d+\.?\d*/g);
  return matches ? matches.map(Number) : [];
}

function summarizeTopic(claimTexts) {
  const allWords = claimTexts.join(' ');
  const keywords = extractKeywords(allWords);
  
  const wordFreq = {};
  keywords.forEach(word => {
    wordFreq[word] = (wordFreq[word] || 0) + 1;
  });
  
  const topWords = Object.entries(wordFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([word]) => word);
  
  return topWords.join(' ');
}

export function identifyOmissions(scoredClaims, allArticles) {
  const omissions = [];
  const totalSources = allArticles.filter(a => !a.error).length;
  
  if (totalSources < 2) {
    return omissions;
  }
  
  for (const scored of scoredClaims) {
    if (scored.sourceCount >= totalSources * 0.6) {
      const mentioningSources = new Set(scored.sources);
      const omittingSources = allArticles
        .filter(a => !a.error && !mentioningSources.has(a.url))
        .map(a => ({ url: a.url, title: a.title }));
      
      if (omittingSources.length > 0 && omittingSources.length < totalSources * 0.5) {
        omissions.push({
          claim: scored.claim,
          mentionedBy: scored.sourceTitles,
          omittedBy: omittingSources,
          omissionCount: omittingSources.length
        });
      }
    }
  }
  
  return omissions;
}

export async function analyzeArticles(articles, apiKey) {
  const claims = await extractClaims(articles, apiKey);
  
  if (claims.length === 0) {
    return {
      consensus: [],
      controversy: [],
      omissions: [],
      timestamp: new Date().toISOString(),
      totalClaims: 0,
      totalSources: articles.filter(a => !a.error).length
    };
  }
  
  const clusters = clusterClaims(claims);
  const scoredClaims = scoreConsensus(clusters);
  const controversies = detectControversy(clusters, articles);
  const omissions = identifyOmissions(scoredClaims, articles);
  
  const highConsensus = scoredClaims.filter(c => c.sourceCount >= 2);
  
  return {
    consensus: highConsensus,
    controversy: controversies,
    omissions: omissions,
    timestamp: new Date().toISOString(),
    totalClaims: claims.length,
    totalSources: articles.filter(a => !a.error).length
  };
}
```