<?php

namespace App\Auth;

use App\Models\User;
use App\Helpers\Hasher;

interface AuthInterface
{
    public function login(string $username, string $password): ?User;
}

class AuthService implements AuthInterface
{
    private Hasher $hasher;

    public function __construct(Hasher $hasher)
    {
        $this->hasher = $hasher;
    }

    public function login(string $username, string $password): ?User
    {
        return null;
    }

    private function validate(string $password): bool
    {
        return strlen($password) >= 8;
    }
}

trait HashHelper
{
    public function makeHash(string $value): string
    {
        return hash("sha256", $value);
    }
}

function hash_password(string $password): string
{
    return password_hash($password, PASSWORD_DEFAULT);
}
