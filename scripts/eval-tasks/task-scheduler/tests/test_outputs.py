import pytest
import importlib.util
import os
import time
import threading


def load_module():
    spec = importlib.util.spec_from_file_location(
        "task_scheduler", os.path.join(os.getcwd(), "task_scheduler.py")
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class TestBasicExecution:
    def test_single_task(self):
        mod = load_module()
        s = mod.TaskScheduler()
        s.add_task("a", lambda: 42)
        results = s.run()
        assert results["a"]["status"] == "ok"
        assert results["a"]["value"] == 42

    def test_multiple_independent_tasks(self):
        mod = load_module()
        s = mod.TaskScheduler()
        s.add_task("a", lambda: 1)
        s.add_task("b", lambda: 2)
        s.add_task("c", lambda: 3)
        results = s.run()
        assert results["a"]["value"] == 1
        assert results["b"]["value"] == 2
        assert results["c"]["value"] == 3

    def test_linear_dependencies(self):
        mod = load_module()
        s = mod.TaskScheduler()
        order = []

        def make_fn(name):
            def fn():
                order.append(name)
                return name
            return fn

        s.add_task("a", make_fn("a"))
        s.add_task("b", make_fn("b"), deps=["a"])
        s.add_task("c", make_fn("c"), deps=["b"])
        results = s.run()
        assert order == ["a", "b", "c"]
        assert all(r["status"] == "ok" for r in results.values())


class TestParallelExecution:
    def test_independent_tasks_run_in_parallel(self):
        mod = load_module()
        s = mod.TaskScheduler()

        def slow():
            time.sleep(0.3)
            return "done"

        s.add_task("a", slow)
        s.add_task("b", slow)
        s.add_task("c", slow)

        start = time.time()
        results = s.run()
        elapsed = time.time() - start

        assert all(r["status"] == "ok" for r in results.values())
        # 3 tasks each sleeping 0.3s — if parallel, total < 0.8s
        assert elapsed < 0.8, f"Too slow: {elapsed:.2f}s — may not be parallel"

    def test_dag_parallel_execution(self):
        mod = load_module()
        s = mod.TaskScheduler()
        execution_log = []
        lock = threading.Lock()

        def make_fn(name, sleep_time):
            def fn():
                time.sleep(sleep_time)
                with lock:
                    execution_log.append(name)
                return name
            return fn

        s.add_task("a", make_fn("a", 0.2))
        s.add_task("b", make_fn("b", 0.2))
        s.add_task("c", make_fn("c", 0.1), deps=["a", "b"])

        start = time.time()
        results = s.run()
        elapsed = time.time() - start

        assert results["c"]["status"] == "ok"
        # a and b run in parallel (0.2s), then c (0.1s) — total ~0.3s
        assert elapsed < 0.8
        assert execution_log.index("c") > execution_log.index("a")
        assert execution_log.index("c") > execution_log.index("b")


class TestCycleDetection:
    def test_simple_cycle(self):
        mod = load_module()
        s = mod.TaskScheduler()
        s.add_task("a", lambda: 1, deps=["b"])
        s.add_task("b", lambda: 2, deps=["a"])
        with pytest.raises(ValueError, match="[Cc]ycle"):
            s.run()

    def test_indirect_cycle(self):
        mod = load_module()
        s = mod.TaskScheduler()
        s.add_task("a", lambda: 1, deps=["c"])
        s.add_task("b", lambda: 2, deps=["a"])
        s.add_task("c", lambda: 3, deps=["b"])
        with pytest.raises(ValueError, match="[Cc]ycle"):
            s.run()


class TestFailureCascade:
    def test_failed_task_skips_dependents(self):
        mod = load_module()
        s = mod.TaskScheduler()

        def fail():
            raise RuntimeError("boom")

        s.add_task("a", fail)
        s.add_task("b", lambda: 2, deps=["a"])
        s.add_task("c", lambda: 3, deps=["b"])
        results = s.run()

        assert results["a"]["status"] == "error"
        assert "boom" in results["a"]["error"]
        assert results["b"]["status"] == "error"
        assert results["c"]["status"] == "error"

    def test_independent_task_succeeds_despite_failure(self):
        mod = load_module()
        s = mod.TaskScheduler()

        def fail():
            raise RuntimeError("boom")

        s.add_task("a", fail)
        s.add_task("b", lambda: 42)
        results = s.run()

        assert results["a"]["status"] == "error"
        assert results["b"]["status"] == "ok"
        assert results["b"]["value"] == 42


class TestComplexDAG:
    def test_diamond_dependency(self):
        mod = load_module()
        s = mod.TaskScheduler()
        order = []
        lock = threading.Lock()

        def make_fn(name):
            def fn():
                with lock:
                    order.append(name)
                return name
            return fn

        s.add_task("a", make_fn("a"))
        s.add_task("b", make_fn("b"), deps=["a"])
        s.add_task("c", make_fn("c"), deps=["a"])
        s.add_task("d", make_fn("d"), deps=["b", "c"])

        results = s.run()
        assert results["d"]["status"] == "ok"
        assert order.index("a") < order.index("b")
        assert order.index("a") < order.index("c")
        assert order.index("b") < order.index("d")
        assert order.index("c") < order.index("d")

    def test_many_roots(self):
        mod = load_module()
        s = mod.TaskScheduler()
        for i in range(10):
            s.add_task(f"root-{i}", lambda i=i: i)
        s.add_task("sink", lambda: "done", deps=[f"root-{i}" for i in range(10)])
        results = s.run()
        assert results["sink"]["status"] == "ok"
        assert results["sink"]["value"] == "done"

    def test_missing_dependency_raises(self):
        mod = load_module()
        s = mod.TaskScheduler()
        s.add_task("a", lambda: 1, deps=["nonexistent"])
        with pytest.raises((ValueError, KeyError)):
            s.run()
