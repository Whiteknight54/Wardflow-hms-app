from contextlib import contextmanager

from psycopg_pool import ConnectionPool

from .config import DATABASE_URL


pool = ConnectionPool(conninfo=DATABASE_URL, min_size=1, max_size=5, open=False)


def open_pool() -> None:
    if pool.closed:
        pool.open()


def close_pool() -> None:
    if not pool.closed:
        pool.close()


@contextmanager
def get_connection():
    with pool.connection() as connection:
        yield connection
