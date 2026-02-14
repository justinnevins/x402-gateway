import puppeteer, { Browser, PaperFormat } from 'puppeteer';

let browser: Browser | null = null;
let browserLaunchPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (browser && browser.connected) return browser;
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

const VALID_FORMATS: Record<string, PaperFormat> = {
  a4: 'A4',
  letter: 'Letter',
  legal: 'Legal',
};

interface PdfRequest {
  url: string;
  format?: string;
  landscape?: boolean;
}

export async function generatePdf(req: PdfRequest): Promise<Buffer> {
  const { url, format = 'A4', landscape = false } = req;

  if (!url) throw new Error('url is required');

  try {
    new URL(url);
  } catch {
    throw new Error('Invalid URL');
  }

  const paperFormat = VALID_FORMATS[format.toLowerCase()];
  if (!paperFormat) {
    throw new Error(`Invalid format: ${format}. Must be one of: A4, Letter, Legal`);
  }

  const b = await getBrowser();
  const page = await b.newPage();

  try {
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent(
      'Mozilla/5.0 (compatible; serve402-pdf/0.4; +https://serve402.com)'
    );

    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 20000,
    });

    const pdf = await page.pdf({
      format: paperFormat,
      landscape,
      printBackground: true,
      margin: { top: '1cm', right: '1cm', bottom: '1cm', left: '1cm' },
    });

    return Buffer.from(pdf);
  } finally {
    await page.close();
  }
}

process.on('SIGTERM', async () => {
  if (browser) await browser.close();
});

process.on('SIGINT', async () => {
  if (browser) await browser.close();
});
