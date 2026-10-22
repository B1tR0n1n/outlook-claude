using System;
using System.Security.Cryptography;
using System.Text;
using ClaudeOutlook.Core;
using Microsoft.Win32;

namespace ClaudeOutlook.AddIn
{
    // HKCU\Software\ClaudeOutlook. The API key is encrypted with DPAPI for this Windows user.
    internal sealed class Settings
    {
        private const string KeyPath = @"Software\ClaudeOutlook";
        private const string VbaKeyPath = @"Software\VB and VBA Program Settings\ClaudeOutlook\Config";
        private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("ClaudeOutlook/ApiKey/v1");

        public string ApiKey { get; set; } = "";
        public string Model { get; set; } = ClaudeClient.DefaultModel;
        public string Context { get; set; } = "";

        public static Settings Load()
        {
            var s = new Settings();
            using (var k = Registry.CurrentUser.OpenSubKey(KeyPath))
            {
                if (k != null)
                {
                    s.ApiKey = Unprotect(k.GetValue("ApiKey") as string);
                    s.Model = k.GetValue("Model") as string ?? s.Model;
                    s.Context = k.GetValue("Context") as string ?? "";
                }
            }
            if (s.ApiKey.Length == 0) s.ImportFromMacros();
            return s;
        }

        // The VBA macro version keeps its settings in plain text; pick them up once so the key isn't typed twice.
        private void ImportFromMacros()
        {
            using (var k = Registry.CurrentUser.OpenSubKey(VbaKeyPath))
            {
                if (k == null) return;
                ApiKey = (k.GetValue("ApiKey") as string ?? "").Trim();
                if (Context.Length == 0) Context = k.GetValue("Context") as string ?? "";
            }
        }

        public void Save()
        {
            using (var k = Registry.CurrentUser.CreateSubKey(KeyPath))
            {
                k.SetValue("ApiKey", Protect(ApiKey.Trim()));
                k.SetValue("Model", string.IsNullOrWhiteSpace(Model) ? ClaudeClient.DefaultModel : Model.Trim());
                k.SetValue("Context", Context ?? "");
            }
        }

        private static string Protect(string plain)
        {
            if (string.IsNullOrEmpty(plain)) return "";
            var bytes = ProtectedData.Protect(Encoding.UTF8.GetBytes(plain), Entropy, DataProtectionScope.CurrentUser);
            return Convert.ToBase64String(bytes);
        }

        private static string Unprotect(string stored)
        {
            if (string.IsNullOrEmpty(stored)) return "";
            try
            {
                var bytes = ProtectedData.Unprotect(Convert.FromBase64String(stored), Entropy, DataProtectionScope.CurrentUser);
                return Encoding.UTF8.GetString(bytes);
            }
            catch (FormatException) { return ""; }
            catch (CryptographicException) { return ""; }
        }
    }
}
