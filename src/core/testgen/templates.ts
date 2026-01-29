export const PYTHON_TEMPLATE = `
import sys
import os

print(f"Running smoke test on Python {sys.version}")
try:
    # Basic environment check
    print("Environment check passed")
    sys.exit(0)
except Exception as e:
    print(f"Smoke test failed: {e}")
    sys.exit(1)
`;

export const JAVA_TEMPLATE = `
public class SalmonSmokeTest {
    public static void main(String[] args) {
        System.out.println("Java Environment OK");
        if (1 + 1 != 2) {
            System.err.println("Universe is broken");
            System.exit(1);
        }
        System.exit(0);
    }
}
`;

export const GO_TEMPLATE = `
package main

import (
	"fmt"
	"os"
)

func main() {
	fmt.Println("Go Environment OK")
	os.Exit(0)
}
`;

export const NODE_TEMPLATE = `
// Note: Use a logger in real code, this is a template smoke test
if (1 + 1 !== 2) {
  process.exit(1);
}
process.exit(0);
`;
