using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.RegularExpressions;
using Xunit;

namespace ClaudeOutlook.Tests
{
    internal static class Paths
    {
        private static string Here([CallerFilePath] string file = "") => file;

        public static string ComRoot => Path.GetFullPath(Path.Combine(Path.GetDirectoryName(Here()), ".."));

        public static string AddInDll => Path.Combine(ComRoot, "ClaudeOutlook", "bin", "Release", "net48", "ClaudeOutlook.dll");

        public static string Installer(string name) => Path.Combine(ComRoot, "installer", name);
    }

    // Reads the built net48 DLL's metadata (no loading, no Windows) and checks it against what install.cmd
    // registers. A mismatch here is an add-in that installs cleanly and then never shows up in Outlook.
    public sealed class AssemblyTests : IDisposable
    {
        private readonly MetadataLoadContext _mlc;
        private readonly Assembly _asm;
        private readonly Type _connect;

        public AssemblyTests()
        {
            Assert.True(File.Exists(Paths.AddInDll), "Build the add-in first (com/build.sh): " + Paths.AddInDll);
            var nuget = Environment.GetEnvironmentVariable("NUGET_PACKAGES")
                        ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".nuget", "packages");
            var refs = Directory.GetDirectories(Path.Combine(nuget, "microsoft.netframework.referenceassemblies.net48"))
                .Select(v => Path.Combine(v, "build", ".NETFramework", "v4.8")).First(Directory.Exists);
            var files = Directory.GetFiles(refs, "*.dll").Concat(Directory.GetFiles(Path.Combine(refs, "Facades"), "*.dll"))
                .Append(Paths.AddInDll);
            _mlc = new MetadataLoadContext(new PathAssemblyResolver(files), "mscorlib");
            _asm = _mlc.LoadFromAssemblyPath(Paths.AddInDll);
            _connect = _asm.GetType("ClaudeOutlook.AddIn.Connect", throwOnError: true);
        }

        public void Dispose() => _mlc.Dispose();

        private static string Attr(MemberInfo m, string name) =>
            m.GetCustomAttributesData().Where(a => a.AttributeType.Name == name)
             .Select(a => a.ConstructorArguments.Count > 0 ? a.ConstructorArguments[0].Value?.ToString() : "").FirstOrDefault();

        private static Dictionary<string, string> InstallerVars()
        {
            var text = File.ReadAllText(Paths.Installer("install.cmd"));
            return Regex.Matches(text, "^set \"(\\w+)=([^\"\\r\\n]*)\"", RegexOptions.Multiline)
                .Cast<Match>().ToDictionary(m => m.Groups[1].Value, m => m.Groups[2].Value);
        }

        [Fact]
        public void InstallerRegisters_TheClassTheDllExports()
        {
            var v = InstallerVars();
            Assert.Equal("{" + Attr(_connect, "GuidAttribute") + "}", v["CLSID"], ignoreCase: true);
            Assert.Equal(Attr(_connect, "ProgIdAttribute"), v["PROGID"]);
            Assert.Equal(_connect.FullName, v["CLASS"]);
            Assert.Equal(_asm.FullName, v["ASM"]);
            Assert.Equal(_asm.GetName().Version.ToString(), v["VER"]);

            var uninstall = File.ReadAllText(Paths.Installer("uninstall.cmd"));
            Assert.Contains("set \"CLSID=" + v["CLSID"] + "\"", uninstall);
            Assert.Contains("set \"PROGID=" + v["PROGID"] + "\"", uninstall);
        }

        [Fact]
        public void ConnectClass_IsVisibleToComWithIDispatchForRibbonCallbacks()
        {
            Assert.True(_connect.IsPublic);
            Assert.Equal("True", Attr(_connect, "ComVisibleAttribute"));
            // ClassInterfaceType.AutoDispatch == 1: Office looks up OnAction and LoadImage by name.
            Assert.Equal("1", Attr(_connect, "ClassInterfaceAttribute"));
            // Everything else stays hidden from COM.
            var asmVisible = _asm.GetCustomAttributesData().Single(a => a.AttributeType.Name == "ComVisibleAttribute");
            Assert.Equal(false, asmVisible.ConstructorArguments[0].Value);
            Assert.NotNull(_connect.GetConstructor(Type.EmptyTypes));
        }

