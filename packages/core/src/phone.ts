export type PhoneValidation = {
  input: string;
  normalized: string | null;
  valid: boolean;
  reason: string | null;
};

export function normalizeImportedPhone(input: string): PhoneValidation {
  const raw = String(input ?? '').trim();
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (!/^\d{7,15}$/.test(digits)) return invalid(raw, 'Quantidade de dígitos inválida.');
  return { input: raw, normalized: digits, valid: true, reason: null };
}

export function normalizeBrazilianPhone(input: string): PhoneValidation {
  const raw = String(input ?? "").trim();
  const spreadsheetValue = raw.replace(/^\s*[='"]+|['"]+\s*$/g, "").trim();
  let digits = expandScientificNotation(spreadsheetValue) ?? spreadsheetValue.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0") && (digits.length === 13 || digits.length === 14)) digits = digits.slice(3);
  else if (digits.startsWith("0") && (digits.length === 11 || digits.length === 12)) digits = digits.slice(1);
  if (!digits.startsWith("55") && (digits.length === 10 || digits.length === 11)) digits = `55${digits}`;
  if (!digits.startsWith("55")) return invalid(raw, "Somente números brasileiros são aceitos.");
  let national = digits.slice(2);
  if (national.length !== 10 && national.length !== 11) return invalid(raw, "Quantidade de dígitos inválida.");
  const areaCode = national.slice(0, 2);
  if (!validAreaCodes.has(areaCode)) return invalid(raw, "DDD inválido.");
  if (/^(\d)\1+$/.test(national)) return invalid(raw, "Número repetitivo inválido.");
  let subscriber = national.slice(2);
  if (subscriber.length === 8 && /^[6-9]/.test(subscriber)) subscriber = `9${subscriber}`;
  if (subscriber.length === 9 && subscriber[0] !== "9") return invalid(raw, "Celular deve começar com 9.");
  if (subscriber.length === 8 && !/^[2-5]/.test(subscriber)) return invalid(raw, "Prefixo de telefone fixo inválido.");
  national = `${areaCode}${subscriber}`;
  return { input: raw, normalized: `55${national}`, valid: true, reason: null };
}

const validAreaCodes = new Set("11 12 13 14 15 16 17 18 19 21 22 24 27 28 31 32 33 34 35 37 38 41 42 43 44 45 46 47 48 49 51 53 54 55 61 62 63 64 65 66 67 68 69 71 73 74 75 77 79 81 82 83 84 85 86 87 88 89 91 92 93 94 95 96 97 98 99".split(" "));

function expandScientificNotation(value: string): string | null {
  const match = value.match(/^\+?(\d+)(?:\.(\d+))?[eE]\+?(\d+)$/);
  if (!match) return null;
  const integer = match[1]!;
  const fraction = match[2] ?? "";
  const exponent = Number(match[3]);
  if (!Number.isSafeInteger(exponent) || exponent > 20) return null;
  const digits = `${integer}${fraction}`;
  const decimalPosition = integer.length + exponent;
  if (decimalPosition < digits.length && /[1-9]/.test(digits.slice(decimalPosition))) return null;
  return decimalPosition >= digits.length ? digits.padEnd(decimalPosition, "0") : digits.slice(0, decimalPosition);
}

function invalid(input: string, reason: string): PhoneValidation {
  return { input, normalized: null, valid: false, reason };
}

export function isOptOutText(text: string): boolean {
  const normalized = text.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  if (/^(pare|parar|sair|stop)$/.test(normalized)) return true;
  return /\b(nao (?:me )?(?:chame|contate|mande mais|envie mais)|nao quero (?:mais )?(?:mensagens|receber mensagens|contato)|pare de (?:me )?(?:chamar|mandar|enviar)|remova (?:meu contato|meu numero|me da lista)|retire (?:meu contato|meu numero|me da lista)|apague (?:meu contato|meu numero)|bloqueie (?:meu contato|este contato)|cancel(?:e|ar) (?:o )?contato)\b/.test(normalized);
}

export function isExplicitNoInterestText(text: string): boolean {
  const normalized = text.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  return /^(?:nao(?: tchau)?|tchau(?: nao)?|nao quero|nao quero nenhum servico|nao quero servico|nao tenho interesse|nao quero agora)$/.test(normalized)
    || /\b(nao tenho interesse|agora nao quero|nao quero agora|nao faz sentido|ja tenho (?:um )?sistema(?: e)? nao quero trocar|obrigad[oa] mas nao tenho interesse)\b/.test(normalized);
}

const dddToState: Record<string, string> = {
  "11": "São Paulo", "12": "São Paulo", "13": "São Paulo", "14": "São Paulo", "15": "São Paulo", "16": "São Paulo", "17": "São Paulo", "18": "São Paulo", "19": "São Paulo",
  "21": "Rio de Janeiro", "22": "Rio de Janeiro", "24": "Rio de Janeiro", "27": "Espírito Santo", "28": "Espírito Santo",
  "31": "Minas Gerais", "32": "Minas Gerais", "33": "Minas Gerais", "34": "Minas Gerais", "35": "Minas Gerais", "37": "Minas Gerais", "38": "Minas Gerais",
  "41": "Paraná", "42": "Paraná", "43": "Paraná", "44": "Paraná", "45": "Paraná", "46": "Paraná", "47": "Santa Catarina", "48": "Santa Catarina", "49": "Santa Catarina",
  "51": "Rio Grande do Sul", "53": "Rio Grande do Sul", "54": "Rio Grande do Sul", "55": "Rio Grande do Sul", "61": "Distrito Federal", "62": "Goiás", "63": "Tocantins", "64": "Goiás",
  "65": "Mato Grosso", "66": "Mato Grosso", "67": "Mato Grosso do Sul", "68": "Acre", "69": "Rondônia", "71": "Bahia", "73": "Bahia", "74": "Bahia", "75": "Bahia", "77": "Bahia",
  "79": "Sergipe", "81": "Pernambuco", "82": "Alagoas", "83": "Paraíba", "84": "Rio Grande do Norte", "85": "Ceará", "86": "Piauí", "87": "Pernambuco", "88": "Ceará", "89": "Piauí",
  "91": "Pará", "92": "Amazonas", "93": "Pará", "94": "Pará", "95": "Roraima", "96": "Amapá", "97": "Amazonas", "98": "Maranhão", "99": "Maranhão",
};

export function regionFromBrazilianPhone(phone: string) {
  const digits = phone.replace(/\D/g, "").replace(/^55/, "");
  return dddToState[digits.slice(0, 2)] ?? null;
}
