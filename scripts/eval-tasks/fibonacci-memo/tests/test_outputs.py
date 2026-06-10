import pytest
import importlib.util
import sys
import os

def load_module():
    spec = importlib.util.spec_from_file_location("fibonacci", os.path.join(os.getcwd(), "fibonacci.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

def test_base_cases():
    mod = load_module()
    assert mod.fib(0) == 0
    assert mod.fib(1) == 1

def test_small_values():
    mod = load_module()
    assert mod.fib(2) == 1
    assert mod.fib(3) == 2
    assert mod.fib(5) == 5
    assert mod.fib(10) == 55

def test_large_values():
    mod = load_module()
    assert mod.fib(50) == 12586269025
    assert mod.fib(100) == 354224848179261915075

def test_very_large():
    mod = load_module()
    result = mod.fib(1000)
    assert isinstance(result, int)
    assert result > 0
    # fib(1000) has 209 digits
    assert len(str(result)) == 209

def test_memoization():
    mod = load_module()
    # Should be fast if memoized
    import time
    start = time.time()
    for i in range(200):
        mod.fib(i)
    elapsed = time.time() - start
    assert elapsed < 1.0, f"Too slow ({elapsed:.2f}s) — memoization may be missing"
