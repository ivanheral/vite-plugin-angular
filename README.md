# vite-plugin-angular

<!-- prettier-ignore-start -->
[![NPM Version](https://img.shields.io/npm/v/vite-plugin-angular.svg?style=flat-square)](https://www.npmjs.com/package/vite-plugin-angular)
[![NPM Downloads](https://img.shields.io/npm/dw/vite-plugin-angular.svg?style=flat-square)](https://www.npmjs.com/package/vite-plugin-angular)
[![Vite Plugin Registry](https://img.shields.io/badge/vite-plugin--registry-blue?logo=vite&style=flat-square)](https://registry.vite.dev/plugin/vite-plugin-angular)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
<!-- prettier-ignore-end -->

`vite-plugin-angular` is a lightweight plugin that lets you build **Angular** applications using **Vite** instead of the traditional, slower Angular CLI. It gives you the best of both worlds: Angular's powerful framework structure combined with Vite's instant startups and ultra-fast hot reloading.

---

## 🌟 What makes this plugin special?

We have built-in advanced features that optimize your app automatically without requiring complex configurations:

### 1. Clutter-Free Workspace (Zero-Pollution Compilation)
* **The Problem**: Other plugins generate temporary helper files directly inside your `src/` folder during compilation. If a build crashes, your project is left full of unwanted files.
* **Our Solution**: We redirect all temporary compiler outputs to an isolated, hidden folder (`node_modules/.cache`). When the build finishes, we clean it up automatically. **Your source code folder remains 100% clean**.

### 2. Smart Build Caching (Fast Successive Builds)
* **The Problem**: Compiling a large Angular app from scratch every time you make a production build is slow.
* **Our Solution**: The first build creates a cache. On successive builds, the plugin only recompiles the files you actually changed. This **cuts production build times in half**.

### 3. Automatic "Zoneless" Detection (Saves Bundle Space)
* Modern Angular (18+) allows you to run applications without `zone.js` (called **Zoneless** mode) to make them smaller and faster.
* The plugin automatically checks your `main.ts` file. If you are using Zoneless, it automatically disables and excludes `zone.js` from your final app bundle, **saving you about 15 KB** without requiring manual configuration.

---

## Features at a Glance

- ⚡ **Vite-Powered**: Enjoy instant server startups (under 1 second) and fast Hot Module Replacement (HMR).
- 🛠️ **Smart Decorators**: Handles `@Component`, `@Directive`, and `@Injectable` decorators automatically.
- 📉 **Automatic Minification**: Automatically compresses your HTML templates and CSS styles in production.
- 🧬 **Modern Angular Support**: Fully compatible with Angular Signals (`input()`, `model()`, `output()`, etc.).

---

## Installation

Install the plugin using your favorite package manager:

```sh
# npm
npm install vite-plugin-angular --save-dev

# pnpm
pnpm add vite-plugin-angular -D

# yarn
# yarn add vite-plugin-angular --dev

# bun
bun add vite-plugin-angular --dev
```

---

## Quick Start

Simply import and add the plugin to your `vite.config.ts` or `vite.config.js` file:

```typescript
import { defineConfig } from 'vite';
import angular from 'vite-plugin-angular';

export default defineConfig({
  plugins: [
    angular({
      styleInjection: 'inline', // Keeps component styles scoped and encapsulated
      fast: true                // Enables ultra-fast dev mode startups
    })
  ]
});
```

---

## Configuration Options (`PluginOptions`)

You can customize how the plugin works by passing these options:

| Option | Type | Default | Description |
|---|---|---|---|
| `styleInjection` | `'inline' \| 'global'` | `'inline'` | How component stylesheets are loaded. See details below. |
| `fast` | `boolean` | `false` | Enables a simplified compilation path for faster development startups. |
| `fastMode` | `'full' \| 'partial'` | `'full'` | Output compiler format (`full` for apps, `partial` for reusable libraries). |
| `aot` | `boolean` | `false` | Enables Ahead-of-Time compilation for optimized production builds. |
| `minify` | `boolean` | `true` | Compresses templates and styles in production to reduce bundle size. |
| `tsconfigPath` | `string` | *Auto-detected* | Custom path to your `tsconfig.json`. (Defaults to `tsconfig.app.json` if present). |
| `jit` | `boolean` | `true` | Enables Just-in-Time compilation injection for JIT files. |
| `zoneless` | `boolean` | `false` | Manually forces Zoneless mode (disables `zone.js` bundle injection). |

### Option Details Explained

#### `styleInjection`
* **`'inline'` (Recommended)**: Loads and injects your CSS/SCSS styles locally into each component. This preserves Angular's **style scoping**, meaning styles in one component won't accidentally affect other parts of your app.
* **`'global'`**: Injects styles globally. This enables instant CSS updates during development without reloading components, but styles will apply to the entire page.

#### `fast`
* Set this to `true` to disable template type-checking during development. This gives you **instant server startups (under 700ms)**. 
* *Tip*: It is recommended to run type-safety checks as a separate process in your build pipeline:
  ```json
  {
    "scripts": {
      "build": "ngc -p tsconfig.app.json --noEmit && vite build"
    }
  }
  ```

#### `aot`
* When enabled (`true`) during `vite build`, templates are compiled statically. This completely removes the Angular compiler engine from the final bundle, **saving you ~80 KB** of download size for your users.

---

## Markdown & Pug Templates

If you prefer writing templates in Markdown (`.md`) or Pug (`.pug`) instead of HTML, you can combine this plugin with standard Vite template loaders. The plugin will automatically recognize them:

```typescript
@Component({
  selector: 'app-post',
  templateUrl: './post.component.md' // Automatically loaded as markdown
})
export class PostComponent {}
```

---

## How It Works Under the Hood

The plugin handles two main tasks behind the scenes to keep your app fast:
1. **Angular Constants**: In production, it flags `ngDevMode: false`. This tells Vite's minifier to strip out all Angular development logs and debugging checks, shrinking your final file size.
2. **esbuild Dependency Optimizer**: When you run the dev server for the first time, it automatically links pre-compiled libraries (like `@angular/core`) so they run seamlessly in the browser.

---

## License

[MIT](https://opensource.org/licenses/MIT) © Iván Hernández
