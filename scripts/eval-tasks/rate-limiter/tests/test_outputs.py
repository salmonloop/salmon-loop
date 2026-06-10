import pytest
import importlib.util
import os
import time

def load_module():
    spec = importlib.util.spec_from_file_location("rate_limiter", os.path.join(os.getcwd(), "rate_limiter.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

def test_burst_capacity():
    mod = load_module()
    rl = mod.RateLimiter(rate=1.0, capacity=3)
    assert rl.allow() is True
    assert rl.allow() is True
    assert rl.allow() is True
    assert rl.allow() is False  # exceeded capacity

def test_refill():
    mod = load_module()
    rl = mod.RateLimiter(rate=10.0, capacity=5)
    # Exhaust capacity
    for _ in range(5):
        rl.allow()
    assert rl.allow() is False
    # Wait for refill
    time.sleep(0.15)  # 10 tokens/sec * 0.15s = ~1.5 tokens
    assert rl.allow() is True

def test_zero_capacity():
    mod = load_module()
    rl = mod.RateLimiter(rate=1.0, capacity=0)
    assert rl.allow() is False

def test_high_rate():
    mod = load_module()
    rl = mod.RateLimiter(rate=1000.0, capacity=100)
    allowed = sum(1 for _ in range(100) if rl.allow())
    assert allowed == 100
    assert rl.allow() is False
