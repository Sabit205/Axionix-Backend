const axios = require('axios');
const { chromium } = require('playwright');

/**
 * Fetch HTML content from a URL via Hybrid Strategy
 * 1. Try simple Axios fetch (Static HTML). If response looks good and has body, use it.
 * 2. If it is tiny or seems like a JS SPA framework boundary (<div id="root"> or "javascript"), 
 *    use Playwright to render it fully.
 */
async function fetchContent(url) {
  try {
    // Stage 1: Fast Static HTML Fetch
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'AxionixBot/1.0 (+http://axionix.example.com/bot)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'
      },
      timeout: 5000,
      maxRedirects: 3
    });

    const html = response.data;
    
    // Simple heuristic. If the content length is incredibly short or it smells like an SPA
    const smellsLikeSPA = /<div id=["'](root|app)["']>\s*<\/div>/i.test(html) || html.length < 500;
    
    if (!smellsLikeSPA) {
      return { html, status: response.status, method: 'static' };
    }

    console.log(`[Spider] ${url} smells like SPA. Falling back to Playwright...`);
  } catch (err) {
    if (err.response) {
      // 4xx or 5xx
      return { html: null, status: err.response.status, method: 'error' };
    }
  }

  // Stage 2: Heavy Playwright Fetch
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    
    // Block unnecessary resources for speed
    await page.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (['image', 'media', 'font', 'stylesheet'].includes(type)) {
        route.abort();
      } else {
        route.continue();
      }
    });

    const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
    const html = await page.content();
    
    await browser.close();
    
    return { html, status: response ? response.status() : 200, method: 'dynamic' };
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    return { html: null, status: 500, method: 'error' };
  }
}

module.exports = { fetchContent };
