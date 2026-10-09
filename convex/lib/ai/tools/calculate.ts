// The `calculate` tool: arithmetic the model hands off instead of doing in its head. A small parser
// (numbers, + - * / % ^, parentheses, a few functions and constants), never eval, with limits on length
// and depth so a hostile expression can't run away.

const FUNCTIONS: Record<string, { arity: [number, number]; fn: (...xs: number[]) => number }> = {
  abs: { arity: [1, 1], fn: Math.abs },
  sqrt: { arity: [1, 1], fn: Math.sqrt },
  round: { arity: [1, 2], fn: (x, d = 0) => Math.round(x * 10 ** d) / 10 ** d },
  floor: { arity: [1, 1], fn: Math.floor },
  ceil: { arity: [1, 1], fn: Math.ceil },
  min: { arity: [1, 50], fn: Math.min },
  max: { arity: [1, 50], fn: Math.max },
  sum: { arity: [1, 200], fn: (...xs) => xs.reduce((a, b) => a + b, 0) },
  avg: { arity: [1, 200], fn: (...xs) => xs.reduce((a, b) => a + b, 0) / xs.length },
  log: { arity: [1, 1], fn: Math.log10 },
  ln: { arity: [1, 1], fn: Math.log },
  exp: { arity: [1, 1], fn: Math.exp },
};
const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E };

export const MAX_EXPRESSION = 500;
const MAX_DEPTH = 40;

class CalcError extends Error {}

type Token = { kind: "num"; value: number } | { kind: "op"; value: string } | { kind: "name"; value: string };

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    // A number: digits with an optional fraction and exponent; thousands separators ("1,250") are not
    // allowed (a comma separates function arguments).
    const num = /^(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i));
    if (num) {
      out.push({ kind: "num", value: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    const name = /^[a-zA-Z]+/.exec(src.slice(i));
    if (name) {
      out.push({ kind: "name", value: name[0].toLowerCase() });
      i += name[0].length;
      continue;
    }
    if (ch === "*" && src[i + 1] === "*") {
      out.push({ kind: "op", value: "^" });
      i += 2;
      continue;
    }
    if ("+-*/%^(),×÷".includes(ch)) {
      out.push({ kind: "op", value: ch === "×" ? "*" : ch === "÷" ? "/" : ch });
      i++;
      continue;
    }
    throw new CalcError(`Unexpected "${ch}".`);
  }
  return out;
}

/**
 * Evaluates an arithmetic expression. Returns the number, or an error message ("Unexpected ...",
 * "Division by zero", "Not a finite number").
 */
export function calculate(expression: string): { ok: true; value: number } | { ok: false; error: string } {
  const src = expression.trim();
  if (!src) return { ok: false, error: "Give an expression to work out." };
  if (src.length > MAX_EXPRESSION) return { ok: false, error: `The expression is too long (at most ${MAX_EXPRESSION} characters).` };
  let tokens: Token[];
  try {
    tokens = tokenize(src);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  let pos = 0;
  const peek = () => tokens[pos];
  const isOp = (v: string) => peek()?.kind === "op" && peek()!.value === v;
  const expect = (v: string) => {
    if (!isOp(v)) throw new CalcError(`Expected "${v}".`);
    pos++;
  };

  // expr := term (("+" | "-") term)*
  const expr = (depth: number): number => {
    if (depth > MAX_DEPTH) throw new CalcError("The expression is nested too deeply.");
    let v = term(depth);
    while (isOp("+") || isOp("-")) {
      const op = tokens[pos++]!.value;
      const r = term(depth);
      v = op === "+" ? v + r : v - r;
    }
    return v;
  };
  // term := unary (("*" | "/" | "%") unary)*
  const term = (depth: number): number => {
    let v = unary(depth);
    while (isOp("*") || isOp("/") || isOp("%")) {
      const op = tokens[pos++]!.value;
      const r = unary(depth);
      if ((op === "/" || op === "%") && r === 0) throw new CalcError("Division by zero.");
      v = op === "*" ? v * r : op === "/" ? v / r : v % r;
    }
    return v;
  };
  // unary := ("-" | "+") unary | power
  const unary = (depth: number): number => {
    if (isOp("-")) {
      pos++;
      return -unary(depth + 1);
    }
    if (isOp("+")) {
      pos++;
      return unary(depth + 1);
    }
    return power(depth);
  };
  // power := atom ("^" unary)?   (right-associative)
  const power = (depth: number): number => {
    const base = atom(depth);
    if (isOp("^")) {
      pos++;
      return base ** unary(depth + 1);
    }
    return base;
  };
  // atom := number | constant | name "(" args ")" | "(" expr ")"
  const atom = (depth: number): number => {
    const t = peek();
    if (!t) throw new CalcError("The expression ends too early.");
    if (t.kind === "num") {
      pos++;
      return t.value;
    }
    if (t.kind === "name") {
      pos++;
      if (t.value in CONSTANTS && !isOp("(")) return CONSTANTS[t.value]!;
      const f = FUNCTIONS[t.value];
      if (!f) throw new CalcError(`Unknown name "${t.value}".`);
      expect("(");
      const args: number[] = [];
      if (!isOp(")")) {
        args.push(expr(depth + 1));
        while (isOp(",")) {
          pos++;
          args.push(expr(depth + 1));
        }
      }
      expect(")");
      if (args.length < f.arity[0] || args.length > f.arity[1]) throw new CalcError(`${t.value} takes ${f.arity[0] === f.arity[1] ? f.arity[0] : `${f.arity[0]} to ${f.arity[1]}`} argument${f.arity[1] === 1 ? "" : "s"}.`);
      return f.fn(...args);
    }
    if (isOp("(")) {
      pos++;
      const v = expr(depth + 1);
      expect(")");
      return v;
    }
    throw new CalcError(`Unexpected "${t.value}".`);
  };

  try {
    const value = expr(0);
    if (pos < tokens.length) throw new CalcError(`Unexpected "${String(tokens[pos]!.value)}".`);
    if (!Number.isFinite(value)) return { ok: false, error: "Not a finite number." };
    // Floating-point noise off (0.1 + 0.2 is 0.3), up to 12 significant digits.
    return { ok: true, value: Number(value.toPrecision(12)) };
  } catch (e) {
    if (e instanceof CalcError) return { ok: false, error: e.message };
    throw e;
  }
}
