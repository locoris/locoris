import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

const root = process.cwd();
const sourceRoot = path.join(root, "apps/app/src");
const localeRoot = path.join(sourceRoot, "locales");
const localizationRoot = path.join(sourceRoot, "localization");
const failures = [];
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(entryPath));
    else files.push(entryPath);
  }

  return files;
}

function report(file, message) {
  failures.push(`${path.relative(root, file)}: ${message}`);
}

function propertyName(node) {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) {
    return node.text;
  }

  return null;
}

function staticString(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }

  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticString(node.left);
    const right = staticString(node.right);
    return left === null || right === null ? null : left + right;
  }

  return null;
}

function flattenObject(node, prefix = "", messages = new Map()) {
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property)) {
      continue;
    }

    const name = propertyName(property.name);

    if (!name) {
      continue;
    }

    const key = prefix ? `${prefix}.${name}` : name;

    if (ts.isObjectLiteralExpression(property.initializer)) {
      flattenObject(property.initializer, key, messages);
      continue;
    }

    const value = staticString(property.initializer);

    if (value !== null) {
      messages.set(key, value);
    }
  }

  return messages;
}

async function readCatalog(file, variableName) {
  const source = await readFile(file, "utf8");
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let catalog = null;

  sourceFile.forEachChild((node) => {
    if (!ts.isVariableStatement(node)) {
      return;
    }

    for (const declaration of node.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name)
        && declaration.name.text === variableName
        && declaration.initializer
      ) {
        let initializer = declaration.initializer;

        if (ts.isAsExpression(initializer) || ts.isSatisfiesExpression(initializer)) {
          initializer = initializer.expression;
        }

        if (ts.isObjectLiteralExpression(initializer)) {
          catalog = flattenObject(initializer);
        }
      }
    }
  });

  if (!catalog) {
    report(file, `could not read the ${variableName} catalog`);
    return new Map();
  }

  return catalog;
}

function interpolationVariables(value) {
  return new Set(
    [...value.matchAll(/\{\{-?\s*([^},\s]+)[^}]*\}\}/g)].map((match) => match[1])
  );
}

