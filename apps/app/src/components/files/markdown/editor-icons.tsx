import type { IconType } from "react-icons";
import {
  PiCaretDownBold,
  PiCheckBold,
  PiCodeBold,
  PiImageBold,
  PiLinkBold,
  PiListBulletsBold,
  PiListNumbersBold,
  PiMinusBold,
  PiNotePencilBold,
  PiParagraphBold,
  PiPlusBold,
  PiQuotesBold,
  PiTableBold,
  PiTextBBold,
  PiTextHOneBold,
  PiTextHThreeBold,
  PiTextHTwoBold,
  PiTextItalicBold,
  PiTextStrikethroughBold,
  PiTextTSlashBold,
  PiXBold,
  PiXCircleBold,
} from "react-icons/pi";

const EDITOR_ICONS = {
  Bold: PiTextBBold,
  Check: PiCheckBold,
  ChevronDown: PiCaretDownBold,
  CircleX: PiXCircleBold,
  Code: PiCodeBold,
  Heading1: PiTextHOneBold,
  Heading2: PiTextHTwoBold,
  Heading3: PiTextHThreeBold,
  Image: PiImageBold,
  Italic: PiTextItalicBold,
  Link: PiLinkBold,
  List: PiListBulletsBold,
  ListOrdered: PiListNumbersBold,
  MessageSquarePlus: PiNotePencilBold,
  Minus: PiMinusBold,
  Pilcrow: PiParagraphBold,
  Plus: PiPlusBold,
  Quote: PiQuotesBold,
  Strikethrough: PiTextStrikethroughBold,
  Table: PiTableBold,
  TextClear: PiTextTSlashBold,
  X: PiXBold,
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
