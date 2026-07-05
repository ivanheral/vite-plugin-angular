import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import vitePluginAngularTemplate from './index';
import * as utils from './utils';
import * as transform from './transform';

describe('index.ts', () => {
  let spyRootRequire: any;

  beforeEach(() => {
    spyRootRequire = vi.spyOn(utils, 'rootRequire');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should instantiate the plugin and configure hooks', async () => {
    const plugin = vitePluginAngularTemplate() as any;
    expect(plugin.name).toBe('vite-plugin-angular');
    expect(plugin.enforce).toBe('pre');
    expect(plugin.config).toBeDefined();
    expect(plugin.configResolved).toBeDefined();
    expect(plugin.buildStart).toBeDefined();
    expect(plugin.transform).toBeDefined();
  });

  describe('config hook', () => {
    it('should set production defines', async () => {
      const plugin = vitePluginAngularTemplate({ aot: true }) as any;
      const config: any = {};
      plugin.config(config, { mode: 'production' });
      expect(config.define.ngDevMode).toBe('false');
      expect(config.define.ngJitMode).toBe('false');
    });

    it('should set dev defines', async () => {
      const plugin = vitePluginAngularTemplate({ aot: false }) as any;
      const config: any = {};
      plugin.config(config, { mode: 'development' });
      expect(config.define.ngDevMode).toBe('true');
      expect(config.define.ngJitMode).toBe('true');
    });
  });

  describe('configResolved hook', () => {
    it('should set isProduction based on command', async () => {
      const plugin = vitePluginAngularTemplate() as any;
      plugin.configResolved({ command: 'build' });
      // We can check if transform behaves as production
      const result = await plugin.transform('<!-- comment --><div></div>', 'test.html');
      expect(result).not.toBeNull();
      expect(result.code).toBe('export default "<div></div>";');
    });
  });

  describe('buildStart hook', () => {
    it('should execute AoT compilation if conditions met', async () => {
      const plugin = vitePluginAngularTemplate({ aot: true }) as any;
      plugin.configResolved({ command: 'build' });
      
      const spyLog = vi.spyOn(console, 'log').mockImplementation(() => {});
      const spyWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const spyAot = vi.spyOn(utils, 'runAoTCompilation').mockReturnValue(true);
      
      plugin.buildStart();
      
      expect(spyLog).toHaveBeenCalled();
      expect(spyAot).toHaveBeenCalled();
      
      spyLog.mockRestore();
      spyWarn.mockRestore();
    });

    it('should skip AoT compilation if jit mode is true', async () => {
      const plugin = vitePluginAngularTemplate({ aot: false }) as any;
      plugin.configResolved({ command: 'build' });
      
      const spyLog = vi.spyOn(console, 'log').mockImplementation(() => {});
      plugin.buildStart();
      expect(spyLog).not.toHaveBeenCalled();
      spyLog.mockRestore();
    });

    it('should throw an error if AoT compilation fails', async () => {
      const plugin = vitePluginAngularTemplate({ aot: true }) as any;
      plugin.configResolved({ command: 'build' });
      
      const spyLog = vi.spyOn(console, 'log').mockImplementation(() => {});
      const spyAot = vi.spyOn(utils, 'runAoTCompilation').mockReturnValue(false);
      
      expect(() => plugin.buildStart()).toThrowError(/AoT compilation failed/);
      
      expect(spyAot).toHaveBeenCalled();
      spyLog.mockRestore();
    });
  });

  describe('createLinkerRolldownPlugin transform', () => {
    it('should transform ivy code in node_modules', async () => {
      spyRootRequire.mockImplementation((path: string) => {
        if (path === 'vite/package.json') return { version: '8.0.0' };
        return {};
      });

      const plugin = vitePluginAngularTemplate() as any;
      const config: any = {};

      plugin.config(config, { mode: 'development' });
      const rolldownPlugin = config.optimizeDeps.rolldownOptions.plugins[0];
      
      // Test non-node_modules
      expect(await rolldownPlugin.transform('code', 'src/app.js')).toBeNull();
      // Test non-js filter
      expect(await rolldownPlugin.transform('code', 'node_modules/some-lib/index.css')).toBeNull();
      // Test non-partial ivy code
      expect(await rolldownPlugin.transform('const a = 1;', 'node_modules/some-lib/index.mjs')).toBeNull();
    });

    it('should call applyLinker if all conditions match', async () => {
      spyRootRequire.mockImplementation((path: string) => {
        if (path === 'vite/package.json') return { version: '8.0.0' };
        return {};
      });

      const plugin = vitePluginAngularTemplate() as any;
      const config: any = {};
      plugin.config(config, { mode: 'development' });
      const rolldownPlugin = config.optimizeDeps.rolldownOptions.plugins[0];

      const spyApply = vi.spyOn(transform, 'applyLinker').mockReturnValue(Promise.resolve({ code: 'linked', map: null }) as any);
      const res = await rolldownPlugin.transform('ɵɵngDeclareComponent', 'node_modules/some-lib/index.mjs');
      expect(spyApply).toHaveBeenCalledWith('ɵɵngDeclareComponent', 'node_modules/some-lib/index.mjs');
      expect(res).toEqual({ code: 'linked', map: null });
    });
  });

  describe('createLinkerEsbuildPlugin onLoad', () => {
    it('should handle esbuild load events', async () => {
      spyRootRequire.mockImplementation((path: string) => {
        if (path === 'vite/package.json') return { version: '7.0.0' };
        return {};
      });

      const plugin = vitePluginAngularTemplate() as any;
      const config: any = {};

      plugin.config(config, { mode: 'development' });
      const esbuildPlugin = config.optimizeDeps.esbuildOptions.plugins[0];
      
      let filterCheck: RegExp = /.*/;
      let loadCallback: any = null;
      const buildMock = {
        onLoad: (opts: any, callback: any) => {
          filterCheck = opts.filter;
          loadCallback = callback;
        }
      };
      
      esbuildPlugin.setup(buildMock);
      expect(loadCallback).toBeDefined();
      expect(filterCheck.test('index.js')).toBe(true);

      // Test callback with non-node_modules path
      expect(await loadCallback({ path: 'src/main.js' })).toBeUndefined();

      // Test callback with non-partial ivy path
      const fs = require('fs');
      vi.spyOn(fs.promises, 'readFile').mockResolvedValue('const a = 1;');
      expect(await loadCallback({ path: 'node_modules/lib/index.js' })).toBeUndefined();

      // Test callback with partial ivy path and successful transform
      vi.spyOn(fs.promises, 'readFile').mockResolvedValue('ɵɵngDeclareComponent');
      const spyApply = vi.spyOn(transform, 'applyLinker').mockReturnValue(Promise.resolve({ code: 'linked', map: null }) as any);
      const res = await loadCallback({ path: 'node_modules/lib/index.js' });
      expect(spyApply).toHaveBeenCalledWith('ɵɵngDeclareComponent', 'node_modules/lib/index.js');
      expect(res).toEqual({ contents: 'linked', loader: 'js' });

      // Test callback throwing error on read
      vi.spyOn(fs.promises, 'readFile').mockRejectedValue(new Error('read error'));
      const spyWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(await loadCallback({ path: 'node_modules/lib/index.js' })).toBeUndefined();
      expect(spyWarn).toHaveBeenCalled();
    });
  });
});
