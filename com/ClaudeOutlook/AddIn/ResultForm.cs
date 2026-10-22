using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

namespace ClaudeOutlook.AddIn
{
    // A button under Claude's answer. Run gets the (possibly edited) text; the window closes after.
    internal sealed class ResultAction
    {
        public ResultAction(string label, Action<string> run, string tip = null, bool primary = false)
        {
            Label = label; Run = run; Tip = tip; Primary = primary;
        }
        public string Label { get; }
        public Action<string> Run { get; }
        public string Tip { get; }
        public bool Primary { get; }
    }

    // Non-modal: Outlook stays usable while Claude works. Closing the window cancels the request.
    internal sealed class ResultForm : Form
    {
        private readonly CancellationTokenSource _cts = new CancellationTokenSource();
        private readonly Label _status;
        private readonly TextBox _text;
        private readonly FlowLayoutPanel _buttons;
        private readonly System.Windows.Forms.Timer _clock = new System.Windows.Forms.Timer { Interval = 1000 };
        private readonly ToolTip _tips = new ToolTip();
        private readonly string _model;
        private DateTime _started;

        public ResultForm(string title, string model)
        {
            _model = model;
            Theme.Apply(this, title);
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(620, 460);
            MinimumSize = new Size(420, 260);

            _status = Theme.Heading("");
            _status.Dock = DockStyle.Top;
            _text = Theme.Box(multiline: true);
            _text.Dock = DockStyle.Fill;
            _text.ReadOnly = true;
            _buttons = Theme.ButtonRow();

            Controls.Add(_text);
            Controls.Add(_buttons);
            Controls.Add(_status);

            _clock.Tick += (s, e) => ShowElapsed();
            FormClosed += (s, e) => { _cts.Cancel(); _clock.Dispose(); _tips.Dispose(); };
            ShowBusy();
        }

        public CancellationToken Token => _cts.Token;

        private void ShowBusy()
        {
            _started = DateTime.Now;
            _text.Text = "";
            SetButtons(Theme.Button("Cancel", primary: false), (s, e) => Close());
            ShowElapsed();
            _clock.Start();
        }

        private void ShowElapsed()
        {
            var secs = (int)(DateTime.Now - _started).TotalSeconds;
            _status.Text = ("Claude is working (" + _model + ") " + secs + " s").ToUpperInvariant();
        }

        // Runs on the UI thread, even when called from the request's background thread.
        public void Deliver(Action action)
        {
            try
            {
                if (!IsDisposed && IsHandleCreated) BeginInvoke(action);
            }
            catch (InvalidOperationException) { }
        }

        public void ShowError(string message)
        {
            _clock.Stop();
            _status.Text = "SOMETHING WENT WRONG";
            _status.ForeColor = Theme.Error;
            _text.Text = message;
            SetButtons(Theme.Button("Close", primary: true), (s, e) => Close());
        }

        public void ShowResult(string text, params ResultAction[] actions)
        {
            _clock.Stop();
            _status.Text = "CLAUDE  /  EDIT BEFORE USING IF YOU LIKE";
            _text.ReadOnly = false;
            _text.Text = text.Replace("\r\n", "\n").Replace("\n", "\r\n");
            _text.Select(0, 0);
            _buttons.Controls.Clear();

            var close = Theme.Button("Close", primary: false);
            close.Click += (s, e) => Close();
            _buttons.Controls.Add(close);
            var copy = Theme.Button("Copy", primary: actions.Length == 0);
            copy.Click += (s, e) => { Clipboard.SetText(_text.Text); Close(); };
            _buttons.Controls.Add(copy);

            // RightToLeft flow: add in reverse so the actions read left to right.
            for (var i = actions.Length - 1; i >= 0; i--)
            {
                var a = actions[i];
                var b = Theme.Button(a.Label, a.Primary);
                if (a.Tip != null) _tips.SetToolTip(b, a.Tip);
                b.Click += (s, e) => Use(a);
                _buttons.Controls.Add(b);
            }
        }

        private void Use(ResultAction a)
        {
            try
            {
                a.Run(_text.Text);
                Close();
            }
            catch (COMException ex)
            {
                // Keep Claude's text on screen so it can still be copied.
                Log.Error("ResultAction " + a.Label, ex);
                _status.Text = "OUTLOOK WOULDN'T TAKE IT. WAS THE DRAFT CLOSED? USE COPY INSTEAD.";
                _status.ForeColor = Theme.Error;
            }
        }

        private void SetButtons(Button only, EventHandler click)
        {
            _buttons.Controls.Clear();
            only.Click += click;
            _buttons.Controls.Add(only);
        }
    }
}
