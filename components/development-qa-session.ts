export function isDevelopmentQaGuest(
  search = typeof window === 'undefined' ? '' : window.location.search,
  environment = process.env.NODE_ENV
): boolean {
  if (environment === 'production') return false;
  return new URLSearchParams(search).get('qa') === '1';
}
