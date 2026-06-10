import pytest
import importlib.util
import os

def load_module():
    spec = importlib.util.spec_from_file_location("lru_cache", os.path.join(os.getcwd(), "lru_cache.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

def test_basic_get_put():
    mod = load_module()
    cache = mod.LRUCache(2)
    cache.put("a", 1)
    assert cache.get("a") == 1
    assert cache.get("b") is None

def test_eviction():
    mod = load_module()
    cache = mod.LRUCache(2)
    cache.put("a", 1)
    cache.put("b", 2)
    cache.put("c", 3)  # evicts "a"
    assert cache.get("a") is None
    assert cache.get("b") == 2
    assert cache.get("c") == 3

def test_access_refreshes():
    mod = load_module()
    cache = mod.LRUCache(2)
    cache.put("a", 1)
    cache.put("b", 2)
    cache.get("a")  # refresh "a"
    cache.put("c", 3)  # evicts "b" (least recently used)
    assert cache.get("a") == 1
    assert cache.get("b") is None
    assert cache.get("c") == 3

def test_update_existing():
    mod = load_module()
    cache = mod.LRUCache(2)
    cache.put("a", 1)
    cache.put("a", 10)
    assert cache.get("a") == 10

def test_capacity_one():
    mod = load_module()
    cache = mod.LRUCache(1)
    cache.put("a", 1)
    cache.put("b", 2)  # evicts "a"
    assert cache.get("a") is None
    assert cache.get("b") == 2

def test_large_capacity():
    mod = load_module()
    cache = mod.LRUCache(1000)
    for i in range(1000):
        cache.put(str(i), i)
    for i in range(1000):
        assert cache.get(str(i)) == i
