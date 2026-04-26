/**
 * Processes an array of items in concurrent batches to prevent overwhelming resources.
 *
 * @param items The items to process
 * @param batchSize The maximum number of items to process concurrently
 * @param processor The async function to run on each item
 * @returns Array of results matching the input order
 */
export async function processInBatches<T, R>(
  items: T[],
  batchSize: number,
  processor: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(processor));
    results.push(...batchResults);
  }
  return results;
}
