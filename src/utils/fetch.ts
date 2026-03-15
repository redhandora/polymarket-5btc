/**
 * Proxy-aware fetch wrapper.
 * Uses undici's fetch + ProxyAgent when HTTPS_PROXY is set,
 * so it works regardless of Node's built-in fetch proxy support.
 */
import { fetch as undiciFetch, ProxyAgent } from 'undici';

const proxyUrl = process.env.HTTPS_PROXY ?? process.env.https_proxy;
const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

export function fetch(url: string, init?: RequestInit): Promise<Response> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return undiciFetch(url, { ...init, dispatcher } as any) as unknown as Promise<Response>;
}
