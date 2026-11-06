// Fails if .env.example contains a real-looking secret.
// .env.example is committed and public: secrets must stay empty (or a placeholder).
import { readFileSync } from 'node:fs';

const SECRET_KEY = /(SECRET|PASSWORD|API_KEY|TOKEN)$/;
const ALLOWED_VALUES = new Set(['', 'change-me']);

const lines = readFileSync(new URL('../.env.example', import.meta.url), 'utf8').split('\n');
const offenders = [];

lines.forEach((line, index) => {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (!match) return;
  const [, key, rawValue] = match;
  const value = rawValue.trim().replace(/^["']|["']$/g, '');
  if (SECRET_KEY.test(key) && !ALLOWED_VALUES.has(value)) {
    offenders.push(`  line ${index + 1}: ${key}`); // never print the value itself
  }
});

if (offenders.length > 0) {
  console.error(
    `.env.example must not contain secret values (use an empty value or "change-me"):\n${offenders.join('\n')}`,
  );
  process.exit(1);
}
console.log('.env.example: no secret values found');
