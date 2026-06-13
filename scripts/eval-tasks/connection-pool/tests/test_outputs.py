import pytest
import importlib.util
import os
import time
import threading


def load_module():
    spec = importlib.util.spec_from_file_location(
        "connection_pool", os.path.join(os.getcwd(), "connection_pool.py")
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class FakeConnection:
    def __init__(self, conn_id=0):
        self.conn_id = conn_id
        self.closed = False

    def close(self):
        self.closed = True


def fake_factory():
    return FakeConnection()


class TestBasicAcquireRelease:
    def test_acquire_returns_connection(self):
        mod = load_module()
        pool = mod.ConnectionPool(factory=fake_factory, max_size=5)
        conn = pool.acquire()
        assert isinstance(conn, FakeConnection)
        pool.release(conn)
        pool.close()

    def test_acquire_as_context_manager(self):
        mod = load_module()
        pool = mod.ConnectionPool(factory=fake_factory, max_size=5)
        with pool.acquire() as conn:
            assert isinstance(conn, FakeConnection)
        pool.close()

    def test_reuse_released_connection(self):
        mod = load_module()
        pool = mod.ConnectionPool(factory=fake_factory, max_size=5)
        conn1 = pool.acquire()
        pool.release(conn1)
        conn2 = pool.acquire()
        assert conn1 is conn2
        pool.release(conn2)
        pool.close()


class TestMaxSize:
    def test_respects_max_size(self):
        mod = load_module()
        pool = mod.ConnectionPool(factory=fake_factory, max_size=2)
        c1 = pool.acquire()
        c2 = pool.acquire()
        # Third acquire should block/timeout
        with pytest.raises(Exception):
            pool.acquire(timeout=0.05)
        pool.release(c1)
        pool.release(c2)
        pool.close()

    def test_acquire_after_release(self):
        mod = load_module()
        pool = mod.ConnectionPool(factory=fake_factory, max_size=1)
        c1 = pool.acquire()
        pool.release(c1)
        c2 = pool.acquire()
        assert c1 is c2
        pool.release(c2)
        pool.close()


class TestClose:
    def test_close_prevents_acquire(self):
        mod = load_module()
        pool = mod.ConnectionPool(factory=fake_factory, max_size=5)
        pool.close()
        with pytest.raises(Exception):
            pool.acquire()

    def test_close_closes_connections(self):
        mod = load_module()
        conns = []

        def tracking_factory():
            c = FakeConnection()
            conns.append(c)
            return c

        pool = mod.ConnectionPool(factory=tracking_factory, max_size=5)
        c1 = pool.acquire()
        pool.release(c1)
        pool.close()

        assert all(c.closed for c in conns)


class TestIdleReclaim:
    def test_idle_connections_reclaimed(self):
        mod = load_module()
        pool = mod.ConnectionPool(
            factory=fake_factory, max_size=10, max_idle_time=0.1
        )
        c = pool.acquire()
        pool.release(c)
        time.sleep(0.2)
        # After idle time, the connection should be reclaimed
        # New acquire should create a fresh connection
        c2 = pool.acquire()
        assert c2 is not c
        pool.release(c2)
        pool.close()


class TestConcurrency:
    def test_concurrent_acquire_release(self):
        mod = load_module()
        pool = mod.ConnectionPool(factory=fake_factory, max_size=5)
        errors = []

        def worker():
            try:
                for _ in range(20):
                    with pool.acquire(timeout=2) as conn:
                        assert conn is not None
                        time.sleep(0.001)
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=worker) for _ in range(10)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=15)

        assert len(errors) == 0
        pool.close()


class TestHealthCheck:
    def test_unhealthy_connection_replaced(self):
        mod = load_module()
        call_count = [0]

        def counted_factory():
            call_count[0] += 1
            return FakeConnection(conn_id=call_count[0])

        def health_check(conn):
            # Mark conn_id > 1 as healthy (first connection "fails")
            return conn.conn_id > 1

        pool = mod.ConnectionPool(
            factory=counted_factory,
            max_size=5,
            health_check=health_check,
        )
        c1 = pool.acquire(timeout=2)
        pool.release(c1)
        # If health check works, acquiring again should get a new connection
        c2 = pool.acquire(timeout=2)
        pool.release(c2)
        pool.close()
        assert call_count[0] >= 2
