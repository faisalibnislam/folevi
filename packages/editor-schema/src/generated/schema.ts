// Generated from packages/editor-schema/spec/folevi-blocks.v1.json by scripts/generate.mjs. Do not edit.

export const SCHEMA_VERSION = 1 as const;

export const HeadingLevelValues = [1,2,3] as const;
export type HeadingLevel = (typeof HeadingLevelValues)[number];
export const CalloutToneValues = ["note","info","success","warning","danger"] as const;
export type CalloutTone = (typeof CalloutToneValues)[number];
export const TextColorValues = ["muted","accent","moss","marigold","plum","coral"] as const;
export type TextColor = (typeof TextColorValues)[number];
export const HighlightColorValues = ["yellow","green","blue","pink"] as const;
export type HighlightColor = (typeof HighlightColorValues)[number];
export const TaskPriorityValues = ["none","low","medium","high"] as const;
export type TaskPriority = (typeof TaskPriorityValues)[number];
export const PageDisplayValues = ["link","card"] as const;
export type PageDisplay = (typeof PageDisplayValues)[number];
export const DocumentFontValues = ["sans","serif","mono","rounded"] as const;
export type DocumentFont = (typeof DocumentFontValues)[number];
export const DocumentWidthValues = ["narrow","default","wide"] as const;
export type DocumentWidth = (typeof DocumentWidthValues)[number];
export const DocumentBackgroundValues = ["paper","plain","tinted","grid"] as const;
export type DocumentBackground = (typeof DocumentBackgroundValues)[number];
export const DocumentAccentValues = ["accent","moss","marigold","plum","coral"] as const;
export type DocumentAccent = (typeof DocumentAccentValues)[number];
export const CardStyleValues = ["folio","plain","tinted","outline"] as const;
export type CardStyle = (typeof CardStyleValues)[number];
export const CoverKindValues = ["none","color","gradient","image","art"] as const;
export type CoverKind = (typeof CoverKindValues)[number];
export const DocumentKindValues = ["document","daily","template","collectionRow"] as const;
export type DocumentKind = (typeof DocumentKindValues)[number];
export const DocumentSheetValues = ["white","paper","ivory","mist","sage","blush","night"] as const;
export type DocumentSheet = (typeof DocumentSheetValues)[number];
export const DocumentTextValues = ["ink","slate","navy","forest","plum","brown","white"] as const;
export type DocumentText = (typeof DocumentTextValues)[number];
export const SeparatorStyleValues = ["line","dots","doodle"] as const;
export type SeparatorStyle = (typeof SeparatorStyleValues)[number];
export const BlockTextStyleValues = ["strong","caption"] as const;
export type BlockTextStyle = (typeof BlockTextStyleValues)[number];
export const BlockDecorationValues = ["focus","block"] as const;
export type BlockDecoration = (typeof BlockDecorationValues)[number];
export const BlockColorValues = ["black","slate","gray","navy","blue","sky","green","purple","red","orange","brown"] as const;
export type BlockColor = (typeof BlockColorValues)[number];
export const BlockAlignValues = ["left","center","right","justify"] as const;
export type BlockAlign = (typeof BlockAlignValues)[number];
export const BlockFontValues = ["system","serif","mono","rounded"] as const;
export type BlockFont = (typeof BlockFontValues)[number];
export const BlockGroupValues = ["page","card"] as const;
export type BlockGroup = (typeof BlockGroupValues)[number];
export const DividerStyleValues = ["extralight","light","regular","strong"] as const;
export type DividerStyle = (typeof DividerStyleValues)[number];

export type Mark =
  | { type: "bold" }
  | { type: "italic" }
  | { type: "underline" }
  | { type: "strike" }
  | { type: "code" }
  | {
      type: "link";
      href: string;
    }
  | {
      type: "color";
      value: TextColor;
    }
  | {
      type: "highlight";
      value: HighlightColor;
    };
