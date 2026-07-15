import type { Plugin, UserConfig, ConfigEnv, ResolvedConfig } from 'vite/dist/node/index';
import { transformCode, PluginOptions, hasPartialIvy, applyLinker, virtualStyleMap } from './transform';
import { rootRequire, runAoTCompilation, getJavaScriptTransformerClass } from './utils';
import { DiskCache } from './cache';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createHash } from 'crypto';

export type { PluginOptions };

const LOG = '[vite-plugin-angular]';
const IVY_FILTER = /\.[m]?js$/;
// Mejora 6: import estático de os, límite de 8 workers (suficiente para cualquier máquina)
const cpuWorkers = Math.min(8, Math.max(1, os.cpus().length - 1));

function createLinkerEsbuildPlugin() {
  return {
    name: 'angular-linker-esbuild',
    setup(build: any) {
      build.onLoad({ filter: IVY_FILTER }, async ({ path }: { path: string }) => {
        if (!path.includes('node_modules')) return;
        try {
          const contents = await fs.promises.readFile(path, 'utf8');
          if (!hasPartialIvy(contents)) return;
          const r = await applyLinker(contents, path);
          return r ? { contents: r.code, loader: 'js' } : undefined;
        } catch (e: any) { console.warn(`${LOG} Linker esbuild failed on ${path}: ${e?.message}`); }
      });
    },
  };
}

function createLinkerRolldownPlugin() {
  return {
    name: 'angular-linker-rolldown',
    async transform(code: string, id: string) {
      if (!id.includes('node_modules') || !IVY_FILTER.test(id) || !hasPartialIvy(code)) return null;
      return await applyLinker(code, id);
    }
  };
}

