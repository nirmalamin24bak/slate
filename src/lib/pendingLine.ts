// Cross-screen hand-off for "tap an example to log it" (spec/02 §G) and the
// scanner's "add to journal". A teach sheet lives on a different route from the
// journal, so it can't call the store's addLine directly without racing the
// journal's own services() instance. Instead it parks one line here; the
// journal drains it on focus and writes it through its live store. In-memory,
// single-slot — a hand-off, not a queue.

let pending: string | null = null;

export function queueLine(text: string): void {
  pending = text;
}

export function takePendingLine(): string | null {
  const line = pending;
  pending = null;
  return line;
}
