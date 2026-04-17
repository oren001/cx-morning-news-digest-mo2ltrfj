```javascript
import * as cheerio from 'cheerio';

const FETCH_TIMEOUT_MS = 10000;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Fetch and parse article from URL
 * @param {string} url - Article URL to scrape
 * @returns {Promise<{title: string|null, content: string|null, error: string|null}>}
 */
export async function fetchArticle(url) {
  try {
    // Validate URL
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        return {
          title: null,
          content: null,
          error: 'Invalid URL protocol. Only HTTP/HTTPS supported.'
        };
      }
    } catch (e) {
      return {
        title: null,
        content: null,
        error: 'Invalid URL format'
      };
    }

    // Fetch with timeout
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
          'Accept-Encoding': 'gzip, deflate, br',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        },
        redirect: 'follow'
      });
    } catch (fetchError) {
      clearTimeout(timeoutId);
      if (fetchError.name === 'AbortError') {
        return {
          title: null,
          content: null,
          error: `Timeout: Site took longer than ${FETCH_TIMEOUT_MS / 1000}s to respond`
        };
      }
      return {
        title: null,
        content: null,
        error: `Network error: ${fetchError.message}`
      };
    } finally {
      clearTimeout(timeoutId);
    }

    // Check response status
    if (!response.ok) {
      if (response.status === 403) {
        return {
          title: null,
          content: null,
          error: 'Access denied (403). Site may be blocking scrapers or require authentication.'
        };
      }
      if (response.status === 404) {
        return {
          title: null,
          content: null,
          error: 'Article not found (404)'
        };
      }
      if (response.status === 429) {
        return {
          title: null,
          content: null,
          error: 'Rate limited (429). Too many requests to this site.'
        };
      }
      if (response.status >= 500) {
        return {
          title: null,
          content: null,
          error: `Server error (${response.status})`
        };
      }
      return {
        title: null,
        content: null,
        error: `HTTP error ${response.status}`
      };
    }

    // Get HTML content
    const html = await response.text();

    // Parse with Cheerio
    const $ = cheerio.load(html);

    // Extract title
    let title = null;
    
    // Try various title selectors in order of preference
    const titleSelectors = [
      'meta[property="og:title"]',
      'meta[name="twitter:title"]',
      'h1.article-title',
      'h1.headline',
      'h1[itemprop="headline"]',
      'article h1',
      'h1',
      'title'
    ];

    for (const selector of titleSelectors) {
      const element = $(selector).first();
      if (element.length) {
        if (selector.startsWith('meta')) {
          title = element.attr('content');
        } else {
          title = element.text().trim();
        }
        if (title) break;
      }
    }

    // Extract article content
    let content = null;

    // Remove unwanted elements
    $('script, style, nav, header, footer, aside, iframe, noscript, .advertisement, .ad, .social-share, .comments').remove();

    // Try various article content selectors
    const contentSelectors = [
      'article',
      '[itemprop="articleBody"]',
      '.article-content',
      '.article-body',
      '.post-content',
      '.entry-content',
      '.story-body',
      'main',
      '#content'
    ];

    let articleElement = null;
    for (const selector of contentSelectors) {
      const element = $(selector).first();
      if (element.length) {
        articleElement = element;
        break;
      }
    }

    if (articleElement) {
      // Extract text from paragraphs within article
      const paragraphs = articleElement.find('p').map((i, el) => {
        return $(el).text().trim();
      }).get().filter(text => text.length > 20); // Filter out short paragraphs

      content = paragraphs.join('\n\n');
    }

    // Fallback: get all paragraph text if no article element found
    if (!content || content.length < 100) {
      const allParagraphs = $('p').map((i, el) => {
        return $(el).text().trim();
      }).get().filter(text => text.length > 20);

      if (allParagraphs.length > 0) {
        content = allParagraphs.join('\n\n');
      }
    }

    // Check if we got meaningful content
    if (!content || content.length < 100) {
      return {
        title: title,
        content: null,
        error: 'Could not extract article content. Site may use dynamic loading or be paywalled.'
      };
    }

    // Check for common paywall indicators
    const paywallIndicators = [
      'subscribe to continue',
      'subscription required',
      'become a member',
      'premium content',
      'paywall',
      'this article is only available to subscribers'
    ];

    const contentLower = content.toLowerCase();
    for (const indicator of paywallIndicators) {
      if (contentLower.includes(indicator)) {
        return {
          title: title,
          content: content.substring(0, 500),
          error: 'Paywall detected. Only partial content extracted.'
        };
      }
    }

    // Limit content length to avoid token limits
    const MAX_CONTENT_LENGTH = 10000;
    if (content.length > MAX_CONTENT_LENGTH) {
      content = content.substring(0, MAX_CONTENT_LENGTH) + '... [truncated]';
    }

    return {
      title: title || 'Untitled Article',
      content: content,
      error: null
    };

  } catch (error) {
    return {
      title: null,
      content: null,
      error: `Parsing error: ${error.message}`
    };
  }
}
```