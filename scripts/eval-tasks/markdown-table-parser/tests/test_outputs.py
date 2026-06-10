import pytest
import importlib.util
import os

def load_module():
    spec = importlib.util.spec_from_file_location("md_table", os.path.join(os.getcwd(), "md_table.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

SIMPLE_TABLE = """| Name | Age | City |
|------|-----|------|
| Alice | 30 | NYC |
| Bob | 25 | LA |
| Carol | 35 | Chicago |"""

def test_basic_parsing():
    mod = load_module()
    result = mod.parse_table(SIMPLE_TABLE)
    assert len(result) == 3
    assert result[0] == {"Name": "Alice", "Age": "30", "City": "NYC"}
    assert result[1] == {"Name": "Bob", "Age": "25", "City": "LA"}
    assert result[2] == {"Name": "Carol", "Age": "35", "City": "Chicago"}

def test_single_row():
    mod = load_module()
    table = "| X | Y |\n|---|---|\n| 1 | 2 |"
    result = mod.parse_table(table)
    assert len(result) == 1
    assert result[0] == {"X": "1", "Y": "2"}

def test_empty_table():
    mod = load_module()
    table = "| A | B |\n|---|---|"
    result = mod.parse_table(table)
    assert result == []

def test_invalid_input():
    mod = load_module()
    assert mod.parse_table("") == []
    assert mod.parse_table("just some text") == []
    assert mod.parse_table("no table here\nat all") == []

def test_alignment_markers():
    mod = load_module()
    table = "| Left | Center | Right |\n|:-----|:------:|------:|\n| a | b | c |"
    result = mod.parse_table(table)
    assert len(result) == 1
    assert result[0] == {"Left": "a", "Center": "b", "Right": "c"}
