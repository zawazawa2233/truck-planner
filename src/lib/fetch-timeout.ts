export async function fetchWithTimeout(
  input: string | URL,
  init: RequestInit = {},
  timeoutMs = 8000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

export function timeoutErrorLabel(label: string, ms: number): string {
  return `${label} timeout (${ms}ms)`;
}
