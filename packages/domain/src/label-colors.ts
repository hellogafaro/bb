import { z } from "zod";

export const LABEL_COLOR_COUNT = 24;

export const labelColorSchema = z.number().int().min(1).max(LABEL_COLOR_COUNT);

export function labelColorForKey(key: string): number {
  let hash = 0;
  for (let index = 0; index < key.length; index++) {
    hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  }
  return (hash % LABEL_COLOR_COUNT) + 1;
}
