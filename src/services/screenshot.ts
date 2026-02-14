import puppeteer, { Browser } from 'puppeteer';

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

interface ScreenshotRequest {
  url: string;
  fullPage?: boolean;
  width?: number;
  height?: number;
  format?: 'png' | 'jpeg';
}

export async function takeScreenshot(req: ScreenshotRequest): Promise<Buffer> {
  const {
    url,
    fullPage = false,
    width = 1280,
    height = 720,
    format = 'png',
  } = req;

  if (!url) throw new Error('url is required');

  try {
    new URL(url);
  } catch {
    throw new Error('Invalid URL');
  }

  // Cap viewport at max 1920x1080
  const cappedWidth = Math.min(Math.max(width, 320), 1920);
  const cappedHeight = Math.min(Math.max(height, 200), 1080);

  const validFormat = format === 'jpeg' ? 'jpeg' : 'png';

  const b = await getBrowser();
  const page = await b.newPage();

  try {
    await page.setViewport({ width: cappedWidth, height: cappedHeight });
    await page.setUserAgent(
      'Mozilla/5.0 (compatible; serve402-screenshot/0.4; +https://serve402.com)'
    );

    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 20000,
    });

    const screenshot = await page.screenshot({
      fullPage,
      type: validFormat,
      ...(validFormat === 'jpeg' ? { quality: 85 } : {}),
    });

    return Buffer.from(screenshot);
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
