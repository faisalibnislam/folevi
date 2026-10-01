import Foundation

/// A small TeX math parser for formula blocks (the web renders them with KaTeX). It reads the common
/// subset people write in notes: letters, numbers and operators, `^` / `_`, `\frac`, `\sqrt[n]{}`, Greek
/// letters and symbols, big operators with limits, `\left( … \right)`, accents, `\text{}`, font commands,
/// spacing and the matrix-like environments (`matrix`, `pmatrix`, `bmatrix`, `vmatrix`, `cases`,
/// `aligned`). Anything unknown is kept visible as its source, so nothing silently disappears.
public enum LaTeX {
    /// How a symbol sits next to its neighbours (TeX's atom classes).
    public enum AtomClass: Sendable, Equatable { case ord, op, bin, rel, open, close, punct, inner }

    /// Text faces for `\mathbf`, `\mathrm`… (`math` = italic letters, upright digits and symbols).
    public enum Face: Sendable, Equatable { case math, roman, bold, italic, sans, mono, calligraphic, blackboard, fraktur }

    public indirect enum Node: Sendable, Equatable {
        case row([Node])
        /// One symbol (a character or a named symbol) with its class and face.
        case symbol(String, AtomClass, Face)
        /// Upright text (`\text{…}`, `\operatorname{…}`, `\sin`…).
        case text(String, Face)
        case frac(Node, Node, rule: Bool)
        case sqrt(Node, index: Node?)
        case scripts(Node, sub: Node?, sup: Node?)
        /// A big operator (∑, ∫…); `limits` puts its scripts above and below in display style.
        case bigOp(String, limits: Bool)
        /// `\left` … `\right` (an empty delimiter is ".").
        case fenced(String, Node, String)
        case accent(Node, String)
        case underline(Node)
        case overline(Node)
        /// A grid; `align` per column ("c", "l", "r"); delimiters around it ("" for none).
        case matrix([[Node]], align: [Character], left: String, right: String)
        /// Horizontal space in em.
        case space(Double)
        /// Source kept as-is (unknown command or malformed input).
        case error(String)
    }

    // MARK: Tables

    static let greek: [String: String] = [
        "alpha": "α", "beta": "β", "gamma": "γ", "delta": "δ", "epsilon": "ϵ", "varepsilon": "ε", "zeta": "ζ", "eta": "η",
        "theta": "θ", "vartheta": "ϑ", "iota": "ι", "kappa": "κ", "lambda": "λ", "mu": "μ", "nu": "ν", "xi": "ξ", "omicron": "ο",
        "pi": "π", "varpi": "ϖ", "rho": "ρ", "varrho": "ϱ", "sigma": "σ", "varsigma": "ς", "tau": "τ", "upsilon": "υ",
        "phi": "ϕ", "varphi": "φ", "chi": "χ", "psi": "ψ", "omega": "ω",
        "Gamma": "Γ", "Delta": "Δ", "Theta": "Θ", "Lambda": "Λ", "Xi": "Ξ", "Pi": "Π", "Sigma": "Σ", "Upsilon": "Υ",
        "Phi": "Φ", "Psi": "Ψ", "Omega": "Ω",
    ]

