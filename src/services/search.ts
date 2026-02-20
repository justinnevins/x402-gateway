export interface SearchInput {
  query: string;
  count?: number;
  freshness?: 'day' | 'week' | 'month' | 'year';
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  publishedDate?: string;
}

export interface SearchOutput {
  results: SearchResult[];
  query: string;
  count: number;
}

// Brave Search API freshness → query param mapping
const FRESHNESS_MAP: Record<string, string> = {
  day: 'pd',
  week: 'pw',
  month: 'pm',
  year: 'py',
};

export async function searchWeb(input: SearchInput): Promise<SearchOutput> {
  const apiKey = process.env.BRAVE_API_KEY;
  if (!apiKey) {
    throw Object.assign(new Error('search endpoint not configured'), { statusCode: 503 });
  }

  const { query, count = 5, freshness } = input;
  if (!query || typeof query !== 'string') {
    throw new Error('query is required');
  }

  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(Math.min(Number(count) || 5, 20)));
  if (freshness && FRESHNESS_MAP[freshness]) {
    url.searchParams.set('freshness', FRESHNESS_MAP[freshness]);
  }

  const response = await fetch(url.toString(), {
    headers: {
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': apiKey,
    },
  });

  if (!response.ok) {
    throw new Error(`Brave Search API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as any;

  const results: SearchResult[] = (data.web?.results ?? []).map((r: any) => {
    const result: SearchResult = {
      title: r.title ?? '',
      url: r.url ?? '',
      snippet: r.description ?? '',
    };
    if (r.age) result.publishedDate = r.age;
    return result;
  });

  return { results, query, count: results.length };
}
