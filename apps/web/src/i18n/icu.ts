// A small, dependency-free subset of ICU MessageFormat, enough for Folevi's UI strings:
//
//   Hello {name}                                   simple argument
//   {count, plural, =0 {No pages} one {# page} other {# pages}}
//   {role, select, editor {Can edit} other {Can view}}
//   {size, number}                                 locale-formatted number
//   It''s                                          '' is a literal apostrophe
//   '{literal braces}'                             quoted text is not parsed
//
// `#` inside a plural branch prints the (locale-formatted) number. Plural categories come from
// Intl.PluralRules for the active locale, so languages with few/many/two forms work unchanged.

export type MessageValue = string | number | Date | null | undefined;
export type MessageValues = Record<string, MessageValue>;

type Node =
  | { t: "text"; v: string }
  | { t: "arg"; name: string }
  | { t: "number"; name: string }
  | { t: "pound" }
  | { t: "plural"; name: string; offset: number; branches: Record<string, Node[]> }
  | { t: "select"; name: string; branches: Record<string, Node[]> };

class Parser {
  private i = 0;
  constructor(private readonly src: string) {}

  parse(): Node[] {
    const nodes = this.message(false);
    if (this.i < this.src.length) throw this.error("unexpected }");
    return nodes;
  }

  private error(msg: string): Error {
    return new Error(`Invalid message "${this.src}" at ${this.i}: ${msg}`);
  }

  private message(inPlural: boolean): Node[] {
    const nodes: Node[] = [];
    let text = "";
    const flush = () => {
      if (text) nodes.push({ t: "text", v: text });
      text = "";
    };
    while (this.i < this.src.length) {
      const c = this.src[this.i]!;
      if (c === "'") {
        const next = this.src[this.i + 1];
        if (next === "'") {
          text += "'";
          this.i += 2;
        } else if (next === "{" || next === "}" || (inPlural && next === "#")) {
          const end = this.src.indexOf("'", this.i + 1);
          if (end < 0) throw this.error("unterminated quote");
          text += this.src.slice(this.i + 1, end);
          this.i = end + 1;
        } else {
          text += c;
          this.i++;
        }
      } else if (c === "{") {
        flush();
        nodes.push(this.argument());
      } else if (c === "}") {
        break;
      } else if (c === "#" && inPlural) {
        flush();
        nodes.push({ t: "pound" });
        this.i++;
      } else {
        text += c;
        this.i++;
      }
    }
    flush();
    return nodes;
  }

  private ws() {
    while (/\s/.test(this.src[this.i] ?? "")) this.i++;
  }

  private word(): string {
    this.ws();
    const m = /^[^\s{},]+/.exec(this.src.slice(this.i));
    if (!m) throw this.error("expected a name");
    this.i += m[0].length;
    this.ws();
    return m[0];
  }

  private expect(ch: string) {
    this.ws();
    if (this.src[this.i] !== ch) throw this.error(`expected "${ch}"`);
    this.i++;
  }

  private argument(): Node {
    this.expect("{");
    const name = this.word();
    if (this.src[this.i] === "}") {
      this.i++;
      return { t: "arg", name };
    }
    this.expect(",");
    const type = this.word();
    if (type === "number") {
      this.expect("}");
      return { t: "number", name };
    }
    if (type !== "plural" && type !== "select") throw this.error(`unsupported type "${type}"`);
    this.expect(",");
    let offset = 0;
    const branches: Record<string, Node[]> = {};
    for (;;) {
      this.ws();
      if (this.src[this.i] === "}") {
        this.i++;
        break;
      }
      const key = this.word();
      if (type === "plural" && key.startsWith("offset:")) {
        offset = Number(key.slice("offset:".length));
        continue;
      }
      this.expect("{");
      branches[key] = this.message(type === "plural");
      this.expect("}");
    }
    if (!branches.other) throw this.error(`"${name}" needs an "other" branch`);
    return type === "plural" ? { t: "plural", name, offset, branches } : { t: "select", name, branches };
  }
}

const cache = new Map<string, Node[]>();

export function parseMessage(pattern: string): Node[] {
  let nodes = cache.get(pattern);
  if (!nodes) {
    nodes = new Parser(pattern).parse();
    cache.set(pattern, nodes);
  }
  return nodes;
}

const pluralRules = new Map<string, Intl.PluralRules>();
const numberFormats = new Map<string, Intl.NumberFormat>();

function rulesFor(locale: string): Intl.PluralRules {
  let r = pluralRules.get(locale);
  if (!r) pluralRules.set(locale, (r = new Intl.PluralRules(locale)));
  return r;
}
function numberFormatFor(locale: string): Intl.NumberFormat {
  let f = numberFormats.get(locale);
  if (!f) numberFormats.set(locale, (f = new Intl.NumberFormat(locale)));
  return f;
}

function render(nodes: Node[], values: MessageValues, locale: string, pound: number | null): string {
  let out = "";
  for (const n of nodes) {
    switch (n.t) {
      case "text":
        out += n.v;
        break;
      case "pound":
        out += pound === null ? "#" : numberFormatFor(locale).format(pound);
        break;
      case "arg": {
        const v = values[n.name];
        out += v instanceof Date ? v.toLocaleString(locale) : typeof v === "number" ? numberFormatFor(locale).format(v) : (v ?? "");
        break;
      }
      case "number": {
        const v = Number(values[n.name] ?? 0);
        out += numberFormatFor(locale).format(v);
        break;
      }
      case "plural": {
        const raw = Number(values[n.name] ?? 0);
        const value = raw - n.offset;
        const exact = n.branches[`=${raw}`];
        const branch = exact ?? n.branches[rulesFor(locale).select(value)] ?? n.branches.other!;
        out += render(branch, values, locale, value);
        break;
      }
      case "select": {
        const key = String(values[n.name] ?? "other");
        out += render(n.branches[key] ?? n.branches.other!, values, locale, pound);
        break;
      }
    }
  }
  return out;
}

/** Formats an ICU-style pattern. Throws on malformed patterns (catalog tests catch these). */
export function formatMessage(pattern: string, values: MessageValues = {}, locale = "en"): string {
  return render(parseMessage(pattern), values, locale, null);
}