    static let symbols: [String: (String, AtomClass)] = [
        // Binary operators
        "pm": ("±", .bin), "mp": ("∓", .bin), "times": ("×", .bin), "div": ("÷", .bin), "cdot": ("⋅", .bin), "ast": ("∗", .bin),
        "star": ("⋆", .bin), "circ": ("∘", .bin), "bullet": ("∙", .bin), "oplus": ("⊕", .bin), "ominus": ("⊖", .bin),
        "otimes": ("⊗", .bin), "odot": ("⊙", .bin), "cup": ("∪", .bin), "cap": ("∩", .bin), "setminus": ("∖", .bin),
        "wedge": ("∧", .bin), "land": ("∧", .bin), "vee": ("∨", .bin), "lor": ("∨", .bin), "dagger": ("†", .bin),
        // Relations
        "leq": ("≤", .rel), "le": ("≤", .rel), "geq": ("≥", .rel), "ge": ("≥", .rel), "neq": ("≠", .rel), "ne": ("≠", .rel),
        "approx": ("≈", .rel), "equiv": ("≡", .rel), "sim": ("∼", .rel), "simeq": ("≃", .rel), "cong": ("≅", .rel),
        "propto": ("∝", .rel), "ll": ("≪", .rel), "gg": ("≫", .rel), "in": ("∈", .rel), "notin": ("∉", .rel), "ni": ("∋", .rel),
        "subset": ("⊂", .rel), "supset": ("⊃", .rel), "subseteq": ("⊆", .rel), "supseteq": ("⊇", .rel), "perp": ("⊥", .rel),
        "parallel": ("∥", .rel), "mid": ("∣", .rel), "to": ("→", .rel), "rightarrow": ("→", .rel), "leftarrow": ("←", .rel),
        "gets": ("←", .rel), "leftrightarrow": ("↔", .rel), "Rightarrow": ("⇒", .rel), "Leftarrow": ("⇐", .rel),
        "Leftrightarrow": ("⇔", .rel), "iff": ("⟺", .rel), "implies": ("⟹", .rel), "mapsto": ("↦", .rel),
        "longrightarrow": ("⟶", .rel), "longleftarrow": ("⟵", .rel), "uparrow": ("↑", .rel), "downarrow": ("↓", .rel),
        "coloneqq": ("≔", .rel), "models": ("⊨", .rel), "vdash": ("⊢", .rel),
        // Ordinary symbols
        "infty": ("∞", .ord), "partial": ("∂", .ord), "nabla": ("∇", .ord), "forall": ("∀", .ord), "exists": ("∃", .ord),
        "nexists": ("∄", .ord), "emptyset": ("∅", .ord), "varnothing": ("∅", .ord), "neg": ("¬", .ord), "lnot": ("¬", .ord),
        "angle": ("∠", .ord), "triangle": ("△", .ord), "hbar": ("ℏ", .ord), "ell": ("ℓ", .ord), "Re": ("ℜ", .ord), "Im": ("ℑ", .ord),
        "aleph": ("ℵ", .ord), "prime": ("′", .ord), "degree": ("°", .ord), "ldots": ("…", .inner), "dots": ("…", .inner),
        "cdots": ("⋯", .inner), "vdots": ("⋮", .ord), "ddots": ("⋱", .ord), "therefore": ("∴", .rel), "because": ("∵", .rel),
        "top": ("⊤", .ord), "bot": ("⊥", .ord), "checkmark": ("✓", .ord), "square": ("□", .ord), "Box": ("□", .ord),
        "%": ("%", .ord), "$": ("$", .ord), "#": ("#", .ord), "&": ("&", .ord), "_": ("_", .ord),
        // Delimiters
        "{": ("{", .open), "}": ("}", .close), "lbrace": ("{", .open), "rbrace": ("}", .close), "langle": ("⟨", .open),
        "rangle": ("⟩", .close), "lfloor": ("⌊", .open), "rfloor": ("⌋", .close), "lceil": ("⌈", .open), "rceil": ("⌉", .close),
        "|": ("‖", .ord), "vert": ("|", .ord), "Vert": ("‖", .ord), "lvert": ("|", .open), "rvert": ("|", .close),
        "lVert": ("‖", .open), "rVert": ("‖", .close),
        ",": ("", .ord),
    ]

    /// Big operators: symbol and whether scripts go above/below in display style.
    static let bigOps: [String: (String, Bool)] = [
        "sum": ("∑", true), "prod": ("∏", true), "coprod": ("∐", true), "bigcup": ("⋃", true), "bigcap": ("⋂", true),
        "bigoplus": ("⨁", true), "bigotimes": ("⨂", true), "bigvee": ("⋁", true), "bigwedge": ("⋀", true),
        "int": ("∫", false), "iint": ("∬", false), "iiint": ("∭", false), "oint": ("∮", false),
    ]