export default function vitePluginAngularTemplate(options?: PluginOptions): Plugin | Plugin[] {
  const opts: PluginOptions = { styleInjection: 'inline', minify: true, jit: true, aot: false, fast: false, ...options };
  let transformerInstance: any = null;
  const optimizerCache = new Map<string, { code: string; map: any }>();
  const diskCache = new DiskCache();
  let logger: any = null;

  const logInfo = (msg: string) => logger ? logger.info(`${LOG} ${msg}`, { timestamp: true }) : console.log(`${LOG} ${msg}`);
  const logWarn = (msg: string) => logger ? logger.warn(`${LOG} ${msg}`, { timestamp: true }) : console.warn(`${LOG} ${msg}`);

  return {
    name: 'vite-plugin-angular',
    enforce: 'pre',

    config(config: UserConfig, env: ConfigEnv) {
      const isProd = env.mode === 'production' || process.env.NODE_ENV === 'production';
      if (isProd && opts.fast) {
        // In production, disable fast compile and enable AoT to optimize bundle size
        opts.fast = false; opts.aot = true; opts.jit = false;
      }
      const devStr = isProd ? 'false' : 'true';
      const jitStr = opts.aot ? 'false' : 'true';
      const ngDefines = { ngDevMode: devStr, ngJitMode: jitStr, ngI18nClosureMode: 'false' };
      config.define = { ...ngDefines, 'globalThis.ngDevMode': devStr, 'globalThis.ngJitMode': jitStr, ...config.define };
      if (config.esbuild !== false) {
        config.esbuild = {
          ...(config.esbuild as any),
          define: { ...ngDefines, ...(config.esbuild as any)?.define }
        };
      }

      let isVite8 = false;
      try { isVite8 = rootRequire('vite/package.json')?.version?.startsWith('8.'); } catch {}
      config.optimizeDeps ??= {};
      const key = isVite8 ? 'rolldownOptions' : 'esbuildOptions';
      config.optimizeDeps[key] ??= {};
      (config.optimizeDeps[key].plugins ??= []).push(isVite8 ? createLinkerRolldownPlugin() : createLinkerEsbuildPlugin());
    },

    configResolved(config: ResolvedConfig) {
      logger = config.logger;
      opts.isProduction = config.command === 'build';
      if (opts.isProduction) {
        const Cls = getJavaScriptTransformerClass();
        if (Cls) {
          const cache = new DiskCache();
          transformerInstance = new Cls({ sourcemap: false, thirdPartySourcemaps: false, advancedOptimizations: true, jit: opts.jit ?? true }, cpuWorkers, cache);
        }
      }
    },

    buildStart() {
      if (!opts.isProduction || !opts.aot || opts.fast) return;
      logInfo('Running AoT compilation...');
      const outDir = path.resolve(process.cwd(), 'node_modules/.cache/vite-plugin-angular/aot-out');
      const tsconfig = opts.tsconfigPath || (fs.existsSync(path.resolve(process.cwd(), 'tsconfig.app.json')) ? './tsconfig.app.json' : './tsconfig.json');
      const ok = runAoTCompilation(tsconfig, outDir);
      if (!ok) {
        throw new Error(`${LOG} AoT compilation failed. Aborting production build to prevent runtime errors.`);
      }
      logInfo('AoT compilation completed.');
    },

    resolveId(id: string) {
      if (id.startsWith('virtual:angular-style:')) {
        return id;
      }
      return null;
    },

    load(id: string) {
      if (id.startsWith('virtual:angular-style:')) {
        const cleanId = id.split('?')[0];
        const css = virtualStyleMap.get(cleanId);
        return css !== undefined ? css : '';
      }
      if (opts.isProduction && opts.aot && !opts.fast && !id.includes('node_modules') && /\.ts$/.test(id)) {
        const rootDir = process.cwd();
        const relativePath = path.relative(rootDir, id);
        const jsRelativePath = relativePath.replace(/\.ts$/, '.js');
        const aotOutDir = path.resolve(rootDir, 'node_modules/.cache/vite-plugin-angular/aot-out');
        const jsPath = path.join(aotOutDir, jsRelativePath);
        if (fs.existsSync(jsPath)) return fs.readFileSync(jsPath, 'utf8');
      }
      return null;
    },

    async transform(code: string, id: string) {
      const result = await transformCode(code, id, opts);
      if (opts.isProduction && transformerInstance && id.includes('node_modules') && /fesm20|@angular/.test(id)) {
        const cached = optimizerCache.get(id);
        if (cached) return cached;
        const transformedCode = result ? result.code : code;
        // Mejora 5: createHash importado a nivel de módulo, evita require() dinámico en hot path
        const cacheKey = createHash('sha256')
          .update(id)
          .update(transformedCode)
          .update(JSON.stringify({ jit: opts.jit, minify: opts.minify }))
          .digest('hex');
        try {
          const cachedDisk = await diskCache.get(cacheKey);
          if (cachedDisk) {
            const parsed = JSON.parse(cachedDisk);
            optimizerCache.set(id, parsed);
            return parsed;
          }
        } catch {}
        try {
          const optimized = await transformerInstance.transformData(id, transformedCode, false, opts.jit && id.includes('@angular/compiler'));
          const out = { code: Buffer.from(optimized).toString(), map: { mappings: '' } };
          optimizerCache.set(id, out);
          await diskCache.put(cacheKey, JSON.stringify(out));
          return out;
        } catch (e: any) { logWarn(`Build optimizer failed on ${id}: ${e?.message}`); }
      }
      return result;
    },

    async buildEnd() {
      if (transformerInstance?.close) try { await transformerInstance.close(); } catch {}
      optimizerCache.clear();
      if (!opts.isProduction || !opts.aot || opts.fast) return;
      try {
        const aotOutDir = path.resolve(process.cwd(), 'node_modules/.cache/vite-plugin-angular/aot-out');
        if (fs.existsSync(aotOutDir)) {
          await fs.promises.rm(aotOutDir, { recursive: true, force: true });
        }
      } catch {}
    }
  };
}

if (typeof module !== 'undefined' && typeof exports !== 'undefined' && module.exports === exports) {
  try { (module as any).exports = Object.assign(vitePluginAngularTemplate, { default: vitePluginAngularTemplate }); } catch {}
}
