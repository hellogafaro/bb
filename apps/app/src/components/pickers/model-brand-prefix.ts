import type { PickerOption } from "./OptionPicker";

export interface ProviderPickerOption extends PickerOption<string> {
  brandPrefix?: string;
  planModeCopy?: string;
  installUrl?: string;
}

export function stripModelBrandPrefix(
  label: string,
  brandPrefix: string | undefined,
): string {
  if (brandPrefix === undefined || brandPrefix.length === 0) {
    return label;
  }
  return label.toLowerCase().startsWith(brandPrefix.toLowerCase())
    ? label.slice(brandPrefix.length).trimStart()
    : label;
}

const MODEL_LABEL_TAG_PATTERN = /^(.*\S)\s*\(([^()]+)\)$/u;

export function splitModelLabelTag(label: string): {
  base: string;
  tag: string | null;
} {
  const match = label.match(MODEL_LABEL_TAG_PATTERN);
  return match ? { base: match[1], tag: match[2] } : { base: label, tag: null };
}
