/**
 * Replaces Brazilian personal data with placeholders before any text leaves the API
 * (embeddings, LLM) or reaches a log. Privacy first: a formatted value is always masked;
 * a bare digit run is masked as CPF/CNPJ only when its check digits are valid, so ordinary
 * numbers (ids, amounts) are kept.
 */
export type PiiKind = 'EMAIL' | 'CNPJ' | 'CPF' | 'PHONE';

export const PII_PLACEHOLDERS: Record<PiiKind, string> = {
  EMAIL: '[EMAIL]',
  CNPJ: '[CNPJ]',
  CPF: '[CPF]',
  PHONE: '[TELEFONE]',
};

export interface MaskResult {
  text: string;
  counts: Record<PiiKind, number>;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
// Numeric or alphanumeric CNPJ (alphanumeric CNPJs are issued from July 2026): 12 characters
// plus 2 check digits, with optional punctuation.
const CNPJ =
  /(?<![A-Za-z0-9])[A-Z0-9]{2}\.?[A-Z0-9]{3}\.?[A-Z0-9]{3}\/?[A-Z0-9]{4}-?\d{2}(?![A-Za-z0-9])/gi;
const CPF = /(?<![\w./-])\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?![\w])/g;
// Area code required (with or without +55): a bare "1234-5678" is too often not a phone.
const PHONE = /(?<![\w+])(?:\+55[\s.-]?)?(?:\(\d{2}\)|\d{2})[\s.-]?9?\d{4}[\s.-]?\d{4}(?![\w])/g;

export function maskPii(text: string): MaskResult {
  const counts: Record<PiiKind, number> = { EMAIL: 0, CNPJ: 0, CPF: 0, PHONE: 0 };
  const replace = (input: string, pattern: RegExp, kind: PiiKind, accept: (m: string) => boolean) =>
    input.replace(pattern, (match) => {
      if (!accept(match)) return match;
      counts[kind]++;
      return PII_PLACEHOLDERS[kind];
    });

  // Order matters: e-mails first (they may contain digits), then the longer identifiers.
  let masked = replace(text, EMAIL, 'EMAIL', () => true);
  masked = replace(masked, CNPJ, 'CNPJ', (m) => hasDigit(m) && (isFormatted(m) || isValidCnpj(m)));
  masked = replace(masked, CPF, 'CPF', (m) => isFormatted(m) || isValidCpf(m));
  masked = replace(masked, PHONE, 'PHONE', () => true);
  return { text: masked, counts };
}

export function totalMasked(counts: Record<PiiKind, number>): number {
  return Object.values(counts).reduce((sum, n) => sum + n, 0);
}

function hasDigit(value: string): boolean {
  return /\d/.test(value);
}

function isFormatted(value: string): boolean {
  return /[./-]/.test(value);
}

export function isValidCpf(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) return false;
  const numbers = [...digits].map(Number);
  const checkDigit = (length: number) => {
    const sum = numbers.slice(0, length).reduce((acc, n, i) => acc + n * (length + 1 - i), 0);
    return ((sum * 10) % 11) % 10;
  };
  return checkDigit(9) === numbers[9] && checkDigit(10) === numbers[10];
}

/** Receita Federal rule, valid for numeric and alphanumeric CNPJs (value = char code - 48). */
export function isValidCnpj(value: string): boolean {
  const chars = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (chars.length !== 14 || !/^\d{2}$/.test(chars.slice(12)) || /^(.)\1{13}$/.test(chars)) {
    return false;
  }
  const values = [...chars].map((c) => c.charCodeAt(0) - 48);
  const checkDigit = (length: number) => {
    const weights =
      length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((acc, weight, i) => acc + weight * (values[i] ?? 0), 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return checkDigit(12) === values[12] && checkDigit(13) === values[13];
}
