import { normalizeBrazilianPhone, normalizeImportedPhone } from "./phone.js";

const acceptedHeaders = new Set(["telefone", "numero", "número", "phone", "whatsapp"]);

export type CsvPreviewRow = {
  line: number;
  input: string;
  phone: string | null;
  status: "valid" | "invalid" | "duplicate_file";
  reason: string | null;
};

export function parsePhoneList(content: string): CsvPreviewRow[] {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length === 0) return [];
  const delimiter = guessDelimiter(lines[0] ?? "");
  const firstCells = splitLine(lines[0] ?? "", delimiter);
  const headerIndex = firstCells.findIndex((cell) => acceptedHeaders.has(cleanHeader(cell)));
  const startIndex = headerIndex >= 0 ? 1 : 0;
  const phoneIndex = headerIndex >= 0 ? headerIndex : 0;
  const seen = new Set<string>();
  const rows: CsvPreviewRow[] = [];

  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const input = splitLine(line, delimiter)[phoneIndex]?.trim() ?? "";
    const result = /^\+|^00|^55/.test(input) ? normalizeImportedPhone(input) : normalizeBrazilianPhone(input);
    if (!result.valid || !result.normalized) {
      rows.push({ line: index + 1, input, phone: null, status: "invalid", reason: result.reason });
    } else if (seen.has(result.normalized)) {
      rows.push({ line: index + 1, input, phone: result.normalized, status: "duplicate_file", reason: "Duplicado no arquivo." });
    } else {
      seen.add(result.normalized);
      rows.push({ line: index + 1, input, phone: result.normalized, status: "valid", reason: null });
    }
  }
  return rows;
}

function cleanHeader(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, "").toLocaleLowerCase("pt-BR");
}

function guessDelimiter(line: string): string {
  if (line.includes(";")) return ";";
  if (line.includes("\t")) return "\t";
  return ",";
}

function splitLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') { value += '"'; i += 1; } else quoted = !quoted;
    } else if (char === delimiter && !quoted) { cells.push(value); value = ""; }
    else value += char;
  }
  cells.push(value);
  return cells;
}
