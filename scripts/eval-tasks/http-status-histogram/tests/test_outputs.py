import pytest
import importlib.util
import os

def load_module():
    spec = importlib.util.spec_from_file_location("http_histogram", os.path.join(os.getcwd(), "http_histogram.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

LOG_LINES = """127.0.0.1 - - [10/Oct/2023:13:55:36 -0700] "GET /index.html HTTP/1.1" 200 2326
127.0.0.1 - - [10/Oct/2023:13:55:36 -0700] "GET /style.css HTTP/1.1" 200 1234
127.0.0.1 - - [10/Oct/2023:13:55:37 -0700] "GET /missing HTTP/1.1" 404 0
127.0.0.1 - - [10/Oct/2023:13:55:38 -0700] "POST /api/data HTTP/1.1" 201 512
127.0.0.1 - - [10/Oct/2023:13:55:39 -0700] "GET /admin HTTP/1.1" 403 0
127.0.0.1 - - [10/Oct/2023:13:55:40 -0700] "GET /crash HTTP/1.1" 500 0"""

def test_basic_parsing():
    mod = load_module()
    result = mod.parse_log(LOG_LINES)
    assert result[200] == 2
    assert result[404] == 1
    assert result[201] == 1
    assert result[403] == 1
    assert result[500] == 1

def test_empty_input():
    mod = load_module()
    assert mod.parse_log("") == {}

def test_garbage_lines():
    mod = load_module()
    result = mod.parse_log("this is not a log line\nanother bad line\n")
    assert result == {}

def test_mixed_valid_invalid():
    mod = load_module()
    text = LOG_LINES + "\ngarbage line\n" + LOG_LINES
    result = mod.parse_log(text)
    assert result[200] == 4  # doubled

def test_single_line():
    mod = load_module()
    result = mod.parse_log('10.0.0.1 - - [01/Jan/2024:00:00:00 +0000] "GET / HTTP/1.1" 200 100\n')
    assert result == {200: 1}
