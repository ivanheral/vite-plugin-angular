import * as fs from 'fs';
import * as path from 'path';

export class DiskCache {
  private cacheDir: string;

  constructor() {
    this.cacheDir = path.resolve(process.cwd(), 'node_modules/.cache/vite-plugin-angular');
  }

  async get(key: string): Promise<string | undefined> {
    const file = path.join(this.cacheDir, key);
    try {
      if (fs.existsSync(file)) {
        return await fs.promises.readFile(file, 'utf8');
      }
    } catch {}
    return undefined;
  }

  async put(key: string, value: string): Promise<void> {
    const file = path.join(this.cacheDir, key);
    try {
      if (!fs.existsSync(this.cacheDir)) {
        await fs.promises.mkdir(this.cacheDir, { recursive: true });
      }
      await fs.promises.writeFile(file, value, 'utf8');
    } catch {}
  }
}
