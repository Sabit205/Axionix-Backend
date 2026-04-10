const axios = require('axios');
const xml2js = require('xml2js'); // Need to install this fast or write simple parser

// We can use a simple regex-based parser since we aren't strict, or just cheerio to parse xml.
// Wait, we have cheerio! We can use cheerio to parse sitemap.xml

const cheerio = require('cheerio');

async function getRobotsAndSitemaps(domain) {
  const robotsUrl = `https://${domain}/robots.txt`;
  let sitemaps = [];
  let disallowedPaths = [];

  try {
    const res = await axios.get(robotsUrl, { timeout: 3000 });
    const lines = res.data.split('\n');
    let isUserAgentAxionix = false;
    let isUserAgentAll = false;

    for (const line of lines) {
      const lowerLine = line.toLowerCase().trim();
      
      if (lowerLine.startsWith('user-agent:')) {
        const agent = lowerLine.replace('user-agent:', '').trim();
        if (agent === '*' || agent === 'axionixbot') {
          isUserAgentAll = agent === '*';
          isUserAgentAxionix = agent === 'axionixbot';
        } else {
          isUserAgentAll = false;
          isUserAgentAxionix = false;
        }
      }

      // If we are looking at rules that apply to us
      if (isUserAgentAll || isUserAgentAxionix) {
        if (lowerLine.startsWith('disallow:')) {
          const path = lowerLine.replace('disallow:', '').trim();
          if (path) disallowedPaths.push(path);
        }
      }

      if (lowerLine.startsWith('sitemap:')) {
        const sitemapUrl = line.substring(line.toLowerCase().indexOf('sitemap:') + 8).trim();
        if (sitemapUrl) sitemaps.push(sitemapUrl);
      }
    }
  } catch (e) {
    // Robots.txt might not exist, silently ignore
  }

  // If no sitemaps found in robots, try standard fallback
  if (sitemaps.length === 0) {
    sitemaps.push(`https://${domain}/sitemap.xml`);
  }

  return { sitemaps, disallowedPaths };
}

async function fetchSitemapUrls(sitemapUrl, maxDepth = 2) {
  let urls = [];
  try {
    const res = await axios.get(sitemapUrl, { timeout: 4000 });
    const $ = cheerio.load(res.data, { xmlMode: true });

    $('url > loc').each((_, el) => {
      urls.push($(el).text().trim());
    });

    // If it's a sitemap index, we could recursively fetch, but we keep it simple for now and just fetch the parent links
    // unless user requests deep sitemap indexing.
    if (urls.length === 0 && maxDepth > 0) {
      $('sitemap > loc').each((_, el) => {
        urls.push($(el).text().trim()); // Put them in queue in the main crawler
      });
    }

  } catch (e) {}

  return urls;
}

function isAllowed(urlStr, disallowedPaths) {
  try {
    const urlObj = new URL(urlStr);
    for (const d of disallowedPaths) {
      if (urlObj.pathname.startsWith(d)) {
         return false;
      }
    }
    return true;
  } catch(e) {
    return false;
  }
}

module.exports = {
  getRobotsAndSitemaps,
  fetchSitemapUrls,
  isAllowed
};