    /// Upright function names (`\sin x`); the ones with `true` take limits under them (`\lim_{x\to0}`).
    static let functions: [String: Bool] = [
        "sin": false, "cos": false, "tan": false, "cot": false, "sec": false, "csc": false, "arcsin": false, "arccos": false,
        "arctan": false, "sinh": false, "cosh": false, "tanh": false, "log": false, "ln": false, "lg": false, "exp": false,
        "det": true, "dim": false, "ker": false, "deg": false, "arg": false, "gcd": true, "hom": false,
        "lim": true, "liminf": true, "limsup": true, "max": true, "min": true, "sup": true, "inf": true, "Pr": true,
    ]

    static let accents: [String: String] = [
        "hat": "^", "widehat": "^", "bar": "¯", "vec": "→", "dot": "˙", "ddot": "¨", "tilde": "~", "widetilde": "~",
        "acute": "´", "grave": "`", "breve": "˘", "check": "ˇ",
    ]

    static let spaces: [String: Double] = [
        ",": 3.0 / 18, ":": 4.0 / 18, ">": 4.0 / 18, ";": 5.0 / 18, "!": -3.0 / 18, " ": 0.25, "quad": 1, "qquad": 2,
        "thinspace": 3.0 / 18, "medspace": 4.0 / 18, "thickspace": 5.0 / 18, "enspace": 0.5,
    ]

    static let fonts: [String: Face] = [
        "mathrm": .roman, "mathbf": .bold, "mathit": .italic, "mathsf": .sans, "mathtt": .mono, "mathcal": .calligraphic,
        "mathbb": .blackboard, "mathfrak": .fraktur, "textbf": .bold, "textit": .italic, "textrm": .roman, "boldsymbol": .bold,
        "bm": .bold, "rm": .roman, "bf": .bold, "it": .italic,
    ]

    // MARK: Parsing

    /// Parses a formula; never fails (unknown parts come back as `.error` nodes).
    public static func parse(_ source: String) -> Node {
        var p = Parser(Array(source))
        return p.parseRow(until: nil)
    }

    struct Parser {
        let chars: [Character]
        var i = 0
        var face: Face = .math
        init(_ chars: [Character]) { self.chars = chars }

        var atEnd: Bool { i >= chars.count }
        var peek: Character? { atEnd ? nil : chars[i] }

        mutating func skipSpaces() {
            while let c = peek, c.isWhitespace { i += 1 }
        }

        /// Reads `\name` (letters) or `\<one char>`; `i` is on the backslash.
        mutating func readCommand() -> String {
            i += 1
            guard let c = peek else { return "" }
            if c.isLetter {
                var name = ""
                while let l = peek, l.isLetter { name.append(l); i += 1 }
                return name
            }
            i += 1
            return String(c)
        }

        /// Parses until a closing `}`, `\right`, `\end`, `&` / `\\` (in a matrix) or the end.
        mutating func parseRow(until stop: Set<String>?) -> Node {
            var items: [Node] = []
            while !atEnd {
                skipSpaces()
                guard let c = peek else { break }
                if c == "}" { if stop?.contains("}") == true { break }; i += 1; continue }
                if c == "&", stop?.contains("&") == true { break }
                if c == "\\" {
                    let save = i
                    let name = readCommand()
                    if name == "\\" && stop?.contains("\\\\") == true { i = save; break }
                    if (name == "right" && stop?.contains("right") == true) || (name == "end" && stop?.contains("end") == true) {
                        i = save
                        break
                    }
                    i = save
                }
                if c == "^" || c == "_" {
                    i += 1
                    let arg = parseArgument()
                    let base = items.popLast() ?? .row([])
                    items.append(attach(base, arg, sup: c == "^"))
                    continue
                }
                if c == "'" {
                    // Primes: f' = f^{\prime}
                    i += 1
                    var primes = "′"
                    while peek == "'" { primes += "′"; i += 1 }
                    let base = items.popLast() ?? .row([])
                    items.append(attach(base, .symbol(primes, .ord, .roman), sup: true))
                    continue
                }
                items.append(parseAtom())
            }
            return items.count == 1 ? items[0] : .row(items)
        }

