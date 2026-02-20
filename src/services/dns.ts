import dns from 'node:dns/promises';

export interface DnsQueryInput {
  domain: string;
  type?: 'A' | 'AAAA' | 'MX' | 'TXT' | 'NS' | 'CNAME' | 'SOA' | 'SRV' | 'PTR';
}

export interface DnsQueryResult {
  domain: string;
  type: string;
  records: any[];
  ttl?: number;
  queriedAt: string;
}

const ALLOWED_TYPES = new Set(['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME', 'SOA', 'SRV', 'PTR']);

/**
 * Perform a DNS lookup for the given domain and record type.
 * Uses Node's built-in dns/promises module — zero external dependencies.
 */
export async function queryDns(input: DnsQueryInput): Promise<DnsQueryResult> {
  const { domain, type = 'A' } = input;

  if (!domain || typeof domain !== 'string') {
    throw new Error('domain is required');
  }

  // Basic domain validation — no URLs, no protocols
  const cleaned = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim();
  if (!cleaned || cleaned.includes(' ')) {
    throw new Error('Invalid domain name');
  }

  const upperType = type.toUpperCase() as DnsQueryInput['type'];
  if (!upperType || !ALLOWED_TYPES.has(upperType)) {
    throw new Error(`Unsupported record type. Allowed: ${[...ALLOWED_TYPES].join(', ')}`);
  }

  try {
    let records: any[];

    switch (upperType) {
      case 'A':
        records = await dns.resolve4(cleaned, { ttl: true });
        break;
      case 'AAAA':
        records = await dns.resolve6(cleaned, { ttl: true });
        break;
      case 'MX':
        records = await dns.resolveMx(cleaned);
        break;
      case 'TXT':
        records = (await dns.resolveTxt(cleaned)).map(chunks => chunks.join(''));
        break;
      case 'NS':
        records = await dns.resolveNs(cleaned);
        break;
      case 'CNAME':
        records = await dns.resolveCname(cleaned);
        break;
      case 'SOA':
        records = [await dns.resolveSoa(cleaned)];
        break;
      case 'SRV':
        records = await dns.resolveSrv(cleaned);
        break;
      case 'PTR':
        records = await dns.resolvePtr(cleaned);
        break;
      default:
        records = await dns.resolve(cleaned, upperType!);
    }

    return {
      domain: cleaned,
      type: upperType!,
      records,
      queriedAt: new Date().toISOString(),
    };
  } catch (err: any) {
    if (err.code === 'ENOTFOUND' || err.code === 'ENODATA') {
      return {
        domain: cleaned,
        type: upperType!,
        records: [],
        queriedAt: new Date().toISOString(),
      };
    }
    throw new Error(`DNS query failed: ${err.message}`);
  }
}
