import * as cheerio from 'cheerio';

const FETCH_TIMEOUT_MS = 10000;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const MAX_CONTENT_LENGTH = 10000;

export async function fetchArticle(url) {
  try {
    try { new URL(url); } catch (_) {
      return { title: null, content: null, error: 'Invalid URL format' };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let response;
    try {
      response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control': 'no-cache',
        },
        redirect: 'follow',
      });
    } catch (fetchError) {
      clearTimeout(timeoutId);
      if (fetchError.name === 'AbortError') {
        return { title: null, content: null, error: `Timeout after ${FETCH_TIMEOUT_MS / 1000}s` };
      }
      return { title: null, content: null, error: `Network error: ${fetchError.message}` };
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      return { title: null, content: null, error: `HTTP ${response.status}` };
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Extract title
    let title = null;
    for (const sel of ['meta[property="og:title"]','meta[name="twitter:title"]','article h1','h1','title']) {
      const el = $(sel).first();
      if (el.length) {
        title = sel.startsWith('meta') ? el.attr('content') : el.text().trim();
        if (title) break;
      }
    }

    // Remove noise
    $('script,style,nav,header,footer,aside,iframe,noscript,.advertisement,.ad,.social-share,.comments').remove();

    // Extract content
    let content = null;
    for (const sel of ['article','[itemprop="articleBody"]','.article-content','.article-body','.post-content','.entry-content','.story-body','main','#content']) {
      const el = $(sel).first();
      if (el.length) {
        const paras = el.find('p').map((_, e) => $(e).text().trim()).get().filter(t => t.length > 20);
        content = paras.join('\n\n');
        if (content.length > 100) break;
      }
    }

    if (!content || content.length < 100) {
      const paras = $('p').map((_, e) => $(e).text().trim()).get().filter(t => t.length > 20);
      content = paras.join('\n\n');
    }

    if (!content || content.length < 100) {
      return { title, content: null, error: 'Could not extract article content — may be paywalled or use dynamic loading.' };
    }

    if (content.length > MAX_CONTENT_LENGTH) {
      content = content.substring(0, MAX_CONTENT_LENGTH) + '... [truncated]';
    }

    return { title: title || 'Untitled Article', content, error: null };
  } catch (error) {
    return { title: null, content: null, error: `Parsing error: ${error.message}` };
  }
}
