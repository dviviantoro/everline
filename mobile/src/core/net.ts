const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** True for four dot-separated numbers from 0 to 255 (surrounding spaces ignored). */
export function isIpv4(text: string): boolean {
  const match = IPV4.exec(text.trim());
  return match !== null && match.slice(1).every((part) => Number(part) <= 255);
}
