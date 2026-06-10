import pytest
import importlib.util
import os

def load_module():
    spec = importlib.util.spec_from_file_location("json_path", os.path.join(os.getcwd(), "json_path.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

def test_simple_path():
    mod = load_module()
    data = {"a": {"b": {"c": 42}}}
    assert mod.get_nested(data, "a.b.c") == 42

def test_missing_key():
    mod = load_module()
    data = {"a": {"b": 1}}
    assert mod.get_nested(data, "a.c.d") is None

def test_custom_default():
    mod = load_module()
    data = {"a": 1}
    assert mod.get_nested(data, "b", "fallback") == "fallback"

def test_array_index():
    mod = load_module()
    data = {"items": [10, 20, 30]}
    assert mod.get_nested(data, "items.1") == 20

def test_nested_array():
    mod = load_module()
    data = {"users": [{"name": "alice"}, {"name": "bob"}]}
    assert mod.get_nested(data, "users.0.name") == "alice"
    assert mod.get_nested(data, "users.1.name") == "bob"

def test_empty_path():
    mod = load_module()
    data = {"a": 1}
    # Empty path should return the data itself or default
    result = mod.get_nested(data, "")
    assert result == data or result is None

def test_none_data():
    mod = load_module()
    # Should handle None data gracefully
    result = mod.get_nested(None, "a.b", "default")
    assert result == "default"
