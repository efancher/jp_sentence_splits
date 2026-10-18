import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface Usage {
  requests: number;
  requestBodyBytes: number;
  responseBodyBytes: number;
}

/** Test-only HTTP body accounting. Decoded payload bytes, NOT billed/wire egress.
 * Headers, credentials, query strings and response contents are never recorded. */
export function usageMeter(transport: typeof fetch) {
  const entries: Array<Usage & { service: string }> = [];
  const measuredFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const pathname = new URL(request.url).pathname;
    const service = pathname.includes('/storage/v1/') ? 'storage'
      : pathname.includes('/functions/v1/') ? 'functions'
        : pathname.includes('/auth/v1/') ? 'auth' : 'database';
    const entry = { service, requests: 1, requestBodyBytes: 0, responseBodyBytes: 0 };
    entries.push(entry); // Failed attempts also consume the request budget.
    entry.requestBodyBytes = (await request.clone().arrayBuffer()).byteLength;
    const response = await transport(input, init);
    entry.responseBodyBytes = (await response.clone().arrayBuffer()).byteLength;
    return response;
  };
  return {
    fetch: measuredFetch,
    reset: () => { entries.length = 0; },
    totals: (service?: string): Usage => entries
      .filter((entry) => !service || entry.service === service)
      .reduce((sum, entry) => ({
        requests: sum.requests + entry.requests,
        requestBodyBytes: sum.requestBodyBytes + entry.requestBodyBytes,
        responseBodyBytes: sum.responseBodyBytes + entry.responseBodyBytes,
      }), { requests: 0, requestBodyBytes: 0, responseBodyBytes: 0 }),
  };
}

/** Optional artifacts for local/CI baseline reports; never contains payloads. */
export function reportUsage(scenario: string, usage: Usage): void {
  if (!process.env.PERF_USAGE_REPORT_DIR) return;
  const directory = resolve(process.env.PERF_USAGE_REPORT_DIR);
  mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, `${scenario}.json`), JSON.stringify({
    scenario, unit: 'decoded HTTP body bytes (not billed egress)', ...usage,
  }, null, 2) + '\n');
}
