export const APP_VERSION: string = __APP_VERSION__;
export const APP_BUILT_AT: string = __APP_BUILT_AT__;

export function formatBuildStamp(raw: string = APP_BUILT_AT): string {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export const APP_VERSION_LABEL = `v${APP_VERSION}`;