export const MarkTypes = ["bold","italic","underline","strike","code","link","color","highlight"] as const;

export type InlineNode =
  | {
      type: "text";
      text: string;
      marks?: Mark[];
    }
  | {
      type: "mention";
      userId: string;
      label: string;
    }
  | {
      type: "date";
      date: string;
    }
  | {
      type: "pageLink";
      documentId: string;
      label: string;
    };
export const InlineNodeTypes = ["text","mention","date","pageLink"] as const;

export interface DocumentStyle {
  font: DocumentFont;
  width: DocumentWidth;
  background: DocumentBackground;
  accent: DocumentAccent;
  card: CardStyle;
  backdrop?: string;
  sheet?: DocumentSheet;
  text?: DocumentText;
  separator?: SeparatorStyle;
  blur?: boolean;
}
export interface DocumentCover {
  kind: CoverKind;
  value?: string;
}

export interface ParagraphProps {
  textStyle?: BlockTextStyle;
  decoration?: BlockDecoration;
  color?: BlockColor;
  align?: BlockAlign;
  font?: BlockFont;
  group?: BlockGroup;
}
export interface HeadingProps {
  level: HeadingLevel;
  decoration?: BlockDecoration;
  color?: BlockColor;
  align?: BlockAlign;
  font?: BlockFont;
  group?: BlockGroup;
}
export interface BulletedProps {
  decoration?: BlockDecoration;
  color?: BlockColor;
  align?: BlockAlign;
  font?: BlockFont;
  group?: BlockGroup;
}
export interface NumberedProps {
  decoration?: BlockDecoration;
  color?: BlockColor;
  align?: BlockAlign;
  font?: BlockFont;
  group?: BlockGroup;
}
export interface TodoProps {
  checked: boolean;
  canceled?: boolean;
  dueDate?: string;
  dueTime?: string;
  priority?: TaskPriority;
  assigneeId?: string;
  reminderAt?: number;
  completedAt?: number;
  decoration?: BlockDecoration;
  color?: BlockColor;
  align?: BlockAlign;
  font?: BlockFont;
  group?: BlockGroup;
}
export interface ToggleProps {
  collapsed: boolean;
  decoration?: BlockDecoration;
  color?: BlockColor;
  align?: BlockAlign;
  font?: BlockFont;
  group?: BlockGroup;
}
export interface QuoteProps {
  decoration?: BlockDecoration;
  color?: BlockColor;
  align?: BlockAlign;
  font?: BlockFont;
  group?: BlockGroup;
}
export interface CalloutProps {
  tone: CalloutTone;
  icon?: string;
}
export interface DividerProps {
  style?: DividerStyle;
}
export type PageBreakProps = Record<string, never>;
export interface CodeProps {
  language: string;
  code: string;
}
export interface ImageProps {
  fileId?: string;
  url?: string;
  alt: string;
  caption: string;
  width?: number;
  naturalWidth?: number;
  naturalHeight?: number;
}
export interface FileProps {
  fileId: string;
  name: string;
  size: number;
  mimeType: string;
}
export interface TableProps {
  rows: InlineNode[][][];
  headerRow: boolean;
}
export interface PageProps {
  documentId: string;
  display: PageDisplay;
  titleCache?: string;
  iconCache?: string;
}
export interface BookmarkProps {
  url: string;
  title?: string;
  description?: string;
  siteName?: string;
  image?: string;
  icon?: string;
}
export interface CollectionProps {
  collectionId: string;
  viewId?: string;
}
export interface FormulaProps {
  latex: string;
}
export interface WhiteboardProps {
  data: string;
  height: number;
}
export interface FlowchartProps {
  data: string;
  height: number;
}
export interface AudioProps {
  fileId: string;
  name: string;
  size: number;
  mimeType: string;
  duration: number;
}

