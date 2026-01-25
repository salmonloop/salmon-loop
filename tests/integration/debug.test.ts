import { describe, it, expect, test } from 'vitest';

console.log('DEBUG: File is executing');
console.log('DEBUG: describe is', typeof describe);
console.log('DEBUG: test is', typeof test);

test('top level test', () => {
  console.log('DEBUG: test body executing');
  expect(1).toBe(1);
});

describe('suite', () => {
  it('test in suite', () => {
    console.log('DEBUG: it body executing');
    expect(1).toBe(1);
  });
});
