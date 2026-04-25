/**
 * Executes an asynchronous operation on an array of items in batches.
 * This improves performance by running operations concurrently, while
 * preventing resource exhaustion (e.g., EMFILE errors) by limiting the chunk size.
 *
 * @param items The array of items to process
 * @param processor The async function to execute for each item
 * @param batchSize The maximum number of concurrent operations (default: 10)
 * @returns A promise that resolves to an array of results
 */
export async function processInBatches<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  batchSize: number = 10,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(processor));
    results.push(...batchResults);
  }
  return results;
}
