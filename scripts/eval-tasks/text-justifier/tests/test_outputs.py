import pytest
import importlib.util
import os

def load_module():
    spec = importlib.util.spec_from_file_location("justifier", os.path.join(os.getcwd(), "justifier.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

def test_basic_justify():
    mod = load_module()
    text = "the quick brown fox jumps over the lazy dog"
    result = mod.justify(text, 20)
    lines = result.split("\n")
    for line in lines[:-1]:
        assert len(line) == 20, f"Line '{line}' is {len(line)} chars, expected 20"

def test_last_line_left():
    mod = load_module()
    text = "the quick brown fox jumps"
    result = mod.justify(text, 20)
    lines = result.split("\n")
    # Last line should be left-justified (not padded to full width)
    last = lines[-1]
    assert len(last) <= 20
    assert not last.endswith(" ")

def test_single_word():
    mod = load_module()
    result = mod.justify("hello", 10)
    assert result == "hello"

def test_exact_width():
    mod = load_module()
    result = mod.justify("hello world", 11)
    assert result == "hello world"

def test_long_text():
    mod = load_module()
    text = "word " * 20  # 100 chars
    result = mod.justify(text.strip(), 30)
    lines = result.split("\n")
    for line in lines[:-1]:
        assert len(line) == 30, f"Line '{line}' is {len(line)} chars"