        func attach(_ base: Node, _ arg: Node, sup: Bool) -> Node {
            if case .scripts(let b, let sub, let sp) = base {
                if sup, sp == nil { return .scripts(b, sub: sub, sup: arg) }
                if !sup, sub == nil { return .scripts(b, sub: arg, sup: sp) }
            }
            return sup ? .scripts(base, sub: nil, sup: arg) : .scripts(base, sub: arg, sup: nil)
        }

        /// A script or command argument: a `{group}`, a command, or one character.
        mutating func parseArgument() -> Node {
            skipSpaces()
            guard let c = peek else { return .row([]) }
            if c == "{" {
                i += 1
                let inner = parseRow(until: ["}"])
                if peek == "}" { i += 1 }
                return inner
            }
            if c == "\\" { return parseAtom() }
            i += 1
            return charNode(c)
        }

        /// The raw text of a `{…}` group (for `\text`, environment names…).
        mutating func readGroupText() -> String {
            skipSpaces()
            guard peek == "{" else {
                if let c = peek { i += 1; return String(c) }
                return ""
            }
            i += 1
            var depth = 1
            var out = ""
            while let c = peek {
                i += 1
                if c == "{" { depth += 1 } else if c == "}" { depth -= 1; if depth == 0 { break } }
                if c == "\\", let n = peek, "{}$%#&_ ".contains(n) { out.append(n); i += 1; continue }
                out.append(c)
            }
            return out
        }

        func charNode(_ c: Character) -> Node {
            let s = String(c)
            if c.isNumber || c == "." { return .symbol(s, .ord, face == .math ? .roman : face) }
            if c.isLetter { return .symbol(s, .ord, face) }
            switch c {
            case "+", "*": return .symbol(c == "*" ? "∗" : "+", .bin, .roman)
            case "-": return .symbol("−", .bin, .roman)
            case "=", "<", ">", ":": return .symbol(s, .rel, .roman)
            case ",", ";": return .symbol(s, .punct, .roman)
            case "(", "[": return .symbol(s, .open, .roman)
            case ")", "]": return .symbol(s, .close, .roman)
            case "|": return .symbol("|", .ord, .roman)
            case "~": return .space(0.25)
            default: return .symbol(s, .ord, .roman)
            }
        }

        mutating func parseAtom() -> Node {
            guard let c = peek else { return .row([]) }
            if c == "{" {
                i += 1
                let inner = parseRow(until: ["}"])
                if peek == "}" { i += 1 }
                return inner
            }
            if c != "\\" {
                i += 1
                return charNode(c)
            }
            let name = readCommand()
            return command(name)
        }

