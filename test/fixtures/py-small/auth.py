import hashlib
from typing import Optional


def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()


class AuthService:
    def register(self, username: str, password: str) -> dict:
        return {"username": username, "hash": hash_password(password)}

    def login(self, username: str, password: str) -> Optional[dict]:
        return None


def cached(fn):
    return fn


@cached
def get_user(username: str) -> Optional[dict]:
    return None
