using System;
using System.Net;
using System.Runtime.InteropServices;
using Outlook = Microsoft.Office.Interop.Outlook;

[assembly: ComVisible(false)]

namespace ClaudeOutlook.AddIn
{
    // The COM add-in Outlook loads (registered by install.cmd under this CLSID and ProgId).
    // AutoDispatch matters: Office finds the ribbon callbacks (OnAction, LoadImage) by name through IDispatch.
    [ComVisible(true)]
    [Guid(Clsid)]
    [ProgId(ProgIdName)]
    [ClassInterface(ClassInterfaceType.AutoDispatch)]
    public class Connect : IDTExtensibility2, IRibbonExtensibility
    {
        public const string Clsid = "83000B78-7DD0-4B7C-9BE5-DF621925674D";
        public const string ProgIdName = "ClaudeOutlook.Connect";

        private Commands _commands;

        public void OnConnection(object Application, ext_ConnectMode ConnectMode, object AddInInst, ref Array custom)
        {
            try
            {
                // A COM-hosted CLR can default to old TLS versions; the API needs 1.2 or later.
                ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
                _commands = new Commands((Outlook.Application)Application);
            }
            catch (Exception ex)
            {
                Log.Error("OnConnection", ex);
            }
        }

        public void OnDisconnection(ext_DisconnectMode RemoveMode, ref Array custom)
        {
            _commands?.Dispose();
            _commands = null;
        }

        public void OnAddInsUpdate(ref Array custom) { }
        public void OnStartupComplete(ref Array custom) { }
        public void OnBeginShutdown(ref Array custom) { }

        public string GetCustomUI(string RibbonID)
        {
            try { return Core.Ribbon.For(RibbonID); }
            catch (Exception ex) { Log.Error("GetCustomUI", ex); return null; }
        }

        // Ribbon callbacks. Exceptions must never escape into Outlook, or it disables the add-in.
        public void OnAction(IRibbonControl control)
        {
            try
            {
                if (_commands == null) throw new InvalidOperationException("Claude didn't start. See the log in %LOCALAPPDATA%\\ClaudeOutlook.");
                _commands.Run(control.Id, control.Context);
            }
            catch (Exception ex)
            {
                Log.Error("OnAction " + control?.Id, ex);
                Ui.Error(null, ex.Message);
            }
        }

        public object LoadImage(string imageId)
        {
            try { return Icons.Picture(); }
            catch (Exception ex) { Log.Error("LoadImage", ex); return null; }
        }
    }
}
