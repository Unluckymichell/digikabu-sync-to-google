export async function promiseBatch<K extends unknown, T extends readonly K[]>(atOnce: number, taskList: (() => K)[]) {
    const tasks = chunkArr(taskList, atOnce);
    const results: K[] = [];
    for (const task of tasks) {
        results.push(...await Promise.all(task.map(t => t())));
    }
    return results as { -readonly [P in keyof T]: Awaited<T[P]>; };
}

export function chunkArr<T extends unknown>(arr: T[], size: number) {
    if (size <= 0) throw new Error('Chunk size must be a positive integer');
    return arr.reduce((acc, _, i) => {
        if (i % size === 0) acc.push(arr.slice(i, i + size));
        return acc;
    }, [] as T[][]);
}

export type Result<v, e> = {value: v, error?: null} | {value?: null, error: e};