export interface BlockPropsMap {
  paragraph: ParagraphProps;
  heading: HeadingProps;
  bulleted: BulletedProps;
  numbered: NumberedProps;
  todo: TodoProps;
  toggle: ToggleProps;
  quote: QuoteProps;
  callout: CalloutProps;
  divider: DividerProps;
  pageBreak: PageBreakProps;
  code: CodeProps;
  image: ImageProps;
  file: FileProps;
  table: TableProps;
  page: PageProps;
  bookmark: BookmarkProps;
  collection: CollectionProps;
  formula: FormulaProps;
  whiteboard: WhiteboardProps;
  flowchart: FlowchartProps;
  audio: AudioProps;
}
export const BLOCK_TYPES = ["paragraph","heading","bulleted","numbered","todo","toggle","quote","callout","divider","pageBreak","code","image","file","table","page","bookmark","collection","formula","whiteboard","flowchart","audio"] as const;
export type KnownBlockType = (typeof BLOCK_TYPES)[number];
export const TEXT_BLOCK_TYPES = ["paragraph","heading","bulleted","numbered","todo","toggle","quote","callout"] as const;
export type TextBlockType = (typeof TEXT_BLOCK_TYPES)[number];
export const LIMITS = {
  "maxTextLength": 20000,
  "maxCodeLength": 100000,
  "maxDepth": 8,
  "maxTableRows": 200,
  "maxTableColumns": 20,
  "maxBlocksPerDocument": 5000,
  "maxRankLength": 128,
  "maxFormulaLength": 10000,
  "maxWhiteboardDataLength": 200000,
  "minWhiteboardHeight": 120,
  "maxWhiteboardHeight": 2400,
  "maxFlowchartDataLength": 200000,
  "minFlowchartHeight": 200,
  "maxFlowchartHeight": 1600
} as const;
export const CODE_LANGUAGES = ["plaintext","bash","c","cpp","csharp","css","diff","go","graphql","html","java","javascript","json","kotlin","latex","markdown","mermaid","php","python","ruby","rust","sql","swift","toml","typescript","xml","yaml"] as const;

