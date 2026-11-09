import { isValidCnpj, isValidCpf, maskPii } from './pii-masker';

// Test values only: valid check digits, not real people or companies.
const CPF = '529.982.247-25';
const CPF_BARE = '52998224725';
const CNPJ = '11.222.333/0001-81';
const CNPJ_BARE = '11222333000181';
const CNPJ_ALPHANUMERIC = '12.ABC.345/01DE-35';

describe('maskPii', () => {
  it.each([
    ['CPF formatted', `CPF ${CPF}.`, 'CPF [CPF].'],
    ['CPF bare (valid check digits)', `CPF ${CPF_BARE}`, 'CPF [CPF]'],
    ['CPF formatted with wrong digits (privacy first)', 'CPF 123.456.789-00', 'CPF [CPF]'],
    ['CNPJ formatted', `CNPJ ${CNPJ}`, 'CNPJ [CNPJ]'],
    ['CNPJ bare', `CNPJ ${CNPJ_BARE}`, 'CNPJ [CNPJ]'],
    ['CNPJ alphanumeric', `CNPJ ${CNPJ_ALPHANUMERIC}`, 'CNPJ [CNPJ]'],
    ['e-mail', 'Fale com ana.silva+rh@acme.com.br hoje', 'Fale com [EMAIL] hoje'],
    ['mobile with country code', 'Tel: +55 (11) 98765-4321', 'Tel: [TELEFONE]'],
    ['mobile with area code', 'Tel: (11) 98765-4321', 'Tel: [TELEFONE]'],
    ['landline with area code', 'Tel: 11 3456-7890', 'Tel: [TELEFONE]'],
    ['phone without punctuation', 'Tel: 11987654321', 'Tel: [TELEFONE]'],
  ])('masks %s', (_case, input, expected) => {
    expect(maskPii(input).text).toBe(expected);
  });

  it.each([
    ['amounts', 'Limite de R$ 1.234,56 por mês'],
    ['dates and year ranges', 'Vigência 2026-11-09, ciclo 2025-2026'],
    ['a bare 11-digit number with invalid CPF digits', 'Pedido 12345678900'],
    ['short numbers and codes', 'Sala 1203, ramal 4521, CEP 01310-100'],
    ['words with letters and digits', 'Versão ABCDEFGHIJKL12 do manual'],
  ])('keeps %s', (_case, input) => {
    expect(maskPii(input).text).toBe(input);
  });

  it('counts each kind and masks several values in one text', () => {
    const result = maskPii(`${CPF} / ${CPF_BARE}, ${CNPJ}, a@b.co, (21) 2345-6789`);
    expect(result.text).toBe('[CPF] / [CPF], [CNPJ], [EMAIL], [TELEFONE]');
    expect(result.counts).toEqual({ CPF: 2, CNPJ: 1, EMAIL: 1, PHONE: 1 });
  });
});

describe('check digits', () => {
  it('validates CPF', () => {
    expect(isValidCpf(CPF)).toBe(true);
    expect(isValidCpf('529.982.247-24')).toBe(false);
    expect(isValidCpf('111.111.111-11')).toBe(false);
  });

  it('validates numeric and alphanumeric CNPJ', () => {
    expect(isValidCnpj(CNPJ)).toBe(true);
    expect(isValidCnpj(CNPJ_ALPHANUMERIC)).toBe(true);
    expect(isValidCnpj('11.222.333/0001-80')).toBe(false);
    expect(isValidCnpj('00.000.000/0000-00')).toBe(false);
  });
});
