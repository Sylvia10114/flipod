import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const COPY_PATH = path.join(ROOT, 'src/i18n/ui-copy.json');
const EXPECTED_LOCALES = [
  'english',
  'simplified_chinese',
  'traditional_chinese',
  'japanese',
  'korean',
  'spanish',
  'french',
  'brazilian_portuguese',
  'italian',
  'german',
];

function flatten(node, prefix = '', target = {}) {
  for (const [key, value] of Object.entries(node)) {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      flatten(value, nextKey, target);
    } else {
      target[nextKey] = value;
    }
  }
  return target;
}

function placeholders(value) {
  return Array.from(String(value).matchAll(/\{(\w+)\}/g), match => match[1]).sort();
}

function fail(messages) {
  console.error('UI i18n check failed:');
  for (const message of messages) {
    console.error(`- ${message}`);
  }
  process.exit(1);
}

const payload = JSON.parse(fs.readFileSync(COPY_PATH, 'utf8'));
const locales = Object.keys(payload);
const errors = [];

for (const locale of EXPECTED_LOCALES) {
  if (!locales.includes(locale)) {
    errors.push(`missing locale "${locale}"`);
  }
}

for (const locale of locales) {
  if (!EXPECTED_LOCALES.includes(locale)) {
    errors.push(`unexpected locale "${locale}"`);
  }
}

if (errors.length > 0) {
  fail(errors);
}

const base = flatten(payload.english);
const baseKeys = Object.keys(base).sort();

for (const locale of EXPECTED_LOCALES) {
  const flattened = flatten(payload[locale]);
  const keys = Object.keys(flattened).sort();

  for (const key of baseKeys) {
    if (!(key in flattened)) {
      errors.push(`${locale}: missing key "${key}"`);
      continue;
    }
    const value = flattened[key];
    if (typeof value !== 'string' || value.trim().length === 0) {
      errors.push(`${locale}: empty value for "${key}"`);
      continue;
    }
    const expectedPlaceholders = placeholders(base[key]).join(',');
    const actualPlaceholders = placeholders(value).join(',');
    if (expectedPlaceholders !== actualPlaceholders) {
      errors.push(
        `${locale}: placeholder mismatch for "${key}" (expected "${expectedPlaceholders}", got "${actualPlaceholders}")`
      );
    }
  }

  for (const key of keys) {
    if (!baseKeys.includes(key)) {
      errors.push(`${locale}: unexpected key "${key}"`);
    }
  }
}

if (errors.length > 0) {
  fail(errors);
}

console.log(`UI i18n check passed for ${EXPECTED_LOCALES.length} locales and ${baseKeys.length} keys.`);
