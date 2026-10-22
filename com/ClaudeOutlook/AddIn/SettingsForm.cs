using System;
using System.Drawing;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using ClaudeOutlook.Core;

namespace ClaudeOutlook.AddIn
{
    internal sealed class SettingsForm : Form
    {
        private readonly ClaudeClient _client;
        private readonly Settings _settings;
        private readonly TextBox _key;
        private readonly ComboBox _model;
        private readonly TextBox _context;
        private readonly Label _status;
        private readonly Button _test;
        private CancellationTokenSource _testCts;

        private SettingsForm(ClaudeClient client)
        {
            _client = client;
            _settings = Settings.Load();
            Theme.Apply(this, "Claude: Settings");
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterParent;
            ClientSize = new Size(520, 430);

            _key = Theme.Box(multiline: false);
            _key.UseSystemPasswordChar = true;
            _key.Text = _settings.ApiKey;
            var show = new CheckBox { Text = "Show", AutoSize = true, ForeColor = Theme.Dim };
            show.CheckedChanged += (s, e) => _key.UseSystemPasswordChar = !show.Checked;

            _model = new ComboBox
            {
                DropDownStyle = ComboBoxStyle.DropDown,
                BackColor = Theme.Surface,
                ForeColor = Theme.Text,
                FlatStyle = FlatStyle.Flat,
            };
            foreach (var m in ClaudeClient.Models) _model.Items.Add(m);
            var current = ClaudeClient.Models.FirstOrDefault(m => m.Id == _settings.Model);
            if (current != null) _model.SelectedItem = current; else _model.Text = _settings.Model;

            _context = Theme.Box(multiline: true);
            _context.Height = 110;
            _context.Text = _settings.Context;

            _status = new Label { AutoSize = true, ForeColor = Theme.Dim, MaximumSize = new Size(490, 0) };

            var layout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, AutoSize = true };
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            AddRow(layout, Theme.Heading("Claude API key (starts sk-ant-api03-)"), null);
            AddRow(layout, _key, show);
            AddRow(layout, Hint("From platform.claude.com > Settings > API keys. Stored encrypted for your Windows account."), null);
            AddRow(layout, Theme.Heading("Model"), null);
            AddRow(layout, _model, null);
            AddRow(layout, Theme.Heading("About you (role, tone, sign-off)"), null);
            AddRow(layout, _context, null);
            AddRow(layout, _status, null);

            var save = Theme.Button("Save", primary: true);
            save.Click += (s, e) => SaveAndClose();
            var cancel = Theme.Button("Cancel", primary: false);
            cancel.DialogResult = DialogResult.Cancel;
            CancelButton = cancel;
            _test = Theme.Button("Test Connection", primary: false);
            _test.Click += (s, e) => RunTest();

            var buttons = Theme.ButtonRow();
            buttons.Controls.Add(save);
            buttons.Controls.Add(cancel);
            buttons.Controls.Add(_test);

            Controls.Add(layout);
            Controls.Add(buttons);
            FormClosed += (s, e) => _testCts?.Cancel();
        }

        private static Label Hint(string text) =>
            new Label { Text = text, AutoSize = true, ForeColor = Theme.Dim, MaximumSize = new Size(490, 0), Margin = new Padding(0, 2, 0, 10) };

        private static void AddRow(TableLayoutPanel t, Control main, Control side)
        {
            main.Dock = DockStyle.Fill;
            var row = t.RowCount++;
            t.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            t.Controls.Add(main, 0, row);
            if (side != null) t.Controls.Add(side, 1, row);
            else t.SetColumnSpan(main, 2);
        }

        private string ModelId() =>
            _model.SelectedItem is ModelChoice m && _model.Text == m.Label ? m.Id : _model.Text.Trim();

        // Checks the key's shape. Returns false (with the reason on screen) when it can't call Claude.
        private bool KeyLooksUsable()
        {
            switch (ApiKeys.Classify(_key.Text))
            {
                case KeyKind.Claude:
                    return true;
                case KeyKind.Empty:
                    SetStatus("Paste a Claude API key first.", error: true);
                    return false;
                case KeyKind.Admin:
                    SetStatus("That's an Admin API key. It manages an organization and can't call Claude. " +
                              "Create a normal key at platform.claude.com > Settings > API keys.", error: true);
                    return false;
                case KeyKind.Unusual:
                    return Ui.Confirm(this, "Claude API keys start sk-ant-api03-. This one doesn't, so it is probably " +
                                            "an admin, analytics or compliance key that can't call Claude.\n\nUse it anyway?");
                default:
                    SetStatus("That isn't an Anthropic key (they start sk-ant-).", error: true);
                    return false;
            }
        }

        private void SetStatus(string text, bool error)
        {
            _status.Text = text;
            _status.ForeColor = error ? Theme.Error : Theme.Gold;
        }

        private void SaveAndClose()
        {
            if (!KeyLooksUsable()) return;
            _settings.ApiKey = _key.Text.Trim();
            _settings.Model = ModelId();
            _settings.Context = _context.Text.Trim();
            _settings.Save();
            DialogResult = DialogResult.OK;
        }

        private void RunTest()
        {
            if (!KeyLooksUsable()) return;
            _test.Enabled = false;
            SetStatus("Testing...", error: false);
            _testCts = new CancellationTokenSource();
            _client.SendAsync(_key.Text, ModelId(), "Reply with the single word OK.", "Connection test.", _testCts.Token)
                .ContinueWith(t =>
                {
                    var r = t.Status == TaskStatus.RanToCompletion ? t.Result : ClaudeResult.Fail(t.Exception?.GetBaseException().Message);
                    if (r.Cancelled || IsDisposed) return;
                    try
                    {
                        BeginInvoke((Action)(() =>
                        {
                            _test.Enabled = true;
                            if (r.Ok) SetStatus("Connected. Claude answered through your network. Click Save.", error: false);
                            else SetStatus(r.Error, error: true);
                        }));
                    }
                    catch (InvalidOperationException) { }
                }, TaskScheduler.Default);
        }

        // True when the user saved.
        public static bool Open(IWin32Window owner, ClaudeClient client)
        {
            using (var f = new SettingsForm(client))
            {
                return f.ShowDialog(owner) == DialogResult.OK;
            }
        }
    }
}
