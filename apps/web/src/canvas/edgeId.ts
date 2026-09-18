// The one place an edge id is minted. Encoding both endpoints and their handles means two
// different connections can never collide, and reconnecting the same pair is idempotent.
export function makeEdgeId(
  source: string,
  sourceHandle: string | null | undefined,
  target: string,
  targetHandle: string | null | undefined,
): string {
  return `${source}:${sourceHandle ?? 'out'}->${target}:${targetHandle ?? 'in'}`;
}
