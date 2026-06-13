import pytest
import importlib.util
import os
import time
import threading


def load_module():
    spec = importlib.util.spec_from_file_location(
        "priority_queue", os.path.join(os.getcwd(), "priority_queue.py")
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class TestBasicOperations:
    def test_put_and_get(self):
        mod = load_module()
        pq = mod.PriorityQueue()
        pq.put("low", 1)
        pq.put("high", 10)
        pq.put("mid", 5)
        assert pq.get() == "high"
        assert pq.get() == "mid"
        assert pq.get() == "low"

    def test_peek(self):
        mod = load_module()
        pq = mod.PriorityQueue()
        pq.put("a", 5)
        pq.put("b", 10)
        assert pq.peek() == "b"
        assert len(pq) == 2

    def test_len(self):
        mod = load_module()
        pq = mod.PriorityQueue()
        assert len(pq) == 0
        pq.put("x", 1)
        pq.put("y", 2)
        assert len(pq) == 2
        pq.get()
        assert len(pq) == 1

    def test_empty_get_blocks(self):
        mod = load_module()
        pq = mod.PriorityQueue()
        with pytest.raises(Exception):
            pq.get(timeout=0.01)

    def test_min_mode(self):
        mod = load_module()
        pq = mod.PriorityQueue(mode="min")
        pq.put("high", 10)
        pq.put("low", 1)
        pq.put("mid", 5)
        assert pq.get() == "low"
        assert pq.get() == "mid"
        assert pq.get() == "high"

    def test_max_mode_default(self):
        mod = load_module()
        pq = mod.PriorityQueue()
        pq.put("a", 1)
        pq.put("b", 3)
        pq.put("c", 2)
        assert pq.get() == "b"


class TestPerformance:
    def test_log_n_operations(self):
        mod = load_module()
        pq = mod.PriorityQueue()
        n = 10000
        start = time.time()
        for i in range(n):
            pq.put(i, i)
        put_time = time.time() - start

        start = time.time()
        for _ in range(n):
            pq.get()
        get_time = time.time() - start

        # O(n log n) for n items — should be well under 2s for 10k items
        assert put_time < 2.0, f"Put too slow: {put_time:.2f}s"
        assert get_time < 2.0, f"Get too slow: {get_time:.2f}s"

    def test_duplicate_priorities(self):
        mod = load_module()
        pq = mod.PriorityQueue()
        for i in range(100):
            pq.put(f"item-{i}", 5)
        assert len(pq) == 100
        results = [pq.get() for _ in range(100)]
        assert len(results) == 100
        assert all(r.startswith("item-") for r in results)


class TestThreadSafety:
    def test_concurrent_put_get(self):
        mod = load_module()
        pq = mod.PriorityQueue()
        n = 1000
        results = []
        lock = threading.Lock()

        def producer():
            for i in range(n):
                pq.put(i, i)

        def consumer():
            for _ in range(n):
                val = pq.get(timeout=5)
                with lock:
                    results.append(val)

        producers = [threading.Thread(target=producer) for _ in range(2)]
        consumers = [threading.Thread(target=consumer) for _ in range(2)]

        for t in consumers:
            t.start()
        for t in producers:
            t.start()

        for t in producers + consumers:
            t.join(timeout=10)

        assert len(results) == 2 * n

    def test_len_thread_safe(self):
        mod = load_module()
        pq = mod.PriorityQueue()
        errors = []

        def writer():
            for i in range(500):
                pq.put(i, i)

        def reader():
            for _ in range(500):
                l = len(pq)
                if l < 0:
                    errors.append(f"Negative length: {l}")

        threads = [threading.Thread(target=writer) for _ in range(2)]
        threads += [threading.Thread(target=reader) for _ in range(2)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=10)

        assert len(errors) == 0
        assert len(pq) == 1000


class TestTimeout:
    def test_get_timeout(self):
        mod = load_module()
        pq = mod.PriorityQueue()
        start = time.time()
        with pytest.raises(Exception):
            pq.get(timeout=0.05)
        elapsed = time.time() - start
        assert elapsed < 0.5

    def test_get_with_data_no_block(self):
        mod = load_module()
        pq = mod.PriorityQueue()
        pq.put("ready", 1)
        result = pq.get(timeout=1.0)
        assert result == "ready"
