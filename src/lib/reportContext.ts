// Components register a snapshot function while mounted; "Report issue" calls
// every one at send time, so a report carries the state behind what's on screen.

type Provider = () => unknown;
const providers = new Map<string, Provider>();

/** Returns the unregister function (use as a useEffect cleanup). */
export function registerReportContext(name: string, provider: Provider): () => void {
  providers.set(name, provider);
  return () => {
    if (providers.get(name) === provider) providers.delete(name);
  };
}

export function collectReportContext(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, provider] of providers) {
    try {
      out[name] = provider();
    } catch (error) {
      out[name] = { providerError: String(error) };
    }
  }
  return out;
}
