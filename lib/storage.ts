
import { MonthSnapshot, AppSettings } from '../types';

export const DB_NAME = 'cash_forecast_db';
export const DB_VERSION = 7;
type Migration = (db: IDBDatabase) => void;

const MIGRATIONS: Record<number, Migration> = {
  1: (db) => {
    if (!db.objectStoreNames.contains('month_snapshots')) {
      db.createObjectStore('month_snapshots', { keyPath: 'id' });
    }
    if (!db.objectStoreNames.contains('settings')) {
      db.createObjectStore('settings', { keyPath: 'id' });
    }
  },
  2: () => {
    // No new stores; reserved for schema updates.
  },
  3: () => {
    // No new stores; reserved for schema updates.
  },
  4: () => {
    // No new stores; reserved for schema updates.
  },
  5: () => {
    // No new stores; reserved for schema updates.
  },
  6: () => {
    // No new stores; reserved for schema updates.
  },
  7: (db) => {
    if (!db.objectStoreNames.contains('tax_tables')) {
      db.createObjectStore('tax_tables', { keyPath: 'tax_year' });
    }
  }
};

export class StorageManager {
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(new Error("IndexedDB failed to open"));
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const oldVersion = event.oldVersion || 0;
        for (let v = oldVersion + 1; v <= DB_VERSION; v++) {
          const migrate = MIGRATIONS[v];
          if (migrate) migrate(db);
        }
      };
    });
  }

  private async getStore(storeName: string, mode: IDBTransactionMode = 'readonly'): Promise<IDBObjectStore> {
    if (!this.db) await this.init();
    const transaction = this.db!.transaction(storeName, mode);
    return transaction.objectStore(storeName);
  }

  async getMonth(monthId: string): Promise<MonthSnapshot | null> {
    const store = await this.getStore('month_snapshots');
    return new Promise((resolve) => {
      const request = store.get(monthId);
      request.onsuccess = () => resolve(request.result || null);
    });
  }

  async upsertMonth(snapshot: MonthSnapshot): Promise<void> {
    const store = await this.getStore('month_snapshots', 'readwrite');
    return new Promise((resolve, reject) => {
      const request = store.put(snapshot);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async listMonths(): Promise<string[]> {
    const store = await this.getStore('month_snapshots');
    return new Promise((resolve) => {
      const request = store.getAllKeys();
      request.onsuccess = () => resolve(request.result as string[]);
    });
  }

  async deleteMonth(monthId: string): Promise<void> {
    const store = await this.getStore('month_snapshots', 'readwrite');
    return new Promise((resolve) => {
      const request = store.delete(monthId);
      request.onsuccess = () => resolve();
    });
  }

  async getSettings(): Promise<AppSettings | null> {
    const store = await this.getStore('settings');
    return new Promise((resolve) => {
      const request = store.get('main_settings');
      request.onsuccess = () => resolve(request.result || null);
    });
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    const store = await this.getStore('settings', 'readwrite');
    return new Promise((resolve) => {
      const request = store.put({ ...settings, id: 'main_settings' });
      request.onsuccess = () => resolve();
    });
  }

  async exportAllData(): Promise<string> {
    const snapshotsStore = await this.getStore('month_snapshots');
    const settingsStore = await this.getStore('settings');
    
    const snapshots: MonthSnapshot[] = await new Promise((res) => {
      snapshotsStore.getAll().onsuccess = (e) => res((e.target as any).result);
    });
    const settings: any = await new Promise((res) => {
      settingsStore.get('main_settings').onsuccess = (e) => res((e.target as any).result);
    });

    return JSON.stringify({ snapshots, settings }, null, 2);
  }

  async importData(json: string): Promise<void> {
    const data = JSON.parse(json);
    const snapshotsStore = await this.getStore('month_snapshots', 'readwrite');
    const settingsStore = await this.getStore('settings', 'readwrite');

    for (const s of data.snapshots) {
      snapshotsStore.put(s);
    }
    if (data.settings) {
      settingsStore.put(data.settings);
    }
  }

  async resetAll(): Promise<void> {
    const snapshotsStore = await this.getStore('month_snapshots', 'readwrite');
    const settingsStore = await this.getStore('settings', 'readwrite');
    snapshotsStore.clear();
    settingsStore.clear();
  }
}

export const storage = new StorageManager();