        mutating func command(_ name: String) -> Node {
            if let g = LaTeX.greek[name] {
                // Capital Greek is upright, lowercase italic (TeX).
                let upright = name.first?.isUppercase == true
                return .symbol(g, .ord, upright ? .roman : (face == .math ? .math : face))
            }
            if let s = LaTeX.symbols[name] { return s.0.isEmpty ? .space(3.0 / 18) : .symbol(s.0, s.1, .roman) }
            if let sp = LaTeX.spaces[name] { return .space(sp) }
            if let op = LaTeX.bigOps[name] { return .bigOp(op.0, limits: op.1) }
            if let limits = LaTeX.functions[name] { return limits ? .bigOp(name, limits: true) : .text(name, .roman) }
            if let accent = LaTeX.accents[name] { return .accent(parseArgument(), accent) }
            if let f = LaTeX.fonts[name] {
                let saved = face
                face = f
                let inner = parseArgument()
                face = saved
                return inner
            }
            switch name {
            case "frac", "dfrac", "tfrac", "cfrac":
                let num = parseArgument()
                let den = parseArgument()
                return .frac(num, den, rule: true)
            case "binom", "dbinom", "tbinom":
                let top = parseArgument()
                let bottom = parseArgument()
                return .fenced("(", .frac(top, bottom, rule: false), ")")
            case "sqrt":
                skipSpaces()
                var index: Node?
                if peek == "[" {
                    i += 1
                    var depth = 0
                    var src: [Character] = []
                    while let ch = peek {
                        i += 1
                        if ch == "[" { depth += 1 }
                        if ch == "]" { if depth == 0 { break }; depth -= 1 }
                        src.append(ch)
                    }
                    var sub = Parser(src)
                    index = sub.parseRow(until: nil)
                }
                return .sqrt(parseArgument(), index: index)
            case "text", "textnormal", "mbox", "operatorname", "mathop":
                return .text(readGroupText(), .roman)
            case "overline": return .overline(parseArgument())
            case "underline": return .underline(parseArgument())
            case "left":
                let open = readDelimiter()
                let inner = parseRow(until: ["right"])
                var close = "."
                if peek == "\\" {
                    let save = i
                    if readCommand() == "right" { close = readDelimiter() } else { i = save }
                }
                return .fenced(open, inner, close)
            case "right":
                _ = readDelimiter()
                return .row([])
            case "big", "Big", "bigg", "Bigg", "bigl", "bigr", "Bigl", "Bigr", "biggl", "biggr", "Biggl", "Biggr":
                let d = readDelimiter()
                return .symbol(d == "." ? "" : d, name.hasSuffix("l") ? .open : name.hasSuffix("r") ? .close : .ord, .roman)
            case "begin":
                return environment(readGroupText())
            case "displaystyle", "textstyle", "scriptstyle", "limits", "nolimits", "nonumber", "notag":
                return .row([])
            case "\\":
                return .space(0)
            default:
                return .error("\\" + name)
            }
        }

        mutating func readDelimiter() -> String {
            skipSpaces()
            guard let c = peek else { return "." }
            if c == "\\" {
                let name = readCommand()
                if let s = LaTeX.symbols[name] { return s.0 }
                return name == "|" ? "‖" : "."
            }
            i += 1
            return String(c)
        }

        mutating func environment(_ name: String) -> Node {
            var rows: [[Node]] = [[]]
            while !atEnd {
                let cell = parseRow(until: ["&", "\\\\", "end"])
                rows[rows.count - 1].append(cell)
                guard let c = peek else { break }
                if c == "&" { i += 1; continue }
                if c == "\\" {
                    let save = i
                    let cmd = readCommand()
                    if cmd == "\\" { rows.append([]); continue }
                    if cmd == "end" { _ = readGroupText(); break }
                    i = save
                    break
                }
            }
            // Drop a trailing empty row (a final "\\").
            if let last = rows.last, rows.count > 1, last.allSatisfy({ $0 == .row([]) }) { rows.removeLast() }
            let cols = rows.map(\.count).max() ?? 1
            switch name {
            case "pmatrix": return .matrix(rows, align: Array(repeating: "c", count: cols), left: "(", right: ")")
            case "bmatrix": return .matrix(rows, align: Array(repeating: "c", count: cols), left: "[", right: "]")
            case "Bmatrix": return .matrix(rows, align: Array(repeating: "c", count: cols), left: "{", right: "}")
            case "vmatrix": return .matrix(rows, align: Array(repeating: "c", count: cols), left: "|", right: "|")
            case "Vmatrix": return .matrix(rows, align: Array(repeating: "c", count: cols), left: "‖", right: "‖")
            case "cases", "dcases": return .matrix(rows, align: Array(repeating: "l", count: cols), left: "{", right: "")
            case "aligned", "align", "align*", "split", "gathered", "alignat", "eqnarray":
                let align: [Character] = (0..<cols).map { $0 % 2 == 0 ? "r" : "l" }
                return .matrix(rows, align: name == "gathered" ? Array(repeating: "c", count: cols) : align, left: "", right: "")
            default: return .matrix(rows, align: Array(repeating: "c", count: cols), left: "", right: "")
            }
        }
    }
}
