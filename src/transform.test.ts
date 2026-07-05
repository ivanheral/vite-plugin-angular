import { describe, it, expect } from 'vitest';
import { transformCode, minifyHtml, minifyCss, applyLinker } from './transform';

describe('vite-plugin-angular-template: transformCode', () => {
  
  describe('bootstrap injections (zone.js & @angular/compiler)', () => {
    it('should automatically inject zone.js and @angular/compiler in bootstrap with platformBrowserDynamic', async () => {
      const code = `
        import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';
        import { AppModule } from './app/app.module';

        platformBrowserDynamic().bootstrapModule(AppModule)
          .catch(err => console.error(err));
      `;
      const result = await transformCode(code, 'main.ts');
      expect(result).not.toBeNull();
      if (result) {
        expect(result.code).toContain("import '@angular/compiler';\n");
        expect(result.code).toContain("import 'zone.js';\n");
      }
    });

    it('should automatically inject zone.js and @angular/compiler in bootstrap with bootstrapApplication', async () => {
      const code = `
        import { bootstrapApplication } from '@angular/platform-browser';
        import { AppComponent } from './app/app.component';
        bootstrapApplication(AppComponent);
      `;
      const result = await transformCode(code, 'main.ts');
      expect(result).not.toBeNull();
      if (result) {
        expect(result.code).toContain("import '@angular/compiler';\n");
        expect(result.code).toContain("import 'zone.js';\n");
      }
    });

    it('should not inject @angular/compiler if jit option is false', async () => {
      const code = `
        import { bootstrapApplication } from '@angular/platform-browser';
        import { AppComponent } from './app/app.component';
        bootstrapApplication(AppComponent);
      `;
      const result = await transformCode(code, 'main.ts', { jit: false });
      expect(result).not.toBeNull();
      if (result) {
        expect(result.code).not.toContain("import '@angular/compiler';");
        expect(result.code).toContain("import 'zone.js';\n");
      }
    });

    it('should not duplicate zone.js if already imported with single quotes', async () => {
      const code = `
        import 'zone.js';
        import { bootstrapApplication } from '@angular/platform-browser';
        bootstrapApplication(AppComponent);
      `;
      const result = await transformCode(code, 'main.ts');
      if (result) {
        const occurrences = result.code.split("import 'zone.js'").length - 1;
        expect(occurrences).toBe(1);
      }
    });

    it('should not duplicate zone.js if already imported with double quotes', async () => {
      const code = `
        import "zone.js";
        import { bootstrapApplication } from '@angular/platform-browser';
        bootstrapApplication(AppComponent);
      `;
      const result = await transformCode(code, 'main.ts');
      if (result) {
        const occurrences = result.code.split('import "zone.js"').length - 1;
        expect(occurrences).toBe(1);
      }
    });

    it('should not duplicate @angular/compiler if already imported', async () => {
      const code = `
        import '@angular/compiler';
        import { bootstrapApplication } from '@angular/platform-browser';
        bootstrapApplication(AppComponent);
      `;
      const result = await transformCode(code, 'main.ts');
      if (result) {
        const occurrences = result.code.split("import '@angular/compiler'").length - 1;
        expect(occurrences).toBe(1);
      }
    });

    it('should not inject zone.js or @angular/compiler in ordinary files that are not bootstrap files', async () => {
      const code = `export class HelperService {}`;
      const result = await transformCode(code, 'helper.ts');
      expect(result).toBeNull();
    });
  });

  describe('Decorator Transformation and Dependency Injection (DI)', () => {
    it('should compile decorators and preserve constructor injection type metadata', async () => {
      const code = `
        import { Component, Injectable } from '@angular/core';
        
        @Injectable()
        export class LoggerService {}

        @Component({
          selector: 'app-item',
          templateUrl: './item.html'
        })
        export class ItemComponent {
          constructor(private logger: LoggerService) {}
        }
      `;
      const result = await transformCode(code, 'item.component.ts');
      expect(result).not.toBeNull();
      if (result) {
        expect(result.code).toContain('__decorate');
        expect(result.code).toContain('__metadata');
        expect(result.code).toContain('LoggerService');
      }
    });

    it('should support @Directive and @Injectable decorators in TypeScript', async () => {
      const code = `
        import { Directive, ElementRef } from '@angular/core';
        
        @Directive({ selector: '[appHighlight]' })
        export class HighlightDirective {
          constructor(private el: ElementRef) {}
        }
      `;
      const result = await transformCode(code, 'highlight.directive.ts');
      expect(result).not.toBeNull();
      if (result) {
        expect(result.code).toContain('__decorate');
        expect(result.code).toContain('ElementRef');
      }
    });

    it('should support templateUrl and styleUrls declared with double quotes and backticks', async () => {
      const code = `
        import { Component } from '@angular/core';
        @Component({
          templateUrl: "double.html",
          styleUrls: [\`backtick.css\`]
        })
        export class TestComponent {}
      `;
      const result = await transformCode(code, 'test.component.ts');
      expect(result).not.toBeNull();
      if (result) {
        expect(result.code).toContain('import __vite_angular_template_0 from "double.html?raw";');
        expect(result.code).toContain('import __vite_angular_style_0 from "backtick.css?inline";');
      }
    });

    it('should support styleInjection: global by stripping styleUrls and generating global side-effect imports', async () => {
      const code = `
        import { Component } from '@angular/core';
        @Component({
          templateUrl: 'double.html',
          styleUrls: ['global.css']
        })
        export class GlobalStylesComponent {}
      `;
      const result = await transformCode(code, 'global.component.ts', { styleInjection: 'global' });
      expect(result).not.toBeNull();
      if (result) {
        expect(result.code).toContain('import "global.css";');
        expect(result.code).not.toContain('styleUrls');
      }
    });
  });

  describe('Template Compilation (Markdown / Pug)', () => {
    it('should import .md/.pug files without ?raw suffix', async () => {
      const component = `
        import { Component } from '@angular/core';
        @Component({
          templateUrl: './doc.md',
          styleUrls: ['./doc.css']
        })
        export class DocComponent {}
      `;
      const result = await transformCode(component, 'doc.component.ts');
      expect(result).not.toBeNull();
      if (result) {
        expect(result.code).toContain('import __vite_angular_template_0 from "./doc.md";');
        expect(result.code).toContain('import __vite_angular_style_0 from "./doc.css?inline";');
      }
    });
  });

  describe('Production Minification', () => {
    it('should minify complex HTML by removing comments and redundant spaces', async () => {
      const rawHtml = `
        <!-- Initial comment -->
        <div class="container">
          <p>
            Hello   world!
          </p>
        </div>
      `;
      const compressed = minifyHtml(rawHtml);
      expect(compressed).toBe('<div class="container"><p> Hello world! </p></div>');
    });

    it('should minify complex CSS by removing comments and compacting spaces', async () => {
      const rawCss = `
        /* Design comment */
        .container {
          display: flex;
          justify-content: center;
        }
        
        .btn:hover {
          color: red;
        }
      `;
      const compressed = minifyCss(rawCss);
      expect(compressed).toBe('.container{display:flex;justify-content:center;}.btn:hover{color:red;}');
    });

    it('should apply minification when intercepting HTML/CSS files in production', async () => {
      const rawHtml = '<!-- comment -->\n<div>  hello  </div>';
      const result = await transformCode(rawHtml, 'alert.html', { isProduction: true, minify: true });
      expect(result).not.toBeNull();
      if (result) {
        expect(result.code).toBe('export default "<div> hello </div>";');
      }

      const rawCss = '/* comment */\n.a { margin: 0; }';
      const resultCss = await transformCode(rawCss, 'alert.css', { isProduction: true, minify: true });
      expect(resultCss).not.toBeNull();
      if (resultCss) {
        expect(resultCss.code).toBe('export default ".a{margin:0;}";');
      }
    });
  });

  describe('Ivy HMR and Filters', () => {
    it('should inject Ivy HMR in @Component decorators', async () => {
      const code = `
        import { Component } from '@angular/core';
        @Component({ templateUrl: './alert.html' })
        export class AlertComponent {}
      `;
      const result = await transformCode(code, 'alert.component.ts');
      expect(result).not.toBeNull();
      if (result) {
        expect(result.code).toContain('import.meta.hot.accept');
        expect(result.code).toContain('ng.applyChanges');
      }
    });

    it('should respect inclusion filters to skip transformation', async () => {
      const code = `
        import { Component } from '@angular/core';
        @Component({ templateUrl: './alert.html' })
        export class AlertComponent {}
      `;
      const result = await transformCode(code, 'alert.component.ts', { include: [/src\/app\/.*\.ts$/] });
      expect(result).toBeNull();
    });
  });

  describe('fast Signal AST Transformations', () => {
    it('should inject propMetadata for signals with aliases and queries', async () => {
      const code = `
        import { Component, signal, input, model, output, viewChild } from '@angular/core';

        @Component({
          selector: 'app-test',
          template: '<div></div>'
        })
        export class TestComponent {
          initialVal = input(0, { alias: 'startVal' });
          myModel = model('init', { alias: 'state' });
          onChange = output({ alias: 'changed' });
          elRef = viewChild('myDiv');
        }
      `;
      const result = await transformCode(code, 'test.component.ts', { fast: true });
      expect(result).not.toBeNull();
      if (result) {
        expect(result.code).toContain('__VITE_Input__');
        expect(result.code).toContain('__VITE_Output__');
        expect(result.code).toContain('__VITE_ViewChild__');
        expect(result.code).toContain('startVal');
        expect(result.code).toContain('state');
        expect(result.code).toContain('stateChange');
        expect(result.code).toContain('changed');
        expect(result.code).toContain("'myDiv'");
        expect(result.code).toContain('TestComponent.propMetadata =');
      }
    });
  });

  describe('complex decorators with nested braces', () => {
    it('should correctly transform templateUrl and styleUrls in components with host metadata containing braces', async () => {
      const code = `
        import { Component } from '@angular/core';
        @Component({
          selector: 'app-root',
          host: {
            'class': 'container',
            '(window:resize)': 'onResize($event)'
          },
          templateUrl: './app.component.html',
          styleUrls: ['./app.component.css']
        })
        export class AppComponent {}
      `;
      const result = await transformCode(code, 'app.component.ts');
      expect(result).not.toBeNull();
      if (result) {
        expect(result.code).toContain('import __vite_angular_template_0 from "./app.component.html?raw";');
        expect(result.code).toContain('import __vite_angular_style_0 from "./app.component.css?inline";');
        expect(result.code).toContain('template: __vite_angular_template_0');
        expect(result.code).toContain('styles: [__vite_angular_style_0]');
      }
    });
  });

  describe('modern styleUrl support (singular)', () => {
    it('should correctly transform styleUrl with inline injection', async () => {
      const code = `
        import { Component } from '@angular/core';
        @Component({
          selector: 'app-root',
          templateUrl: './app.component.html',
          styleUrl: './app.component.css'
        })
        export class AppComponent {}
      `;
      const result = await transformCode(code, 'app.component.ts');
      expect(result).not.toBeNull();
      if (result) {
        expect(result.code).toContain('import __vite_angular_style_0 from "./app.component.css?inline";');
        expect(result.code).toContain('styles: [__vite_angular_style_0]');
        expect(result.code).not.toContain('styleUrl:');
      }
    });

    it('should correctly transform styleUrl with global injection', async () => {
      const code = `
        import { Component } from '@angular/core';
        @Component({
          selector: 'app-root',
          templateUrl: './app.component.html',
          styleUrl: './app.component.css'
        })
        export class AppComponent {}
      `;
      const result = await transformCode(code, 'app.component.ts', { styleInjection: 'global' });
      expect(result).not.toBeNull();
      if (result) {
        expect(result.code).toContain('import "./app.component.css";');
        expect(result.code).not.toContain('styles:');
        expect(result.code).not.toContain('styleUrl:');
      }
    });
  });

  describe('inline styles virtual extraction', () => {
    it('should extract inline styles and map them to virtual CSS imports', async () => {
      const code = `
        import { Component } from '@angular/core';
        @Component({
          selector: 'app-root',
          styles: [
            \`
              .btn {
                background: blue;
              }
            \`
          ]
        })
        export class AppComponent {}
      `;
      const { virtualStyleMap } = await import('./transform');
      virtualStyleMap.clear();

      const result = await transformCode(code, 'src/app.component.ts');
      expect(result).not.toBeNull();
      if (result) {
        expect(result.code).toContain('import __vite_angular_style_0 from "virtual:angular-style:src/app.component.ts:0.css?inline";');
        expect(result.code).toContain('styles: [__vite_angular_style_0]');
        expect(virtualStyleMap.size).toBe(1);
        expect(virtualStyleMap.get('virtual:angular-style:src/app.component.ts:0.css')).toContain('background: blue;');
      }
    });
  });

  describe('linker defensive logic', () => {
    it('should act defensively and return null if it fails to load babel or compiler-cli', async () => {
      const result = await applyLinker('const a = 1;', 'node_modules/some-lib/index.mjs');
      expect(result).toBeNull();
    });
  });
});
