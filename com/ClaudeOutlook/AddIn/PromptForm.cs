using System.Drawing;
using System.Windows.Forms;

namespace ClaudeOutlook.AddIn
{
    // One question, one multi-line answer. Ctrl+Enter sends.
    internal sealed class PromptForm : Form
    {
        private readonly TextBox _box;
        private readonly bool _optional;

        private PromptForm(string title, string question, bool optional)
        {
            _optional = optional;
            Theme.Apply(this, title);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterParent;
            ClientSize = new Size(460, 210);
            KeyPreview = true;

            _box = Theme.Box(multiline: true);
            _box.Dock = DockStyle.Fill;

            var ok = Theme.Button(optional ? "Go" : "Ask Claude", primary: true);
            ok.Click += (s, e) => Finish();
            var cancel = Theme.Button("Cancel", primary: false);
            cancel.DialogResult = DialogResult.Cancel;
            CancelButton = cancel;

            var buttons = Theme.ButtonRow();
            buttons.Controls.Add(ok);
            buttons.Controls.Add(cancel);

            var heading = Theme.Heading(question);
            heading.Dock = DockStyle.Top;

            Controls.Add(_box);
            Controls.Add(buttons);
            Controls.Add(heading);

            KeyDown += (s, e) =>
            {
                if (e.Control && e.KeyCode == Keys.Enter) { e.SuppressKeyPress = true; Finish(); }
            };
        }

        private void Finish()
        {
            if (!_optional && _box.Text.Trim().Length == 0) { _box.Focus(); return; }
            DialogResult = DialogResult.OK;
        }

        // The typed text, "" when an optional prompt is left blank, or null when cancelled.
        public static string Ask(IWin32Window owner, string title, string question, bool optional)
        {
            using (var f = new PromptForm(title, question, optional))
            {
                return f.ShowDialog(owner) == DialogResult.OK ? f._box.Text.Trim() : null;
            }
        }
    }
}
