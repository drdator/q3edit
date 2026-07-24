export function startupDialogsEnabled(search: string): boolean {
  return new URLSearchParams(search).get('startupDialogs') !== '0';
}
