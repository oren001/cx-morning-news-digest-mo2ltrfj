const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const API_TIMEOUT_MS = 30000;
const MODEL = 'anthropic/claude-3.5-sonnet';

export async function callLLM(prompt, apiKey) {
  if (!apiKey) throw new Error('OpenRouter API key is required');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://personal-morning-digest.workers.dev',
        'X-Title': 'Personal Morning Digest',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 4000,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`OpenRouter API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    if (!data.choices?.[0]?.message) throw new Error('Invalid response format from OpenRouter API');
    return data.choices[0].message.content;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') throw new Error(`OpenRouter API timed out after ${API_TIMEOUT_MS}ms`);
    throw error;
  }
}

export function generateClaimPrompt(articleText, articleTitle, articleUrl) {
  return `Extract all specific factual claims from this news article as a bullet list. One claim per line, starting with "- ".

Article: ${articleTitle || 'Untitled'}
URL: ${articleUrl || ''}

Text:
${articleText}

Rules:
- Only factual statements, not opinions or speculation
- Each claim is a single atomic fact
- Include events, statistics, quotes, actions, decisions
- Return ONLY the bullet list, no other text`;
}

export function generateRestylePrompt(results, style) {
  const styleInstructions = {
    factual: 'Dry, factual, wire-service style. Precise language, no adjectives, focus on data and events.',
    optimistic: 'Optimistic, hopeful tone. Emphasize progress and constructive developments while staying truthful.',
    'kid-friendly': 'For a smart 10-year-old. Simple words, short sentences, relatable examples. Educational and engaging.',
    analytical: 'Deep analytical report. Explore implications, connections, and what this means for stakeholders.',
  };

  const instruction = styleInstructions[style] || styleInstructions.factual;

  let summaryText = `# NEWS ANALYSIS\n\n## High Consensus (${results.consensus.length} claims)\n`;
  results.consensus.forEach((item, i) => {
    const sourceNames = item.sources.map(s => s.title || s.url).join(', ');
    summaryText += `\n${i + 1}. ${item.claim}\n   Sources (${item.agreementCount}): ${sourceNames}\n`;
  });

  if (results.controversy.length > 0) {
    summaryText += `\n## Controversies (${results.controversy.length} topics)\n`;
    results.controversy.forEach((item, i) => {
      summaryText += `\n${i + 1}. Topic: ${item.topic}\n`;
      item.conflictingClaims.forEach((c, j) => {
        summaryText += `   Version ${j + 1}: ${c.claim} (${c.source})\n`;
      });
    });
  }

  if (results.omissions.length > 0) {
    summaryText += `\n## Notable Omissions\n`;
    results.omissions.forEach((item, i) => {
      summaryText += `\n${i + 1}. Source "${item.source}" did not mention: ${item.omittedClaims.slice(0, 3).join('; ')}\n`;
    });
  }

  return `You are a news editor creating a personalized morning digest.

Style: ${instruction}

Rewrite the structured analysis below into a cohesive, readable summary in the requested style. Maintain all factual accuracy.

${summaryText}

Guidelines:
- Create a flowing narrative, not just a list
- Keep all source attributions
- Apply the requested tone consistently
- Include consensus, controversies, and omissions
- Add a brief intro and conclusion

Write the complete summary now:`;
}
