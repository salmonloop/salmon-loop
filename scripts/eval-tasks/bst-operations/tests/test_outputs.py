import pytest
import importlib.util
import os

def load_module():
    spec = importlib.util.spec_from_file_location("bst", os.path.join(os.getcwd(), "bst.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

def test_insert_and_search():
    mod = load_module()
    tree = mod.BST()
    tree.insert(5)
    tree.insert(3)
    tree.insert(7)
    assert tree.search(5) is True
    assert tree.search(3) is True
    assert tree.search(7) is True
    assert tree.search(4) is False

def test_inorder():
    mod = load_module()
    tree = mod.BST()
    for val in [5, 3, 7, 1, 4, 6, 8]:
        tree.insert(val)
    assert tree.inorder() == [1, 3, 4, 5, 6, 7, 8]

def test_min_val():
    mod = load_module()
    tree = mod.BST()
    tree.insert(5)
    tree.insert(3)
    tree.insert(7)
    assert tree.min_val() == 3

def test_min_val_empty():
    mod = load_module()
    tree = mod.BST()
    with pytest.raises(ValueError):
        tree.min_val()

def test_single_element():
    mod = load_module()
    tree = mod.BST()
    tree.insert(42)
    assert tree.search(42) is True
    assert tree.inorder() == [42]
    assert tree.min_val() == 42

def test_duplicates():
    mod = load_module()
    tree = mod.BST()
    tree.insert(5)
    tree.insert(5)
    tree.insert(3)
    # Duplicates should be handled (either ignored or stored)
    assert tree.search(5) is True
    assert tree.search(3) is True

def test_large_tree():
    mod = load_module()
    tree = mod.BST()
    values = list(range(100, 0, -1))
    for v in values:
        tree.insert(v)
    assert tree.inorder() == list(range(1, 101))
    assert tree.min_val() == 1
    assert tree.search(50) is True
    assert tree.search(101) is False
