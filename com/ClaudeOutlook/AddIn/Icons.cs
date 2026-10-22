using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.Windows.Forms;

namespace ClaudeOutlook.AddIn
{
    // The ribbon icon: a gold C on near-black, drawn at runtime so the DLL carries no resources.
    internal static class Icons
    {
        private static object _picture;

        public static object Picture() => _picture ?? (_picture = PictureConverter.From(Draw(32)));

        private static Bitmap Draw(int size)
        {
            var bmp = new Bitmap(size, size);
            using (var g = Graphics.FromImage(bmp))
            using (var bg = new SolidBrush(Theme.Background))
            using (var gold = new SolidBrush(Theme.Gold))
            using (var font = new Font("Georgia", size * 0.62f, FontStyle.Bold, GraphicsUnit.Pixel))
            using (var fmt = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center })
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
                g.FillRectangle(bg, 0, 0, size, size);
                g.DrawString("C", font, gold, new RectangleF(0, size * 0.04f, size, size), fmt);
            }
            return bmp;
        }

        // AxHost exposes the Image -> IPictureDisp conversion Office wants, but only to subclasses.
        private sealed class PictureConverter : AxHost
        {
            private PictureConverter() : base(string.Empty) { }
            public static object From(Image image) => GetIPictureDispFromPicture(image);
        }
    }
}
