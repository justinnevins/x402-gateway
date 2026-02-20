export interface HeadersInspectInput {
  url: string;
  method?: 'GET' | 'HEAD';
  followRedirects?: boolean;
}

export interface HeadersInspectResult {
  url: string;
  finalUrl: string;
  statusCode: number;
  statusText: string;
  headers: Record<string, string>;
  redirectChain: { url: string; status: number }[];
  security: {
    hsts: boolean;
    csp: boolean;
    xFrameOptions: string | null;
    xContentTypeOptions: boolean;
    referrerPolicy: string | null;
    permissionsPolicy: boolean;
  };
  server: string | null;
  contentType: string | null;
  inspectedAt: string;
}

/**
 * Inspect HTTP response headers for any URL.
 * Useful for security audits, recon, debugging.
 * Zero external dependencies — uses native fetch.
 */
export async function inspectHeaders(input: HeadersInspectInput): Promise<HeadersInspectResult> {
  const { url, method = 'HEAD', followRedirects = true } = input;

  if (!url || typeof url !== 'string') {
    throw new Error('url is required');
  }

  try {
    new URL(url);
  } catch {
    throw new Error('Invalid URL');
  }

  const redirectChain: { url: string; status: number }[] = [];
  let currentUrl = url;
  let response: Response;

  if (!followRedirects) {
    // Single request, no redirect following
    response = await fetch(currentUrl, {
      method,
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
      headers: {
        'User-Agent': 'serve402-headers/0.1 (+https://serve402.com)',
      },
    });
  } else {
    // Follow redirects manually to capture the chain
    let hops = 0;
    const maxHops = 10;

    while (hops < maxHops) {
      const res = await fetch(currentUrl, {
        method: hops === 0 ? method : 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
        headers: {
          'User-Agent': 'serve402-headers/0.1 (+https://serve402.com)',
        },
      });

      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        redirectChain.push({ url: currentUrl, status: res.status });
        const location = res.headers.get('location')!;
        currentUrl = location.startsWith('http') ? location : new URL(location, currentUrl).toString();
        hops++;
      } else {
        response = res;
        break;
      }
    }

    // If we exhausted hops, do one final request with native redirect handling
    if (!response!) {
      response = await fetch(currentUrl, {
        method: 'HEAD',
        signal: AbortSignal.timeout(10_000),
        headers: {
          'User-Agent': 'serve402-headers/0.1 (+https://serve402.com)',
        },
      });
    }
  }

  const headers: Record<string, string> = {};
  response!.headers.forEach((value, key) => {
    headers[key] = value;
  });

  // Security header analysis
  const security = {
    hsts: !!headers['strict-transport-security'],
    csp: !!headers['content-security-policy'],
    xFrameOptions: headers['x-frame-options'] || null,
    xContentTypeOptions: headers['x-content-type-options'] === 'nosniff',
    referrerPolicy: headers['referrer-policy'] || null,
    permissionsPolicy: !!headers['permissions-policy'],
  };

  return {
    url,
    finalUrl: currentUrl,
    statusCode: response!.status,
    statusText: response!.statusText,
    headers,
    redirectChain,
    security,
    server: headers['server'] || null,
    contentType: headers['content-type'] || null,
    inspectedAt: new Date().toISOString(),
  };
}
