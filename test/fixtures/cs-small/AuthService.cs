using System;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace MyApp.Auth;

public interface IAuthService
{
    Task<bool> LoginAsync(string username, string password);
}

public class AuthService : IAuthService
{
    private readonly IHasher _hasher;

    public AuthService(IHasher hasher)
    {
        _hasher = hasher;
    }

    public async Task<bool> LoginAsync(string username, string password)
    {
        return await Task.FromResult(false);
    }

    private bool Validate(string password)
    {
        return password.Length >= 8;
    }
}

public static class Helpers
{
    public static string HashPassword(string password)
    {
        return password;
    }
}

public record User(string Username, string Email);

internal struct AuditEntry
{
    public string Action;
    public DateTime At;
}

public enum Status
{
    Active,
    Disabled,
}
