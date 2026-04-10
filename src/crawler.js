const { URL } = require('url');
const { fetchContent } = require('./spider');
const { parseHtml } = require('./parser');
const { storeDocument } = require('./pgStore');
const { getRobotsAndSitemaps, fetchSitemapUrls, isAllowed } = require('./robots');

// Simple set based rate limiting & duplicate state memory (ephemeral per job)
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

async function processCrawlJob(domain, startUrl) {
  const MAX_PAGES = parseInt(process.env.MAX_PAGES_PER_DOMAIN) || 100;
  const MAX_DEPTH = parseInt(process.env.MAX_DEPTH) || 3;
  const SCRAPE_DELAY_MS = parseInt(process.env.SCRAPE_DELAY_MS) || 1000;

  const { sitemaps, disallowedPaths } = await getRobotsAndSitemaps(domain);
  
  const queue = [{ url: startUrl || `https://${domain}`, depth: 0 }];
  const visited = new Set();
  let pagesCrawled = 0;

  console.log(`Starting crawl for domain ${domain}. Sitemaps: ${sitemaps.length}. Disallowed: ${disallowedPaths.length}`);

  // Fetch initial sitemap links to bootstrap
  if (sitemaps.length > 0) {
    for (const sm of sitemaps) {
       const smUrls = await fetchSitemapUrls(sm);
       for (const smu of smUrls) {
          queue.push({ url: smu, depth: 1 });
       }
    }
  }

  // Need a robust URL normalizing fn to avoid `https://example.com/` vs `https://example.com`
  const normalizeUrl = (u) => {
    try {
      const parsed = new URL(u);
      parsed.hash = ''; // ignore fragments
      return parsed.href;
    } catch {
      return null;
    }
  };

  while (queue.length > 0 && pagesCrawled < MAX_PAGES) {
    const { url: currentUrl, depth } = queue.shift();
    const normalizedUrl = normalizeUrl(currentUrl);

    if (!normalizedUrl || visited.has(normalizedUrl) || !isAllowed(normalizedUrl, disallowedPaths)) continue;
    visited.add(normalizedUrl);
    
    // Safety check: Never try to index an XML file or image directly as HTML
    if (normalizedUrl.toLowerCase().endsWith('.xml') || normalizedUrl.match(/\.(png|jpg|jpeg|gif|pdf|mp4)$/i)) {
       continue;
    }

    try {
      // 1. Fetch content (Hybrid JS/Static)
      console.log(`[${domain}] Fetching (${depth}/${MAX_DEPTH}): ${normalizedUrl}`);
      const { html, status } = await fetchContent(normalizedUrl);
      
      if (!html || status >= 400) continue;

      // 2. Parse Content
      const parsedData = parseHtml(html, normalizedUrl);
      if (!parsedData) continue; // Likely empty or unparseable

      // 3. Store in MeiliSearch
      await storeDocument({
        id: Buffer.from(normalizedUrl).toString('base64').replace(/[^a-zA-Z0-9]/g, ''), // safe ID
        url: normalizedUrl,
        domain,
        title: parsedData.title,
        description: parsedData.description,
        content: parsedData.content,
        keywords: parsedData.keywords,
        links: parsedData.links, // Used internally, not indexed
        timestamp: Date.now()
      });

      pagesCrawled++;

      // 4. Enqueue new links
      if (depth < MAX_DEPTH) {
        for (const link of parsedData.links) {
          const normLink = normalizeUrl(link);
          if (normLink && new URL(normLink).hostname === domain && !visited.has(normLink)) {
            queue.push({ url: normLink, depth: depth + 1 });
          }
        }
      }

    } catch (err) {
      console.error(`[${domain}] Error parsing/storing ${normalizedUrl}:`, err.message);
    }

    // Rate App Limit
    if (queue.length > 0) {
      await delay(SCRAPE_DELAY_MS);
    }
  }

  console.log(`Finished crawling ${domain}. Pages crawled: ${pagesCrawled}`);
}

module.exports = {
  processCrawlJob
};
