import type { McpElicitationField } from "@bb/domain";

type ElicitationValue = string | number | boolean;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function fieldOptions(
  raw: Record<string, unknown>,
): McpElicitationField["options"] {
  if (Array.isArray(raw.enum)) {
    const names = Array.isArray(raw.enumNames) ? raw.enumNames : [];
    return raw.enum
      .filter((item): item is string => typeof item === "string")
      .map((value, index) => {
        const label = names[index];
        return { value, label: typeof label === "string" ? label : value };
      });
  }
  if (Array.isArray(raw.oneOf)) {
    return raw.oneOf.filter(isRecord).flatMap((item) => {
      if (typeof item.const !== "string") return [];
      return [
        { value: item.const, label: optionalText(item.title) ?? item.const },
      ];
    });
  }
  return null;
}

export function elicitationFields(
  requestedSchema: unknown,
): McpElicitationField[] | null {
  if (!isRecord(requestedSchema) || !isRecord(requestedSchema.properties))
    return null;
  const required = new Set(
    Array.isArray(requestedSchema.required)
      ? requestedSchema.required.filter(
          (item): item is string => typeof item === "string",
        )
      : [],
  );
  const fields: McpElicitationField[] = [];
  for (const [name, raw] of Object.entries(requestedSchema.properties)) {
    if (!isRecord(raw)) return null;
    const type = raw.type;
    if (
      type !== "string" &&
      type !== "number" &&
      type !== "integer" &&
      type !== "boolean"
    ) {
      if (required.has(name)) return null;
      continue;
    }
    const fallback = raw.default;
    fields.push({
      name,
      title: optionalText(raw.title),
      description: optionalText(raw.description),
      type,
      options: fieldOptions(raw),
      required: required.has(name),
      defaultValue:
        typeof fallback === "string" ||
        typeof fallback === "number" ||
        typeof fallback === "boolean"
          ? fallback
          : null,
    });
  }
  return fields;
}

function fieldAccepts(
  field: McpElicitationField,
  value: ElicitationValue,
): boolean {
  if (field.type === "boolean") return typeof value === "boolean";
  if (field.type === "string") {
    return (
      typeof value === "string" &&
      (!field.options || field.options.some((option) => option.value === value))
    );
  }
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  return field.type === "number" || Number.isInteger(value);
}

export function validElicitationContent(
  fields: readonly McpElicitationField[],
  content: Readonly<Record<string, ElicitationValue>>,
): Record<string, ElicitationValue> | null {
  const result: Record<string, ElicitationValue> = {};
  for (const field of fields) {
    const value = content[field.name];
    if (value === undefined || value === "") {
      if (field.required) return null;
      continue;
    }
    if (!fieldAccepts(field, value)) return null;
    result[field.name] = value;
  }
  return result;
}
