const cheerio = require('cheerio');
const crypto = require('crypto');

function parseHtml(htmlStr, url) {
  const $ = cheerio.load(htmlStr);

  // Remove unwanted elements
  $('script, style, noscript, nav, footer, header, svg, img, iframe').remove();

  const title = $('title').text().trim() || $('h1').first().text().trim();
  const description = $('meta[name="description"]').attr('content') || '';
  
  // Extract text and clean up whitespace
  const rawText = $('body').text();
  const content = rawText.replace(/\s+/g, ' ').trim();

  // Extract internal links
  const links = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (href && !href.startsWith('javascript:') && !href.startsWith('mailto:')) {
      try {
        const absoluteUrl = new URL(href, url).href;
        links.push(absoluteUrl);
      } catch (e) {
        // ignore invalid urls
      }
    }
  });

  // Extract simple keywords (from meta tags, optionally could count frequency)
  const metaKeywords = $('meta[name="keywords"]').attr('content') || '';
  const keywords = metaKeywords.split(',').map(k => k.trim()).filter(Boolean);

  // Hash content + URL for duplicate detection
  const hash = crypto.createHash('sha256').update(content + url).digest('hex');

  return {
    title,
    description,
    content,
    links: [...new Set(links)], // unique links
    keywords,
    hash
  };
}

module.exports = { parseHtml };