        [Fact]
        public void ConnectClass_ImplementsTheOfficeInterfacesByTheirRealIids()
        {
            var iids = _connect.GetInterfaces().ToDictionary(i => i.Name, i => Attr(i, "GuidAttribute")?.ToUpperInvariant());
            Assert.Equal("B65AD801-ABAF-11D0-BB8B-00A0C90F2744", iids["IDTExtensibility2"]);
            Assert.Equal("000C0396-0000-0000-C000-000000000046", iids["IRibbonExtensibility"]);
            foreach (var i in _connect.GetInterfaces())
            {
                Assert.True(i.IsPublic, i.Name + " must be public or COM can't QueryInterface for it");
                Assert.Contains(i.GetCustomAttributesData(), a => a.AttributeType.Name == "ComImportAttribute");
            }
            var control = _asm.GetType("ClaudeOutlook.AddIn.IRibbonControl", throwOnError: true);
            Assert.Equal("000C0395-0000-0000-C000-000000000046", Attr(control, "GuidAttribute").ToUpperInvariant());
        }

        [Fact]
        public void RibbonCallbacks_HaveTheSignaturesOfficeCalls()
        {
            var onAction = _connect.GetMethod("OnAction");
            Assert.Equal(new[] { "IRibbonControl" }, onAction.GetParameters().Select(p => p.ParameterType.Name));
            Assert.Equal("Void", onAction.ReturnType.Name);

            var loadImage = _connect.GetMethod("LoadImage");
            Assert.Equal(new[] { "String" }, loadImage.GetParameters().Select(p => p.ParameterType.Name));
            Assert.Equal("Object", loadImage.ReturnType.Name);

            Assert.Equal("String", _connect.GetMethod("GetCustomUI").ReturnType.Name);
        }

        [Fact]
        public void OfficeTypes_AreEmbeddedSoNoInteropAssembliesShip()
        {
            var refs = _asm.GetReferencedAssemblies().Select(a => a.Name).ToList();
            Assert.DoesNotContain(refs, r => r.StartsWith("Microsoft.Office", StringComparison.Ordinal));
            Assert.DoesNotContain(refs, r => r == "office" || r == "Extensibility" || r == "stdole");
            Assert.Contains("mscorlib", refs);
            Assert.NotNull(_asm.GetType("Microsoft.Office.Interop.Outlook.MailItem"));
        }

        [Theory]
        [InlineData("install.cmd")]
        [InlineData("uninstall.cmd")]
        public void Scripts_AreAsciiWithCrlf(string name)
        {
            var bytes = File.ReadAllBytes(Paths.Installer(name));
            Assert.All(bytes, b => Assert.True(b < 128));
            var text = Encoding.ASCII.GetString(bytes);
            Assert.DoesNotMatch("[^\r]\n", text);
        }

        [Fact]
        public void Installer_WritesBothRegistryViewsAndTheOutlookAddinKey()
        {
            var text = File.ReadAllText(Paths.Installer("install.cmd"));
            Assert.Contains("call :register_class /reg:64", text);
            Assert.Contains("call :register_class /reg:32", text);
            Assert.Contains("HKCU\\Software\\Microsoft\\Office\\Outlook\\Addins\\%PROGID%", text);
            Assert.Contains("/v LoadBehavior /t REG_DWORD /d 3", text);
            Assert.Contains("InprocServer32\" /ve /d \"mscoree.dll\"", text);
            Assert.Contains("Unblock-File", text);
            Assert.DoesNotContain("HKLM", text);
        }
    }
}
