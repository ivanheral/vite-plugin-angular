export function minify(content: string, isHtml: boolean): string {
  return isHtml
    ? content.replace(/<!--[\s\S]*?-->/g, '').replace(/\s+/g, ' ').replace(/>\s+</g, '><').trim()
    : content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').replace(/\s*([{};:])\s*/g, '$1').trim();
}

export const rootRequire = (mod: string): any => require(require.resolve(mod, { paths: [process.cwd()] }));
export const unwrap = (m: any) => m?.default ?? m;

export function runAoTCompilation(tsconfigPath: string, outDir?: string): boolean {
  try {
    const ng = rootRequire('@angular/compiler-cli');
    const tsLib = rootRequire('typescript');
    const cfg = tsLib.readConfigFile(tsconfigPath, tsLib.sys.readFile);
    const opts = tsLib.parseJsonConfigFileContent(cfg.config, tsLib.sys, './');
    if (outDir) {
      opts.options.outDir = outDir;
      opts.options.rootDir = './';
      opts.options.incremental = true;
      opts.options.tsBuildInfoFile = require('path').resolve(process.cwd(), 'node_modules/.cache/vite-plugin-angular/.tsbuildinfo');
    }
    const tsHost = tsLib.createCompilerHost(opts.options);
    const host = ng.createCompilerHost({ options: opts.options, tsHost });
    const program = ng.createProgram({ rootNames: opts.fileNames, options: opts.options, host });
    const emitResult = program.emit();
    const diagnostics = tsLib.getPreEmitDiagnostics(program.getTsProgram()).concat(emitResult.diagnostics);
    if (diagnostics.length > 0) {
      console.warn('[vite-plugin-angular] AoT Compiler Diagnostics:');
      for (const diag of diagnostics)
        console.warn(`  ${diag.file ? diag.file.fileName : 'global'}: ${tsLib.flattenDiagnosticMessageText(diag.messageText, '\n')}`);
    }
    return !emitResult.emitSkipped;
  } catch (e: any) {
    console.error('[vite-plugin-angular] AoT Compiler Exception:', e);
    return false;
  }
}

export function getJavaScriptTransformerClass(): any {
  const paths = [
    '@angular/build/private',
    '@angular-devkit/build-angular/src/tools/esbuild/javascript-transformer.js',
    '@angular-devkit/build-angular/src/builders/browser-esbuild/javascript-transformer.js',
  ];
  for (const p of paths) {
    try { const m = rootRequire(p); if (m?.JavaScriptTransformer) return m.JavaScriptTransformer; } catch {}
  }
  return null;
}
