using System;
using System.IO;

namespace ClaudeOutlook.AddIn
{
    // %LOCALAPPDATA%\ClaudeOutlook\log.txt. Errors only: never API keys or email content.
    internal static class Log
    {
        private const long MaxBytes = 256 * 1024;

        public static string Folder =>
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ClaudeOutlook");

        public static void Error(string where, Exception ex) =>
            Write(where + ": " + ex.GetType().Name + ": " + ex.Message + Environment.NewLine + ex.StackTrace);

        public static void Write(string line)
        {
            try
            {
                Directory.CreateDirectory(Folder);
                var file = Path.Combine(Folder, "log.txt");
                if (File.Exists(file) && new FileInfo(file).Length > MaxBytes) File.Delete(file);
                File.AppendAllText(file, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " " + line + Environment.NewLine);
            }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }
    }
}
