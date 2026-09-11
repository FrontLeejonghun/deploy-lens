import type { Report } from '@/types';
const openDatabase = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('deploy-lens', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('reports', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
export async function saveReport(report: Report) {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('reports', 'readwrite');
      const store = transaction.objectStore('reports');
      store.put(report);
      const request = store.getAll();
      request.onsuccess = () => {
        const expired = (request.result as Report[])
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(12);
        for (const item of expired) store.delete(item.id);
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}
export async function listReports(): Promise<Report[]> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('reports').objectStore('reports').getAll();
      request.onsuccess = () =>
        resolve(
          (request.result as Report[])
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .slice(0, 12),
        );
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}
export async function removeReport(id: string) {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('reports', 'readwrite');
      transaction.objectStore('reports').delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}
