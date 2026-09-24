import type { IconType } from "react-icons";
import {
  RiAddLine,
  RiArrowDownSLine,
  RiBold,
  RiChatNewLine,
  RiCheckLine,
  RiCloseCircleLine,
  RiCloseLine,
  RiCodeSSlashLine,
  RiDoubleQuotesL,
  RiFormatClear,
  RiH1,
  RiH2,
  RiH3,
  RiImageLine,
  RiItalic,
  RiLink,
  RiListOrdered,
  RiListUnordered,
  RiParagraph,
  RiStrikethrough,
  RiSubtractLine,
  RiTableLine,
} from "react-icons/ri";

const EDITOR_ICONS = {
  Bold: RiBold,
  Check: RiCheckLine,
  ChevronDown: RiArrowDownSLine,
  CircleX: RiCloseCircleLine,
  Code: RiCodeSSlashLine,
  Heading1: RiH1,
  Heading2: RiH2,
  Heading3: RiH3,
  Image: RiImageLine,
  Italic: RiItalic,
  Link: RiLink,
  List: RiListUnordered,
  ListOrdered: RiListOrdered,
  MessageSquarePlus: RiChatNewLine,
  Minus: RiSubtractLine,
  Pilcrow: RiParagraph,
  Plus: RiAddLine,
  Quote: RiDoubleQuotesL,
  Strikethrough: RiStrikethrough,
  Table: RiTableLine,
  TextClear: RiFormatClear,
  X: RiCloseLine,
} as const satisfies Record<string, IconType>;

export type EditorIconName = keyof typeof EDITOR_ICONS;

export function EditorIcon({
  name,
  className,
  "aria-hidden": ariaHidden,
}: {
  name: EditorIconName;
  className?: string;
  "aria-hidden"?: boolean;
}) {
  const Glyph = EDITOR_ICONS[name];
  return <Glyph className={className} aria-hidden={ariaHidden} />;
}
