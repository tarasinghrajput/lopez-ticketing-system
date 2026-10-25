import { QueryClient } from '@tanstack/react-query';
export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 10000, retry: 1, refetchOnWindowFocus: true } },
});
let csrf = '';
export const setCsrf = (value: string) => {
  csrf = value;
};
export async function api<T>(
  path: string,
  options?: { method?: string; body?: unknown },
): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    method: options?.method ?? 'GET',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
    body: options?.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'Request failed. Please try again.');
  return result;
}
export const invalidate = () => queryClient.invalidateQueries();
export const money = (paise: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paise / 100);
export const time = (value: string, zone = 'Asia/Kolkata') =>
  new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: zone }).format(
    new Date(value),
  );
export const day = (value: string, zone = 'Asia/Kolkata') =>
  new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: zone,
  }).format(new Date(value));
export const dateInZone = (date = new Date(), zone = 'Asia/Kolkata') =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