function sameSet(left, right) {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function describeSet(values) {
  return [...values].sort().join(", ") || "none";
}

function validateEmptyStrings(file, messages) {
  for (const [key, value] of messages) {
    if (!value.trim()) {
      report(file, `message ${key} is empty`);
    }
  }
}

function validateSharedInterpolations(referenceFile, reference, candidateFile, candidate) {
  for (const [key, referenceValue] of reference) {
    const candidateValue = candidate.get(key);

    if (candidateValue === undefined) {
      report(candidateFile, `missing message ${key}`);
      continue;
    }

    const referenceVariables = interpolationVariables(referenceValue);
    const candidateVariables = interpolationVariables(candidateValue);

    if (!sameSet(referenceVariables, candidateVariables)) {
      report(
        candidateFile,
        `message ${key} interpolation mismatch; expected [${describeSet(referenceVariables)}], received [${describeSet(candidateVariables)}]`
      );
    }
  }

  for (const key of candidate.keys()) {
    if (reference.has(key)) {
      continue;
    }

    const pluralMatch = key.match(PLURAL_SUFFIX);
    const pluralBase = pluralMatch ? key.slice(0, -pluralMatch[0].length) : null;
    const isLocalePluralExtension =
      pluralBase !== null
      && (reference.has(`${pluralBase}_one`) || reference.has(`${pluralBase}_other`));

    if (!isLocalePluralExtension) {
      report(candidateFile, `unknown message ${key} compared with ${path.basename(referenceFile)}`);
    }
  }
}

const nonInflectedCountKeys = new Set([
  "selectionCount",
  "selectedCount",
  "aiMoreCommands",
  "aiPreviewSelectionCount",
  "statusPending",
  "statusUnlockRequiredPending",
  "statusOfflinePending",
  "statusUnavailablePending",
  "statusErrorPending",
  "statusAuthRequiredPending",
  "accountCloudConnectedCount",
  "plannerClearDataDetailTasks",
  "plannerClearDataDetailHabits",
  "plannerClearDataDetailHabitLogs",
  "plannerClearDataDetailGoals",
  "plannerClearDataDetailTimeBlocks"
]);

function validatePlurals(file, locale, messages) {
  const requiredCategories = new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
  const pluralBases = new Set();

  for (const [key, value] of messages) {
    if (!interpolationVariables(value).has("count")) {
      continue;
    }

    const match = key.match(PLURAL_SUFFIX);
    const base = match ? key.slice(0, -match[0].length) : key;
    const leaf = base.split(".").at(-1) ?? base;

    if (!nonInflectedCountKeys.has(leaf)) {
      pluralBases.add(base);
    }
  }

  for (const base of pluralBases) {
    const categoryMessages = [];

    for (const category of requiredCategories) {
      const key = `${base}_${category}`;
      const value = messages.get(key);

      if (value === undefined) {
        report(file, `count message ${base} is missing _${category}`);
        continue;
      }

      categoryMessages.push([key, value]);
    }

    const referenceEntry = categoryMessages[0];

    if (!referenceEntry) {
      continue;
    }

    const referenceVariables = interpolationVariables(referenceEntry[1]);

    for (const [key, value] of categoryMessages.slice(1)) {
      const variables = interpolationVariables(value);

      if (!sameSet(referenceVariables, variables)) {
        report(
          file,
          `plural message ${key} interpolation mismatch; expected [${describeSet(referenceVariables)}], received [${describeSet(variables)}]`
        );
      }
    }
  }
}

const sourceFiles = (await walk(sourceRoot)).filter(
  (file) => /\.(ts|tsx)$/.test(file) && !file.startsWith(localeRoot)
    && !file.startsWith(localizationRoot)
);

for (const file of sourceFiles) {
  const source = await readFile(file, "utf8");
  if (/\b(?:language|locale|appLanguage|currentAppLanguage)\s*[!=]==?\s*["'](?:ru|en)["']/.test(source)) {
    report(file, "contains a language-specific code branch; move the value into a locale pack");
  }
  if (/\b(?:ru-RU|en-US)\b/.test(source)) {
    report(file, "contains a hard-coded regional locale; use LocaleRuntime.formatLocale");
  }
  if (/translateInline\([^\n]+\.["']?enUs/.test(source)) {
    report(file, "stores a regional locale inside the translation catalog");
  }
  if (/\b(?:new\s+)?Intl\.(?:Collator|DateTimeFormat|DisplayNames|ListFormat|Locale|NumberFormat|PluralRules|RelativeTimeFormat|getCanonicalLocales)\s*\(/.test(source)) {
    report(file, "uses Intl.* directly; add or use a formatter in apps/app/src/localization");
  }
}

const allLocaleFiles = (await readdir(localeRoot)).filter((file) => file.endsWith(".ts"));
const localeFiles = allLocaleFiles.filter((file) => !["en.ts", "en-XA.ts"].includes(file));

for (const localeFile of allLocaleFiles) {
  const file = path.join(localeRoot, localeFile);
  const source = await readFile(file, "utf8");
  if (!source.includes("defineLocalePack")) report(file, "must export a defineLocalePack() contract");
  if (!source.includes("meta:")) report(file, "locale pack is missing meta");
  if (!/\bmessages\s*[:,]/.test(source)) report(file, "locale pack is missing messages");
  if (!source.includes("blockNoteDictionary:")) report(file, "locale pack needs an explicit BlockNote dictionary loader");
}

for (const localeFile of localeFiles) {
  const file = path.join(localeRoot, localeFile);
  const source = await readFile(file, "utf8");
  if (!source.includes("satisfies AppLocaleMessages")) {
    report(file, "must satisfy AppLocaleMessages so missing and unknown keys fail typecheck");
  }
}

for (const localeFile of ["en.ts", ...localeFiles]) {
  const file = path.join(localeRoot, localeFile);
  const source = await readFile(file, "utf8");
  if (/\((?:s|es|a|as|o|os|а|ов|ы|и)\)/iu.test(source)) {
    report(file, "contains parenthesized manual pluralization; use i18next plural keys");
  }
}

const englishFile = path.join(localeRoot, "en.ts");
const englishMessages = await readCatalog(englishFile, "messages");
const englishInlineFile = path.join(localeRoot, "inline/en.ts");
const englishInline = await readCatalog(englishInlineFile, "enInline");

validateEmptyStrings(englishFile, englishMessages);
validateEmptyStrings(englishInlineFile, englishInline);
validatePlurals(englishFile, "en", englishMessages);

for (const localeFile of localeFiles) {
  const locale = localeFile.replace(/\.ts$/, "");
  const file = path.join(localeRoot, localeFile);
  const messages = await readCatalog(file, "messages");
  const localeSource = await readFile(file, "utf8");
  const fallbackSections = [
    ...localeSource.matchAll(/\.\.\.en\.messages\.([A-Za-z0-9_]+)/g)
  ].map((match) => match[1]);
  for (const section of fallbackSections) {
    const prefix = `${section}.`;
    for (const [key, value] of englishMessages) {
      if (key.startsWith(prefix) && !messages.has(key)) {
        messages.set(key, value);
      }
    }
  }
  const inlineFile = path.join(localeRoot, `inline/${localeFile}`);
  const inlineVariable = `${locale.replace(/[^a-zA-Z0-9]/g, "")}Inline`;
  const inlineMessages = await readCatalog(inlineFile, inlineVariable);

  validateEmptyStrings(file, messages);
  validateEmptyStrings(inlineFile, inlineMessages);
  validateSharedInterpolations(englishFile, englishMessages, file, messages);
  validateSharedInterpolations(englishInlineFile, englishInline, inlineFile, inlineMessages);
  validatePlurals(file, locale, messages);
}

if (failures.length > 0) {
  console.error(`Localization checks failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
  process.exit(1);
}

console.log(`Localization checks passed (${localeFiles.length + 2} locale packs, ${englishInline.size} inline messages).`);
