import puppeteer, { Browser } from 'puppeteer';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';

let browser: Browser | null = null;
let browserLaunchPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (browser && browser.connected) return browser;

  // Prevent multiple simultaneous launches
  if (browserLaunchPromise) return browserLaunchPromise;

  browserLaunchPromise = puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--single-process',
      '--no-zygote',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-sync',
      '--disable-translate',
      '--metrics-recording-only',
      '--mute-audio',
      '--no-first-run',
      '--safebrowsing-disable-auto-update',
    ],
  });

  browser = await browserLaunchPromise;
  browserLaunchPromise = null;

  browser.on('disconnected', () => {
    browser = null;
  });

  return browser;
}

interface FetchRequest {
  url: string;
  format?: 'markdown' | 'text';
  maxChars?: number;
}

interface FetchResponse {
  url: string;
  title: string;
  content: string;
  contentLength: number;
  fetchedAt: string;
}

export async function fetchContent(req: FetchRequest): Promise<FetchResponse> {
  const { url, format = 'markdown', maxChars = 50000 } = req;

  if (!url) throw new Error('url is required');

  // Basic URL validation
  try {
    new URL(url);
  } catch {
    throw new Error('Invalid URL');
  }

  const b = await getBrowser();
  const page = await b.newPage();

  try {
    // Set a reasonable viewport and user agent
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent(
      'Mozilla/5.0 (compatible; serve402-fetch/0.1; +https://serve402.com)'
    );

    // Navigate with timeout
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 15000,
    });

    // Get page content
    const html = await page.content();
    const pageTitle = await page.title();

    // Use Readability to extract content
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    let content = '';
    let title = pageTitle;

    if (article) {
      title = article.title || pageTitle;
      content = format === 'text' ? article.textContent : article.content;
    } else {
      // Fallback: just get body text
      content = await page.evaluate(() => document.body?.innerText || '');
    }

    // Truncate if needed
    if (content.length > maxChars) {
      content = content.substring(0, maxChars) + '\n\n[truncated]';
    }

    return {
      url,
      title,
      content,
      contentLength: content.length,
      fetchedAt: new Date().toISOString(),
    };
  } finally {
    await page.close();
  }
}

// Cleanup on process exit
process.on('SIGTERM', async () => {
  if (browser) await browser.close();
});

process.on('SIGINT', async () => {
  if (browser) await browser.close();
});
