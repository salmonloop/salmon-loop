/**
 * Process an array of items in batches, executing the async operation for each batch concurrently.
 * This is useful for preventing resource exhaustion (like EMFILE errors from opening too many files)
 * while still gaining the performance benefits of concurrent execution compared to sequential loops.
 *
 * @param items The array of items to process
 * @param batchSize The maximum number of items to process concurrently
 * @param processor The async function to execute for each item
 * @returns An array containing the results of the processed items in the same order
 */
export async function processInBatches<T, R>(
  items: T[],
  batchSize: number,
  processor: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map((item, batchIndex) => processor(item, i + batchIndex)),
    );
    results.push(...batchResults);
  }

  return results;
}
