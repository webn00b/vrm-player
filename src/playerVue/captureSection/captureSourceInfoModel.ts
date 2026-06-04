function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

export function formatSourceInfo(width: number, height: number): string {
  if (!width || !height) return '';
  const divisor = gcd(width, height);
  const aspectWidth = width / divisor;
  const aspectHeight = height / divisor;
  const ratio = aspectWidth <= 32 && aspectHeight <= 32
    ? `${aspectWidth}:${aspectHeight}`
    : `${(width / height).toFixed(2)}:1`;
  return `📐 ${width}×${height} (${ratio})`;
}
