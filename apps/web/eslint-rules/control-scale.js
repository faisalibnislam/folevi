// folevi/control-scale: every control is on the one control scale (the owner, 2026-11-26: "use consistent
// rules/size/space for all UI elements"; docs/DESIGN_SYSTEM.md, Controls). A class string that makes a control
// (ui-btn, ui-input, ui-seg, ui-control) may size it only from the scale:
//   - height: h-control (36, 44 on touch) or h-control-sm (28, 36 on touch), size-control / size-control-sm for a
//     square one, or h-auto / h-full / min-h-control for a field that grows (a text area);
//   - no vertical padding (the height comes from the scale), except on a field that grows;
//   - horizontal padding from the scale only: 0, 8, 10, 12 or 16 px (px-0, px-2, px-2.5, px-3, px-4), and 36 px
//     (pl-9 / pr-9) beside a field's leading or trailing icon;
//   - no arbitrary values (h-[30px], px-[7px]) and no square sizes made of w-N + h-N.
// Strings and template literals are read wherever they are (a constant like ROW_ICON_BUTTON counts too); a string
// without one of the control classes isn't a control and isn't checked.

const CONTROL = /(?:^|\s)(?:ui-btn|ui-input|ui-seg|ui-control)(?=\s|$)/;

/** The utility without its variants (pointer-coarse:, sm:, hover:, [&>*]:) and its important mark. */
function bare(token) {
  let depth = 0;
  let cut = 0;
  for (let i = 0; i < token.length; i++) {
    const c = token[i];
    if (c === "[") depth += 1;
    else if (c === "]") depth -= 1;
    else if (c === ":" && depth === 0) cut = i + 1;
  }
  return token.slice(cut).replace(/^!|!$/g, "");
}

/** What's wrong with one utility on a control, or null. `grows`: the class string makes a field that grows. */
export function problem(token, grows) {
  // Utilities aimed at the control's children ([&>*]:min-h-6) size the children, which the scale also owns.
  const u = bare(token);
  let m;
  if ((m = /^(h|min-h|max-h|size)-(.+)$/.exec(u))) {
    const [, prop, value] = m;
    if (prop === "max-h") return null;
    if (/^control(-sm)?$/.test(value)) return null;
    if (grows && (prop === "min-h" || prop === "h") && /^(auto|full|fit)$/.test(value)) return null;
    if (prop === "h" && value === "auto") return null;
    if (prop === "h" && value === "full") return null;
    return `"${token}" sets a control's height off the scale: use h-control (36) or h-control-sm (28), size-control or size-control-sm for a square one`;
  }
  if ((m = /^w-(\d+(?:\.\d+)?|\[.+\])$/.exec(u)) && (/^\[/.test(m[1]) || Number(m[1]) <= 12)) {
    return `"${token}" makes a square control by hand: use size-control or size-control-sm`;
  }
  if ((m = /^(py|pt|pb)-(.+)$/.exec(u))) {
    if (grows || m[2] === "0") return null;
    return `"${token}" pads a control vertically: its height comes from the scale (h-control, h-control-sm)`;
  }
  if ((m = /^(p|px|pl|pr|ps|pe)-(.+)$/.exec(u))) {
    const [, prop, value] = m;
    if (prop === "p") return value === "0" || grows ? null : `"${token}" pads a control on every side: use px-* from the scale and h-control`;
    if (grows || ["0", "2", "2.5", "3", "4"].includes(value)) return null;
    if (prop !== "px" && value === "9") return null;
    return `"${token}" pads a control off the scale: px-0, px-2, px-2.5, px-3 or px-4 (pl-9 / pr-9 beside a field's icon)`;
  }
  return null;
}

/** Every problem in one class string. */
export function problems(text) {
  if (!CONTROL.test(text)) return [];
  const tokens = text.split(/\s+/).filter(Boolean);
  // A text area or another field that grows with its content keeps its own height and padding.
  const grows = tokens.some((t) => /^(h-auto|min-h-\S+|resize-\S+|field-sizing-content)$/.test(bare(t)) || t === "ui-grow");
  return tokens.map((t) => problem(t, grows)).filter(Boolean);
}

const rule = {
  meta: {
    type: "problem",
    docs: { description: "Controls are sized from the control scale (docs/DESIGN_SYSTEM.md, Controls)" },
    schema: [],
  },
  create(context) {
    const report = (node, text) => {
      for (const message of problems(text)) context.report({ node, message });
    };
    /** The className of a <Button> or <IconButton>: a control whatever classes it names. */
    const buttonClass = (node) => {
      const attr = node.parent;
      if (attr?.type !== "JSXAttribute" || attr.name?.name !== "className") return false;
      const el = attr.parent;
      return el?.type === "JSXOpeningElement" && el.name?.type === "JSXIdentifier" && /^(Button|IconButton)$/.test(el.name.name);
    };
    const inExpression = (node) => (node.parent?.type === "JSXExpressionContainer" ? node.parent : node);
    return {
      Literal(node) {
        if (typeof node.value !== "string") return;
        report(node, buttonClass(inExpression(node)) ? `ui-control ${node.value}` : node.value);
      },
      TemplateLiteral(node) {
        // The parts around ${...} are one class string with holes; the holes are someone else's classes.
        const text = node.quasis.map((q) => q.value.cooked ?? q.value.raw).join(" ");
        report(node, buttonClass(inExpression(node)) ? `ui-control ${text}` : text);
      },
    };
  },
};

export default { rules: { "control-scale": rule } };
