```javascript
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const API_TIMEOUT_MS = 30000;
const MODEL = 'anthropic/claude-3.5-sonnet';

export async function callLLM(prompt, apiKey) {
  if (!apiKey) {
    throw new Error('OpenRouter API key is required');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://personal-news-digest.workers.dev',
        'X-Title': 'Personal Morning Digest'
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 4000
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`OpenRouter API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      throw new Error('Invalid response format from OpenRouter API');
    }

    return data.choices[0].message.content;
  } catch (error) {
    clearTimeout(timeoutId);
    
    if (error.name === 'AbortError') {
      throw new Error(`OpenRouter API request timed out after ${API_TIMEOUT_MS}ms`);
    }
    
    throw error;
  }
}

export function generateClaimPrompt(articleText, articleTitle, articleUrl) {
  return `You are a fact extraction assistant. Extract all factual claims from the following news article.

Article Title: ${articleTitle}
Article URL: ${articleUrl}

Article Text:
${articleText}

Instructions:
- Extract specific, factual claims (not opinions or speculation)
- Each claim should be a single, atomic statement
- Include claims about events, statistics, quotes, actions, and decisions
- Format as a JSON array of objects with this structure:
  {
    "claim": "the specific factual statement",
    "category": "event|statistic|quote|action|decision|other",
    "entities": ["entity1", "entity2"],
    "keywords": ["keyword1", "keyword2", "keyword3"]
  }
- For keywords, include 3-5 key terms that capture the essence of the claim
- For entities, list people, organizations, or places mentioned
- Return ONLY the JSON array, no other text

Example output:
[
  {
    "claim": "The Federal Reserve raised interest rates by 0.25 percentage points",
    "category": "action",
    "entities": ["Federal Reserve"],
    "keywords": ["interest rates", "increase", "federal reserve", "monetary policy", "0.25"]
  },
  {
    "claim": "Inflation rate stood at 3.2% in October",
    "category": "statistic",
    "entities": [],
    "keywords": ["inflation", "3.2%", "october", "rate", "economy"]
  }
]

Now extract claims from the article above:`;
}

export function generateRestylePrompt(results, style) {
  const styleInstructions = {
    factual: 'Present the information in a dry, factual, journalistic style. Use precise language, avoid adjectives, and focus on data and events. Write like a wire service reporter.',
    optimistic: 'Present the information with an optimistic, hopeful tone. Emphasize positive aspects, progress, and constructive developments while remaining truthful. Use uplifting but not hyperbolic language.',
    'kid-friendly': 'Rewrite this for a smart 10-year-old. Use simple words, short sentences, and relatable examples. Explain complex concepts clearly. Make it engaging and educational without being condescending.',
    analytical: 'Present this as a deep analytical report. Explore implications, connections, and underlying patterns. Discuss what this means for different stakeholders. Use sophisticated vocabulary and examine multiple perspectives.'
  };

  const instruction = styleInstructions[style] || styleInstructions.factual;

  let summaryText = `# NEWS ANALYSIS SUMMARY

## High Consensus (${results.consensus.length} claims)
`;

  results.consensus.forEach((cluster, i) => {
    summaryText += `\n${i + 1}. ${cluster.representative}\n`;
    summaryText += `   Sources: ${cluster.sources.join(', ')}\n`;
    summaryText += `   Agreement: ${cluster.count}/${results.totalSources} sources\n`;
  });

  if (results.controversy.length > 0) {
    summaryText += `\n## Controversies & Disagreements (${results.controversy.length} topics)\n`;
    results.controversy.forEach((item, i) => {
      summaryText += `\n${i + 1}. Topic: ${item.topic}\n`;
      item.conflictingClaims.forEach((claim, j) => {
        summaryText += `   Version ${j + 1}: ${claim.claim} (${claim.source})\n`;
      });
    });
  }

  if (results.omissions.length > 0) {
    summaryText += `\n## Notable Omissions\n`;
    results.omissions.forEach((omission, i) => {
      summaryText += `\n${i + 1}. ${omission.claim}\n`;
      summaryText += `   Mentioned by: ${omission.mentionedBy.join(', ')}\n`;
      summaryText += `   Not mentioned by: ${omission.omittedBy.join(', ')}\n`;
    });
  }

  return `You are a news editor creating a personalized morning digest.

${instruction}

Below is a structured analysis of news claims from multiple sources. Rewrite this into a cohesive, readable summary in the requested style. Maintain all factual accuracy and source attributions.

${summaryText}

Guidelines:
- Create a flowing narrative, not just a list
- Keep all source attributions
- Maintain factual accuracy
- Apply the requested tone consistently
- Format with clear headings
- Include all consensus items, controversies, and notable omissions
- Add a brief introduction that sets the context
- End with a thoughtful conclusion

Write the complete summary now:`;
}

export function generateClusteringPrompt(claims) {
  return `You are analyzing news claims to identify which ones are about the same topic or event.

Claims to analyze:
${claims.map((c, i) => `${i + 1}. [${c.source}] ${c.claim}`).join('\n')}

Instructions:
- Group claims that refer to the same event, statistic, or fact
- Claims can be in different clusters if they're about different topics
- Return a JSON array where each element is an array of claim indices (1-based) that belong together
- Claims that don't match any others should be in their own group

Example output:
[[1, 3, 5], [2, 4], [6], [7, 8]]

This means claims 1,3,5 are about the same thing, 2,4 are about another thing, 6 stands alone, and 7,8 are about yet another thing.

Return ONLY the JSON array, no other text:`;
}
```