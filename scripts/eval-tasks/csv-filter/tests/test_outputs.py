import pytest
import importlib.util
import os
import csv

def load_module():
    spec = importlib.util.spec_from_file_location("csv_filter", os.path.join(os.getcwd(), "csv_filter.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

def write_csv(path, rows):
    with open(path, 'w', newline='') as f:
        writer = csv.writer(f)
        for row in rows:
            writer.writerow(row)

def read_csv(path):
    with open(path, 'r') as f:
        return list(csv.reader(f))

def test_basic_filter(tmp_path):
    mod = load_module()
    inp = str(tmp_path / "in.csv")
    out = str(tmp_path / "out.csv")
    write_csv(inp, [["name", "score"], ["alice", "85"], ["bob", "60"], ["carol", "90"]])
    count = mod.filter_rows(inp, out, "score", 70)
    assert count == 2
    rows = read_csv(out)
    assert len(rows) == 3  # header + 2 data rows
    assert rows[1][0] == "alice"
    assert rows[2][0] == "carol"

def test_no_matches(tmp_path):
    mod = load_module()
    inp = str(tmp_path / "in.csv")
    out = str(tmp_path / "out.csv")
    write_csv(inp, [["x", "val"], ["a", "1"], ["b", "2"]])
    count = mod.filter_rows(inp, out, "val", 100)
    assert count == 0

def test_all_match(tmp_path):
    mod = load_module()
    inp = str(tmp_path / "in.csv")
    out = str(tmp_path / "out.csv")
    write_csv(inp, [["x", "val"], ["a", "10"], ["b", "20"]])
    count = mod.filter_rows(inp, out, "val", 5)
    assert count == 2

def test_missing_file():
    mod = load_module()
    count = mod.filter_rows("/nonexistent.csv", "/tmp/out.csv", "col", 0)
    assert count == -1

def test_boundary_values(tmp_path):
    mod = load_module()
    inp = str(tmp_path / "in.csv")
    out = str(tmp_path / "out.csv")
    write_csv(inp, [["name", "val"], ["a", "10.0"], ["b", "9.9"]])
    count = mod.filter_rows(inp, out, "val", 10.0)
    assert count == 1
