# vite-plugin-angular

<!-- prettier-ignore-start -->
[![NPM Version](https://img.shields.io/npm/v/@ivanheral/vite-plugin-angular.svg?style=flat-square)](https://www.npmjs.com/package/@ivanheral/vite-plugin-angular)
[![NPM Downloads](https://img.shields.io/npm/dm/@ivanheral/vite-plugin-angular.svg?style=flat-square)](https://www.npmjs.com/package/@ivanheral/vite-plugin-angular)
[![Vite Plugin Registry](https://img.shields.io/badge/vite-plugin--registry-blue?logo=vite&style=flat-square)](https://registry.vite.dev/plugin/vite-plugin-angular)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
<!-- prettier-ignore-end -->

A Vite plugin for building **Angular** applications. It handles Angular decorators, template compilation, the Ivy Linker, and Ahead-of-Time (AoT) compilation within the standard Vite build pipeline.

---

## Benchmark

The following results were measured in an automated environment. Each tool was tested on the same Angular application under identical conditions. Results may vary depending on hardware and project size.

| Metric | Angular CLI | @analogjs/vite-plugin-angular | @ivanheral/vite-plugin-angular |
| :--- | :---: | :---: | :---: |
| **Dev Cold Start** | 3.60 s | 2.82 s | 725 ms |
| **Production Build** | 3.55 s | 4.91 s | 3.13 s |
| **Bundle Size** | 148.3 KB | 226.8 KB | 149.8 KB |
| **Direct Dependencies** | — | 8 | 1 (`magic-string`) |
| **Plugin LOC** | — | ~2,500 | ~650 |

> **Methodology**: Cold start is measured as the time from process launch until the dev server reports "ready". Production build time is the full `vite build` duration. Bundle size is the uncompressed JS output.

---

## Features

- Handles `@Component`, `@Directive`, and `@Pipe` decorators (template inlining, style injection, HMR snippet).
- Applies the Angular Ivy Linker to pre-compiled libraries in `node_modules` via esbuild/rolldown.
- Supports Ahead-of-Time (AoT) compilation for production builds.
- Automatically detects Zoneless mode and skips `zone.js` injection.
- Compiles inline `styles: [...]` through Vite's PostCSS pipeline (Tailwind, CSS nesting, SCSS).
- Compatible with Angular Signals (`input()`, `model()`, `output()`, `viewChild()`, etc.).
- Supports `templateUrl` with Markdown (`.md`) and Pug (`.pug`) files.
- Temporary AoT compiler outputs are written to `node_modules/.cache` and cleaned up after each build.
- Disk-based and in-memory LRU caching for Linker and optimizer transforms.

---

## Installation

```sh
# npm
npm install @ivanheral/vite-plugin-angular --save-dev

# pnpm
pnpm add @ivanheral/vite-plugin-angular -D

# yarn
yarn add @ivanheral/vite-plugin-angular --dev

# bun
bun add @ivanheral/vite-plugin-angular --dev
```

---

## Usage

```typescript
import { defineConfig } from 'vite';
import angular from '@ivanheral/vite-plugin-angular';

export default defineConfig({
  plugins: [
    angular()
  ]
});
```

For development with faster startups:

```typescript
angular({
  fast: true,           // Skips template type-checking in dev mode
  styleInjection: 'inline'
})
```

For optimized production builds:

```typescript
angular({
  aot: true,            // Enables AoT, removes @angular/compiler from the bundle
  minify: true
})
```

---

## Configuration

| Option | Type | Default | Description |
|---|---|---|---|
| `styleInjection` | `'inline' \| 'global'` | `'inline'` | Controls how component stylesheets are injected. `'inline'` preserves Angular's view encapsulation. `'global'` enables faster CSS HMR. |
| `fast` | `boolean` | `false` | Skips template type-checking during development for faster cold starts. |
| `fastMode` | `'full' \| 'partial'` | `'full'` | Compiler output format. Use `'partial'` when building reusable libraries. |
| `aot` | `boolean` | `false` | Enables Ahead-of-Time compilation. Removes `@angular/compiler` from the production bundle. |
| `minify` | `boolean` | `true` | Minifies HTML templates and CSS in production. |
| `tsconfigPath` | `string` | auto | Path to the TypeScript config file. Defaults to `tsconfig.app.json` if present, otherwise `tsconfig.json`. |
| `jit` | `boolean` | `true` | Controls whether JIT compiler imports are injected into the bootstrap file. |
| `zoneless` | `boolean` | `false` | Disables `zone.js` injection. Detected automatically if `provideExperimentalZonelessChangeDetection` is found. |

### `fast`

Disables template type-checking at dev time. The dev server starts in under 750 ms on most machines.

If you rely on template type safety, run it as a separate step:

```json
{
  "scripts": {
    "type-check": "ngc -p tsconfig.app.json --noEmit",
    "build": "npm run type-check && vite build"
  }
}
```

### `aot`

When set to `true` during a production build, the plugin runs the Angular compiler before Vite processes files. The compiled output is placed in `node_modules/.cache/vite-plugin-angular/aot-out` and deleted after the build. This removes `@angular/compiler` (~80 KB) from the final bundle.

If AoT compilation fails, the build is aborted immediately to prevent shipping a broken bundle.

---

## Markdown & Pug Templates

The plugin passes through `templateUrl` values for `.md` and `.pug` files without appending `?raw`, allowing other Vite plugins to process them:

```typescript
@Component({
  selector: 'app-post',
  templateUrl: './post.component.md'
})
export class PostComponent {}
```

---

## How It Works

1. **Decorator transform**: For each `.ts` file, the plugin rewrites `templateUrl` and `styleUrls`/`styleUrl` into static `import` statements that Vite can resolve and bundle normally.
2. **Ivy Linker**: Libraries published as partial Ivy (containing `ɵɵngDeclare`) are linked at dependency pre-optimization time using `@babel/core` and `@angular/compiler-cli/linker/babel`. Results are cached on disk.
3. **AoT compilation**: In production with `aot: true`, the Angular compiler runs via `@angular/compiler-cli` before Vite's transform phase, emitting JS files that replace the originals.
4. **Constants**: `ngDevMode`, `ngJitMode`, and `ngI18nClosureMode` are set via `config.define` so Vite's minifier can eliminate dead code branches.
5. **Optimizer**: If `@angular/build`'s `JavaScriptTransformer` is available, it is applied to Angular packages in `node_modules` during production builds for additional optimizations.

---

## License

[MIT](https://opensource.org/licenses/MIT) © Iván Hernández
