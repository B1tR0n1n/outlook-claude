using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace ClaudeOutlook.AddIn
{
    // b1tr0n1n palette. Work PCs won't have JetBrains Mono or Cormorant, so Consolas and Segoe UI stand in.
    internal static class Theme
    {
        public static readonly Color Background = ColorTranslator.FromHtml("#0a0908");
        public static readonly Color Surface = ColorTranslator.FromHtml("#151311");
        public static readonly Color Gold = ColorTranslator.FromHtml("#c9a227");
        public static readonly Color Text = ColorTranslator.FromHtml("#c8bda0");
        public static readonly Color Dim = ColorTranslator.FromHtml("#8a7f6e");
        public static readonly Color Border = ColorTranslator.FromHtml("#2a2520");
        public static readonly Color Error = ColorTranslator.FromHtml("#d0675a");

        public static Font Body() => new Font("Segoe UI", 10f);
        public static Font Mono() => new Font("Consolas", 9f);

        public static void Apply(Form f, string title)
        {
            f.Text = title;
            f.BackColor = Background;
            f.ForeColor = Text;
            f.Font = Body();
            f.AutoScaleMode = AutoScaleMode.Font;
            f.ShowInTaskbar = false;
            f.MinimizeBox = false;
            f.Padding = new Padding(12);
        }

        public static Label Heading(string text) => new Label
        {
            Text = text.ToUpperInvariant(),
            Font = Mono(),
            ForeColor = Gold,
            AutoSize = true,
            Margin = new Padding(0, 0, 0, 6),
        };

        public static TextBox Box(bool multiline) => new TextBox
        {
            Multiline = multiline,
            ScrollBars = multiline ? ScrollBars.Vertical : ScrollBars.None,
            BackColor = Surface,
            ForeColor = Text,
            BorderStyle = BorderStyle.FixedSingle,
            AcceptsReturn = multiline,
        };

        public static Button Button(string text, bool primary)
        {
            var b = new Button
            {
                Text = text,
                AutoSize = true,
                FlatStyle = FlatStyle.Flat,
                BackColor = Surface,
                ForeColor = primary ? Gold : Text,
                Padding = new Padding(8, 2, 8, 2),
                Margin = new Padding(6, 0, 0, 0),
                UseVisualStyleBackColor = false,
            };
            b.FlatAppearance.BorderColor = primary ? Gold : Border;
            return b;
        }

        public static FlowLayoutPanel ButtonRow() => new FlowLayoutPanel
        {
            Dock = DockStyle.Bottom,
            FlowDirection = FlowDirection.RightToLeft,
            AutoSize = true,
            Padding = new Padding(0, 10, 0, 0),
            WrapContents = false,
        };
    }

    internal static class Ui
    {
        private const string Title = "Claude";

        // The Outlook window that holds the clicked button, so our windows sit on top of it.
        public static IWin32Window OwnerOf(object context)
        {
            try
            {
                if (context is IOleWindow w)
                {
                    w.GetWindow(out var hwnd);
                    if (hwnd != IntPtr.Zero) return new Win32Window(hwnd);
                }
            }
            catch (COMException) { }
            return null;
        }

        public static void Warn(IWin32Window owner, string message) =>
            MessageBox.Show(owner, message, Title, MessageBoxButtons.OK, MessageBoxIcon.Information);

        public static void Error(IWin32Window owner, string message) =>
            MessageBox.Show(owner, message, Title, MessageBoxButtons.OK, MessageBoxIcon.Warning);

        public static bool Confirm(IWin32Window owner, string message) =>
            MessageBox.Show(owner, message, Title, MessageBoxButtons.YesNo, MessageBoxIcon.Question) == DialogResult.Yes;

        private sealed class Win32Window : IWin32Window
        {
            public Win32Window(IntPtr handle) { Handle = handle; }
            public IntPtr Handle { get; }
        }
    }
}