/** Raw spec, used by the runtime validator. */
export const SPEC = {"enums":{"HeadingLevel":{"type":"int","values":[1,2,3]},"CalloutTone":{"type":"string","values":["note","info","success","warning","danger"]},"TextColor":{"type":"string","values":["muted","accent","moss","marigold","plum","coral"]},"HighlightColor":{"type":"string","values":["yellow","green","blue","pink"]},"TaskPriority":{"type":"string","values":["none","low","medium","high"]},"PageDisplay":{"type":"string","values":["link","card"]},"DocumentFont":{"type":"string","values":["sans","serif","mono","rounded"]},"DocumentWidth":{"type":"string","values":["narrow","default","wide"]},"DocumentBackground":{"type":"string","values":["paper","plain","tinted","grid"]},"DocumentAccent":{"type":"string","values":["accent","moss","marigold","plum","coral"]},"CardStyle":{"type":"string","values":["folio","plain","tinted","outline"]},"CoverKind":{"type":"string","values":["none","color","gradient","image","art"]},"DocumentKind":{"type":"string","values":["document","daily","template","collectionRow"]},"DocumentSheet":{"type":"string","values":["white","paper","ivory","mist","sage","blush","night"]},"DocumentText":{"type":"string","values":["ink","slate","navy","forest","plum","brown","white"]},"SeparatorStyle":{"type":"string","values":["line","dots","doodle"]},"BlockTextStyle":{"type":"string","values":["strong","caption"]},"BlockDecoration":{"type":"string","values":["focus","block"]},"BlockColor":{"type":"string","values":["black","slate","gray","navy","blue","sky","green","purple","red","orange","brown"]},"BlockAlign":{"type":"string","values":["left","center","right","justify"]},"BlockFont":{"type":"string","values":["system","serif","mono","rounded"]},"BlockGroup":{"type":"string","values":["page","card"]},"DividerStyle":{"type":"string","values":["extralight","light","regular","strong"]}},"unions":{"Mark":{"discriminator":"type","variants":{"bold":{},"italic":{},"underline":{},"strike":{},"code":{},"link":{"href":"string"},"color":{"value":"TextColor"},"highlight":{"value":"HighlightColor"}}},"InlineNode":{"discriminator":"type","variants":{"text":{"text":"string","marks":"Mark[]?"},"mention":{"userId":"string","label":"string"},"date":{"date":"string"},"pageLink":{"documentId":"string","label":"string"}}}},"structs":{"DocumentStyle":{"font":"DocumentFont","width":"DocumentWidth","background":"DocumentBackground","accent":"DocumentAccent","card":"CardStyle","backdrop":"string?","sheet":"DocumentSheet?","text":"DocumentText?","separator":"SeparatorStyle?","blur":"bool?"},"DocumentCover":{"kind":"CoverKind","value":"string?"}},"blocks":{"paragraph":{"text":true,"props":{"textStyle":"BlockTextStyle?","decoration":"BlockDecoration?","color":"BlockColor?","align":"BlockAlign?","font":"BlockFont?","group":"BlockGroup?"}},"heading":{"text":true,"props":{"level":"HeadingLevel","decoration":"BlockDecoration?","color":"BlockColor?","align":"BlockAlign?","font":"BlockFont?","group":"BlockGroup?"}},"bulleted":{"text":true,"props":{"decoration":"BlockDecoration?","color":"BlockColor?","align":"BlockAlign?","font":"BlockFont?","group":"BlockGroup?"}},"numbered":{"text":true,"props":{"decoration":"BlockDecoration?","color":"BlockColor?","align":"BlockAlign?","font":"BlockFont?","group":"BlockGroup?"}},"todo":{"text":true,"props":{"checked":"bool","canceled":"bool?","dueDate":"string?","dueTime":"string?","priority":"TaskPriority?","assigneeId":"string?","reminderAt":"number?","completedAt":"number?","decoration":"BlockDecoration?","color":"BlockColor?","align":"BlockAlign?","font":"BlockFont?","group":"BlockGroup?"}},"toggle":{"text":true,"props":{"collapsed":"bool","decoration":"BlockDecoration?","color":"BlockColor?","align":"BlockAlign?","font":"BlockFont?","group":"BlockGroup?"}},"quote":{"text":true,"props":{"decoration":"BlockDecoration?","color":"BlockColor?","align":"BlockAlign?","font":"BlockFont?","group":"BlockGroup?"}},"callout":{"text":true,"props":{"tone":"CalloutTone","icon":"string?"}},"divider":{"text":false,"props":{"style":"DividerStyle?"}},"pageBreak":{"text":false,"props":{}},"code":{"text":false,"props":{"language":"string","code":"string"}},"image":{"text":false,"props":{"fileId":"string?","url":"string?","alt":"string","caption":"string","width":"number?","naturalWidth":"number?","naturalHeight":"number?"}},"file":{"text":false,"props":{"fileId":"string","name":"string","size":"number","mimeType":"string"}},"table":{"text":false,"props":{"rows":"InlineNode[][][]","headerRow":"bool"}},"page":{"text":false,"props":{"documentId":"string","display":"PageDisplay","titleCache":"string?","iconCache":"string?"}},"bookmark":{"text":false,"props":{"url":"string","title":"string?","description":"string?","siteName":"string?","image":"string?","icon":"string?"}},"collection":{"text":false,"props":{"collectionId":"string","viewId":"string?"}},"formula":{"text":false,"props":{"latex":"string"}},"whiteboard":{"text":false,"props":{"data":"string","height":"number"}},"flowchart":{"text":false,"webOnly":true,"props":{"data":"string","height":"number"}},"audio":{"text":false,"webOnly":true,"props":{"fileId":"string","name":"string","size":"number","mimeType":"string","duration":"number"}}}} as const;
