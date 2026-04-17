/** Returns the last dotted segment of a fully-qualified type ref (e.g. "a.b.Foo" → "Foo"). */
export function shortName(fqn: string): string {
  const parts = fqn.split('.');
  return parts[parts.length - 1] ?? fqn;
}
