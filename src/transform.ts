import MagicString from 'magic-string';
import ts from 'typescript';

export interface PluginOptions {
  styleInjection?: 'inline' | 'global';
  include?: (string | RegExp)[];
  tsconfigPath?: string;
  jit?: boolean;
  isProduction?: boolean;
  minify?: boolean;
  aot?: boolean;
  fast?: boolean;
  fastMode?: 'full' | 'partial';
  zoneless?: boolean;
}

export interface TransformResult { code: string; map: any; }

import { minify, rootRequire, unwrap } from './utils';
import { DiskCache } from './cache';

export const minifyHtml = (h: string) => minify(h, true);
export const minifyCss = (c: string) => minify(c, false);
export const virtualStyleMap = new Map<string, string>();

const linkerCache = new Map<string, TransformResult | null>();
const diskCache = new DiskCache();

export async function applyLinker(code: string, id: string): Promise<TransformResult | null> {
  if (id.includes('node_modules')) {
    const cached = linkerCache.get(id);
    if (cached !== undefined) return cached;
  }
  const cacheKey = require('crypto')
    .createHash('sha256')
    .update(id)
    .update(code)
    .digest('hex');

  try {
    const cachedDisk = await diskCache.get(cacheKey);
    if (cachedDisk) {
      const parsed = JSON.parse(cachedDisk);
      if (id.includes('node_modules')) linkerCache.set(id, parsed);
      return parsed;
    }
  } catch {}

  try {
    const babel = unwrap(rootRequire('@babel/core'));
    const linkerPlugin = unwrap(rootRequire('@angular/compiler-cli/linker/babel'));
    const r = babel.transformSync(code, { filename: id, plugins: [linkerPlugin], sourceMaps: true, configFile: false, babelrc: false });
    const result = r?.code ? { code: r.code, map: r.map } : null;
    if (id.includes('node_modules')) linkerCache.set(id, result);
    if (result) {
      await diskCache.put(cacheKey, JSON.stringify(result));
    }
    return result;
  } catch (e: any) {
    console.warn(`[vite-plugin-angular] Linker failed on ${id}: ${e?.message}`);
    if (id.includes('node_modules')) linkerCache.set(id, null);
    return null;
  }
}

const DECORATOR_KEYWORDS = ['@Component', '@Directive', '@Injectable'] as const;
const hasDecorators = (code: string) => DECORATOR_KEYWORDS.some(d => code.includes(d));
export const hasPartialIvy = (code: string) => code.includes('ɵɵngDeclare');

const TS_OPTS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
  experimentalDecorators: true, emitDecoratorMetadata: true, isolatedModules: true, sourceMap: true,
};

const HMR_SNIPPET = `\n\nif (import.meta.hot) {\n  import.meta.hot.accept(() => {\n    try {\n      if (typeof ng !== 'undefined') {\n        document.querySelectorAll('[ng-version]').forEach(root => {\n          const ctx = ng.getContext?.(root) || ng.getOwningComponent?.(root);\n          if (ctx) ng.applyChanges(ctx);\n        });\n      }\n    } catch(e) { import.meta.hot.invalidate(); }\n  });\n}`;

const toEsm = (content: string): TransformResult =>
  ({ code: `export default ${JSON.stringify(content)};`, map: { mappings: '' } });

const extractEsmDefault = (code: string): string | null => {
  const m = code.match(/export default "([^"]*)";/);
  if (m) return JSON.parse(`"${m[1]}"`);
  try { return JSON.parse(code.match(/export default ([\s\S]+?);$/m)?.[1] ?? ''); } catch { return null; }
};

const handleStaticAsset = (code: string, isHtml: boolean, applyMinify: boolean): TransformResult | null =>
  applyMinify ? toEsm(minify(extractEsmDefault(code) ?? code, isHtml)) : null;

