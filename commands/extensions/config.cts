import fs from 'node:fs';
import ts from 'typescript';
type ConfigValue = string | number | boolean | null | ConfigValue[] | { [key: string]: ConfigValue };
export type ExtensionConfig = { [key: string]: ConfigValue; enabled: boolean };
function readConfig(filename: string): ExtensionConfig {
  const source = fs.readFileSync(filename, 'utf8');
  if (Buffer.byteLength(source) > 16384) throw new Error('Extension config is too large');
  const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if ((tree as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics.length || tree.statements.length !== 1 || !ts.isExportAssignment(tree.statements[0]) || tree.statements[0].isExportEquals) throw new Error('Extension config must contain one default literal export');
  function literal(node: ts.Node): ConfigValue {
    if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) return literal(node.expression);
    if (ts.isObjectLiteralExpression(node)) {
      const result: Record<string, ConfigValue> = Object.create(null);
      for (const item of node.properties) {
        if (!ts.isPropertyAssignment(item) || !(ts.isIdentifier(item.name) || ts.isStringLiteral(item.name))) throw new Error('Extension config accepts literal properties only');
        const key = item.name.text;
        if (['__proto__', 'prototype', 'constructor'].includes(key) || Object.hasOwn(result, key)) throw new Error('Invalid or duplicate extension config property');
        result[key] = literal(item.initializer);
      }
      return result;
    }
    if (ts.isArrayLiteralExpression(node)) return node.elements.map(literal);
    if (ts.isStringLiteral(node)) return node.text;
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (node.kind === ts.SyntaxKind.NullKeyword) return null;
    throw new Error('Extension config accepts literal values only');
  }
  const config = literal(tree.statements[0].expression);
  if (!config || Array.isArray(config) || typeof (config as { enabled?: unknown }).enabled !== 'boolean') throw new Error('Extension config needs a boolean enabled property');
  return config as ExtensionConfig;
}

export { readConfig };
