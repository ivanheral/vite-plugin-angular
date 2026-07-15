import * as fs from 'fs';
import * as path from 'path';

export class DiskCache {
  private cacheDir: string;
  private memCache = new Map<string, string>();
  private readonly MAX_MEM = 128;

  constructor() {
    this.cacheDir = path.resolve(process.cwd(), 'node_modules/.cache/vite-plugin-angular');
  }

  async get(key: string): Promise<string | undefined> {
    // Mejora 7: Caché LRU en memoria para evitar lecturas repetidas de disco en la misma sesión
    if (this.memCache.has(key)) return this.memCache.get(key);

    const file = path.join(this.cacheDir, key);
    try {
      // Mejora 1: EAFP — leer directamente sin existsSync bloqueante (ENOENT es capturado por catch)
      const value = await fs.promises.readFile(file, 'utf8');
      if (this.memCache.size >= this.MAX_MEM) {
        // Evict la entrada más antigua (FIFO)
        this.memCache.delete(this.memCache.keys().next().value!);
      }
      this.memCache.set(key, value);
      return value;
    } catch {
      return undefined;
    }
  }

  async put(key: string, value: string): Promise<void> {
    const file = path.join(this.cacheDir, key);
    try {
      // Mejora 1: mkdir con recursive:true es idempotente — no hace falta existsSync previo
      await fs.promises.mkdir(this.cacheDir, { recursive: true });
      await fs.promises.writeFile(file, value, 'utf8');
      // Actualizar también la caché en memoria
      if (this.memCache.size >= this.MAX_MEM) {
        this.memCache.delete(this.memCache.keys().next().value!);
      }
      this.memCache.set(key, value);
    } catch {}
  }
}