function getDecoratorObjectBlock(code: string, startIdx: number): { start: number; end: number; content: string } | null {
  const openBraceIdx = code.indexOf('{', startIdx);
  if (openBraceIdx === -1) return null;
  
  let braceCount = 1;
  let i = openBraceIdx + 1;
  while (i < code.length && braceCount > 0) {
    const char = code[i];
    if (char === '{') {
      braceCount++;
    } else if (char === '}') {
      braceCount--;
    }
    i++;
  }
  
  if (braceCount === 0) {
    return {
      start: openBraceIdx,
      end: i,
      content: code.slice(openBraceIdx + 1, i - 1)
    };
  }
  return null;
}

function processDecorators(s: MagicString, code: string, id: string, injection: 'inline' | 'global', imports: string[]): boolean {
  if (!code.includes('templateUrl') && !code.includes('styleUrls') && !code.includes('styleUrl') && !code.includes('styles')) return false;
  let changed = false, tplCount = 0, styleCount = 0;
  const componentKeyword = '@Component';
  let startIdx = 0;

  while ((startIdx = code.indexOf(componentKeyword, startIdx)) !== -1) {
    const block = getDecoratorObjectBlock(code, startIdx + componentKeyword.length);
    if (!block) {
      startIdx += componentKeyword.length;
      continue;
    }

    const { start, end, content: inner } = block;
    let modified = inner;

    const tmpl = /templateUrl\s*:\s*(['"`])(.*?)\1/.exec(inner);
    if (tmpl) {
      const varName = `__vite_angular_template_${tplCount++}`;
      imports.push(`import ${varName} from "${tmpl[2]}${/\.(md|pug)$/.test(tmpl[2]) ? '' : '?raw'}";`);
      modified = modified.replace(tmpl[0], `template: ${varName}`);
      changed = true;
    }

    const styleMatch = /styleUrls\s*:\s*\[([\s\S]*?)\]/.exec(modified);
    if (styleMatch) {
      const varNames: string[] = [];
      const strRx = /(['"`])(.*?)\1/g;
      let sm: RegExpExecArray | null;
      while ((sm = strRx.exec(styleMatch[1])) !== null) {
        if (injection === 'global') {
          imports.push(`import "${sm[2]}";`);
        } else {
          const v = `__vite_angular_style_${styleCount++}`;
          imports.push(`import ${v} from "${sm[2]}?inline";`);
          varNames.push(v);
        }
      }
      modified = injection === 'global'
        ? modified.replace(styleMatch[0], '').replace(/,\s*,/g, ',').replace(/,\s*([}])/g, '$1')
        : modified.replace(styleMatch[0], `styles: [${varNames.join(', ')}]`);
      changed = true;
    }

    const singleStyleMatch = /styleUrl\s*:\s*(['"`])(.*?)\1/.exec(modified);
    if (singleStyleMatch) {
      if (injection === 'global') {
        imports.push(`import "${singleStyleMatch[2]}";`);
        modified = modified.replace(singleStyleMatch[0], '').replace(/,\s*,/g, ',').replace(/,\s*([}])/g, '$1');
      } else {
        const v = `__vite_angular_style_${styleCount++}`;
        imports.push(`import ${v} from "${singleStyleMatch[2]}?inline";`);
        modified = modified.replace(singleStyleMatch[0], `styles: [${v}]`);
      }
      changed = true;
    }

    const stylesMatch = /styles\s*:\s*\[([\s\S]*?)\]/.exec(modified);
    if (stylesMatch) {
      const varNames: string[] = [];
      const strRx = /(['"`])([\s\S]*?)\1/g;
      let sm: RegExpExecArray | null;
      while ((sm = strRx.exec(stylesMatch[1])) !== null) {
        const cssContent = sm[2];
        const index = styleCount++;
        const virtualUri = `virtual:angular-style:${id.replace(/\\/g, '/')}:${index}.css`;
        virtualStyleMap.set(virtualUri, cssContent);
        
        const v = `__vite_angular_style_${index}`;
        imports.push(`import ${v} from "${virtualUri}?inline";`);
        varNames.push(v);
      }
      if (varNames.length > 0) {
        modified = modified.replace(stylesMatch[0], `styles: [${varNames.join(', ')}]`);
        changed = true;
      }
    }

    if (modified !== inner) {
      s.overwrite(start + 1, end - 1, modified);
    }
    startIdx = end;
  }
  return changed;
}

const SIGNAL_TYPES = ['input', 'model', 'output', 'viewChild', 'viewChildren', 'contentChild', 'contentChildren'] as const;
const QUERY_TYPES = ['viewChild', 'contentChild', 'viewChildren', 'contentChildren'] as const;

function getSignalTypeAndRequired(expr: ts.Expression): { type: string; required: boolean } | null {
  if (ts.isIdentifier(expr) && (SIGNAL_TYPES as readonly string[]).includes(expr.text))
    return { type: expr.text, required: false };
  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression) && ts.isIdentifier(expr.name) && expr.name.text === 'required' &&
      ['input', 'model', 'output', 'viewChild', 'contentChild'].includes(expr.expression.text))
    return { type: expr.expression.text, required: true };
  return null;
}

function getAliasFromOptions(optionsNode: ts.Expression): string | null {
  if (!ts.isObjectLiteralExpression(optionsNode)) return null;
  const p = optionsNode.properties.find(p => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'alias') as ts.PropertyAssignment | undefined;
  return p && ts.isStringLiteral(p.initializer) ? p.initializer.text : null;
}

function getOptionsNode(type: string, required: boolean, args: ts.NodeArray<ts.Expression>): ts.Expression | undefined {
  if (type === 'input' || type === 'model') return required ? args[0] : args[1];
  if (type === 'output') return args[0];
  if ((QUERY_TYPES as readonly string[]).includes(type)) return args[1];
  return undefined;
}

function emitSignalMetadata(type: string, propName: string, aliasValue: string | null, args: ts.NodeArray<ts.Expression>,
    sourceFile: ts.SourceFile, entries: string[], imports: Set<string>) {
  const mkInput = (alias?: string) => alias
    ? `${propName}: [{ type: __VITE_Input__, args: ['${alias}', { isSignal: true }] }]`
    : `${propName}: [{ type: __VITE_Input__, args: [{ isSignal: true }] }]`;

  if (type === 'input') {
    imports.add('Input');
    entries.push(mkInput(aliasValue ?? undefined));
  } else if (type === 'model') {
    imports.add('Input'); imports.add('Output');
    entries.push(mkInput(aliasValue ?? undefined));
    const outAlias = aliasValue ? `${aliasValue}Change` : `${propName}Change`;
    entries.push(aliasValue
      ? `${propName}Change: [{ type: __VITE_Output__, args: ['${outAlias}'] }]`
      : `${propName}Change: [{ type: __VITE_Output__, args: [] }]`);
  } else if (type === 'output') {
    imports.add('Output');
    entries.push(aliasValue
      ? `${propName}: [{ type: __VITE_Output__, args: ['${aliasValue}'] }]`
      : `${propName}: [{ type: __VITE_Output__, args: [] }]`);
  } else {
    const selector = args.length >= 1 ? args[0].getText(sourceFile) : 'undefined';
    const decType = type === 'viewChild' ? 'ViewChild' : type === 'viewChildren' ? 'ViewChildren' : type === 'contentChild' ? 'ContentChild' : 'ContentChildren';
    imports.add(decType);
    entries.push(`${propName}: [{ type: __VITE_${decType}__, args: [${selector}, { isSignal: true }] }]`);
  }
}

function processJitSignals(s: MagicString, code: string, id: string): boolean {
  if (!code.includes('@Component') && !code.includes('@Directive')) return false;
  const sourceFile = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true);
  let changed = false;
  const importsToInject = new Set<string>();

  function visit(node: ts.Node) {
    if (ts.isClassDeclaration(node) && node.name) {
      const className = node.name.text;
      const decorators = (ts.canHaveDecorators?.(node) ? ts.getDecorators(node) : (node as any).decorators) || [];
      const hasNgDec = decorators.some((dec: any) => {
        let expr = dec.expression;
        if (ts.isCallExpression(expr)) expr = expr.expression;
        return ts.isIdentifier(expr) && (expr.text === 'Component' || expr.text === 'Directive');
      });

      if (hasNgDec) {
        const entries: string[] = [];
        for (const member of node.members) {
          if (!ts.isPropertyDeclaration(member) || !member.initializer || !ts.isCallExpression(member.initializer) || !ts.isIdentifier(member.name)) continue;
          const info = getSignalTypeAndRequired(member.initializer.expression);
          if (!info) continue;
          const args = member.initializer.arguments;
          const optNode = getOptionsNode(info.type, info.required, args);
          const alias = optNode && args.length >= (info.required || info.type === 'output' ? 1 : 2) ? getAliasFromOptions(optNode) : null;
          emitSignalMetadata(info.type, member.name.text, alias, args, sourceFile, entries, importsToInject);
        }
        if (entries.length > 0) {
          s.append(`\nif (typeof ${className} !== 'undefined') {\n  ${className}.propMetadata = {\n    ...${className}.propMetadata,\n    ${entries.join(',\n    ')}\n  };\n}\n`);
          changed = true;
        }
      }
    }
    if (!ts.isMethodDeclaration(node) && !ts.isConstructorDeclaration(node) &&
        !ts.isFunctionDeclaration(node) && !ts.isArrowFunction(node) && !ts.isBlock(node))
      ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  if (importsToInject.size > 0) {
    s.prepend(`import { ${[...importsToInject].map(i => `${i} as __VITE_${i}__`).join(', ')} } from '@angular/core';\n`);
    changed = true;
  }
  return changed;
}

export async function transformCode(code: string, id: string, options: PluginOptions = {}): Promise<TransformResult | null> {
  const applyMinify = (options.isProduction ?? false) && (options.minify ?? true);

  if (/\.(html|css)(\?|$)/.test(id) && !id.includes('index.html'))
    return handleStaticAsset(code, id.includes('.html'), applyMinify);
  if (id.includes('node_modules')) return /\.[m]?js$/.test(id) ? await applyLinker(code, id) : null;
  if ((options.isProduction ?? false) && (options.aot ?? false) && hasPartialIvy(code))
    return await applyLinker(code, id);

  const filters = options.include;
  if (filters ? !filters.some(f => f instanceof RegExp ? f.test(id) : id.includes(f as string)) : !/\.[jt]sx?$/.test(id)) return null;

  const s = new MagicString(code);
  let changed = false;
  const imports: string[] = [];

  const isBootstrap = code.includes('bootstrapApplication') || code.includes('platformBrowserDynamic');
  if (isBootstrap) {
    if ((options.jit ?? true) && !code.includes("import '@angular/compiler") && !code.includes('import "@angular/compiler')) {
      s.prepend("import '@angular/compiler';\n"); changed = true;
    }
    const isZoneless = options.zoneless || code.includes('provideExperimentalZonelessChangeDetection');
    if (!isZoneless && !code.includes("import 'zone.js") && !code.includes('import "zone.js')) {
      s.prepend("import 'zone.js';\n"); changed = true;
    }
  }

  const decorators = hasDecorators(code);
  if (!decorators) return changed ? { code: s.toString(), map: s.generateMap({ hires: true, source: id }) } : null;

  changed = processDecorators(s, code, id, options.styleInjection ?? 'inline', imports) || changed;
  if (options.fast && /\.tsx?$/.test(id)) changed = processJitSignals(s, code, id) || changed;

  const needsTS = decorators && /\.tsx?$/.test(id);
  if (!changed && !needsTS) return null;

  if (imports.length) s.prepend(imports.join('\n') + '\n\n');
  if (!code.includes('import.meta.hot') && code.includes('@Component')) s.append(HMR_SNIPPET);

  let finalCode = s.toString(), finalMap: any = s.generateMap({ hires: true, source: id });
  if (needsTS) {
    const r = ts.transpileModule(finalCode, { compilerOptions: TS_OPTS, fileName: id });
    finalCode = r.outputText;
    if (r.sourceMapText) finalMap = JSON.parse(r.sourceMapText);
  }
  return { code: finalCode, map: finalMap };
}
