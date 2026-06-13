import pytest
import importlib.util
import os
import time
import json
import tempfile


def load_module():
    spec = importlib.util.spec_from_file_location(
        "trie", os.path.join(os.getcwd(), "trie.py")
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class TestBasicOperations:
    def test_insert_and_search(self):
        mod = load_module()
        t = mod.Trie()
        t.insert("hello", 1)
        t.insert("world", 2)
        assert "hello" in t.search("hel")
        assert "world" in t.search("wor")

    def test_search_no_match(self):
        mod = load_module()
        t = mod.Trie()
        t.insert("hello", 1)
        assert t.search("xyz") == []

    def test_delete(self):
        mod = load_module()
        t = mod.Trie()
        t.insert("hello", 1)
        assert t.delete("hello") is True
        assert t.search("hel") == []

    def test_delete_nonexistent(self):
        mod = load_module()
        t = mod.Trie()
        assert t.delete("nope") is False

    def test_insert_overwrite_weight(self):
        mod = load_module()
        t = mod.Trie()
        t.insert("hello", 1)
        t.insert("hello", 10)
        results = t.search("hello")
        assert results[0] == "hello"


class TestAutocomplete:
    def test_autocomplete_returns_top_k(self):
        mod = load_module()
        t = mod.Trie()
        t.insert("apple", 5)
        t.insert("app", 10)
        t.insert("application", 3)
        t.insert("apt", 1)
        results = t.autocomplete("app", 2)
        assert len(results) == 2
        assert results[0] == "app"  # highest weight

    def test_autocomplete_sorted_by_weight(self):
        mod = load_module()
        t = mod.Trie()
        t.insert("aa", 1)
        t.insert("ab", 5)
        t.insert("ac", 3)
        results = t.autocomplete("a", 3)
        assert results == ["ab", "ac", "aa"]

    def test_autocomplete_empty_prefix(self):
        mod = load_module()
        t = mod.Trie()
        t.insert("hello", 1)
        t.insert("world", 2)
        results = t.autocomplete("", 10)
        assert set(results) == {"hello", "world"}


class TestBulkInsert:
    def test_bulk_insert(self):
        mod = load_module()
        t = mod.Trie()
        words = [(f"word{i}", i) for i in range(100)]
        t.bulk_insert(words)
        assert len(t.search("word")) == 100

    def test_bulk_insert_performance(self):
        mod = load_module()
        t = mod.Trie()
        n = 100_000
        words = [(f"word{i:06d}", i) for i in range(n)]
        start = time.time()
        t.bulk_insert(words)
        elapsed = time.time() - start
        assert elapsed < 3.0, f"Bulk insert too slow: {elapsed:.2f}s for {n} words"
        assert len(t.autocomplete("word000", 10)) == 10


class TestSerialization:
    def test_save_load_roundtrip(self):
        mod = load_module()
        t = mod.Trie()
        t.insert("hello", 5)
        t.insert("world", 3)
        t.insert("help", 8)

        with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
            path = f.name

        try:
            t.save(path)
            t2 = mod.Trie.load(path)
            assert set(t2.search("hel")) == {"hello", "help"}
            assert set(t2.search("wor")) == {"world"}
            assert t2.autocomplete("hel", 1) == ["help"]
        finally:
            os.unlink(path)

    def test_load_nonexistent_raises(self):
        mod = load_module()
        with pytest.raises(Exception):
            mod.Trie.load("/nonexistent/path.json")


class TestEdgeCases:
    def test_empty_trie(self):
        mod = load_module()
        t = mod.Trie()
        assert t.search("a") == []
        assert t.autocomplete("a", 5) == []

    def test_single_char_words(self):
        mod = load_module()
        t = mod.Trie()
        for c in "abcdefghij":
            t.insert(c, ord(c))
        results = t.autocomplete("", 5)
        assert len(results) == 5

    def test_unicode_words(self):
        mod = load_module()
        t = mod.Trie()
        t.insert("café", 5)
        t.insert("naive", 3)
        assert len(t.search("caf")) >= 1
