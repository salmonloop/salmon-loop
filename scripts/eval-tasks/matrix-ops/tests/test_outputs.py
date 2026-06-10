import pytest
import importlib.util
import os

def load_module():
    spec = importlib.util.spec_from_file_location("matrix_ops", os.path.join(os.getcwd(), "matrix_ops.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

def test_transpose_basic():
    mod = load_module()
    assert mod.mat_transpose([[1, 2], [3, 4]]) == [[1, 3], [2, 4]]

def test_transpose_rectangular():
    mod = load_module()
    assert mod.mat_transpose([[1, 2, 3], [4, 5, 6]]) == [[1, 4], [2, 5], [3, 6]]

def test_transpose_single_row():
    mod = load_module()
    assert mod.mat_transpose([[1, 2, 3]]) == [[1], [2], [3]]

def test_mul_identity():
    mod = load_module()
    a = [[1, 2], [3, 4]]
    identity = [[1, 0], [0, 1]]
    assert mod.mat_mul(a, identity) == [[1, 2], [3, 4]]

def test_mul_basic():
    mod = load_module()
    a = [[1, 2], [3, 4]]
    b = [[5, 6], [7, 8]]
    result = mod.mat_mul(a, b)
    assert result == [[19, 22], [43, 50]]

def test_mul_rectangular():
    mod = load_module()
    a = [[1, 2, 3], [4, 5, 6]]  # 2x3
    b = [[7, 8], [9, 10], [11, 12]]  # 3x2
    result = mod.mat_mul(a, b)
    assert result == [[58, 64], [139, 154]]

def test_mul_dimension_mismatch():
    mod = load_module()
    with pytest.raises(ValueError):
        mod.mat_mul([[1, 2]], [[3], [4], [5]])  # 1x2 * 3x1 — inner dims don't match

def test_transpose_dimension_mismatch():
    mod = load_module()
    # Should work for any valid matrix
    assert mod.mat_transpose([[1]]) == [[1]]
