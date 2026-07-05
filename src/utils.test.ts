import { describe, it, expect } from 'vitest';
import { minify, rootRequire, unwrap, runAoTCompilation } from './utils';

describe('utils', () => {
  describe('minify', () => {
    it('should minify HTML', () => {
      const html = '<!-- comment --><div>  test  </div>';
      expect(minify(html, true)).toBe('<div> test </div>');
    });

    it('should minify CSS', () => {
      const css = '/* comment */ .class { color: red; }';
      expect(minify(css, false)).toBe('.class{color:red;}');
    });
  });

  describe('rootRequire', () => {
    it('should successfully require a package', () => {
      const ts = rootRequire('typescript');
      expect(ts).toBeDefined();
    });
  });

  describe('unwrap', () => {
    it('should return default if it exists', () => {
      const obj = { default: 'test-default', other: 'test-other' };
      expect(unwrap(obj)).toBe('test-default');
    });

    it('should return target if default does not exist', () => {
      const obj = { other: 'test-other' };
      expect(unwrap(obj)).toBe(obj);
    });
  });

  describe('runAoTCompilation', () => {
    it('should return false if tsconfig is missing or invalid', () => {
      expect(runAoTCompilation('nonexistent-tsconfig.json')).toBe(false);
    });
  });
});
