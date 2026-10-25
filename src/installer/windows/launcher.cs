// The Windows setup .exe for a yapin.js-client app.
//
// The build appends the installer (installer.mjs, installer.json, payload/) to this program as a
// compressed bundle. When run, it unpacks the bundle to a private temporary folder, runs the installer
// with the Node built into the Yapin' desktop app (or node, if installed), waits for it, and removes
// the folder. Problems are shown in a message box rather than a console window.
//
//   setup.exe                      opens the installer page in the browser
//   setup.exe --extract [--to dir] unpacks the installer next to the .exe (for the terminal installer)
//   setup.exe <command> [options]  passed to the installer (install, repair, uninstall, status, --yes, ...)
//
// Built with the C# 5 compiler that ships with the .NET Framework (csc.exe), so no SDK is needed.
// src/build/windows.js fills in the __PLACEHOLDERS__.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Text;
using System.Windows.Forms;

[assembly: AssemblyTitle("__TITLE__")]
[assembly: AssemblyProduct("__PRODUCT__")]
[assembly: AssemblyDescription("__DESCRIPTION__")]
[assembly: AssemblyCompany("__COMPANY__")]
[assembly: AssemblyCopyright("__COPYRIGHT__")]
[assembly: AssemblyVersion("__FILEVERSION__")]
[assembly: AssemblyFileVersion("__FILEVERSION__")]
[assembly: AssemblyInformationalVersion("__VERSION__")]

static class Launcher
{
    const string Magic = "YAPINCLIENTPKG01";
    const int TrailerSize = 24;
    static string title = "Installer";

    [STAThread]
    static int Main(string[] args)
    {
        Application.EnableVisualStyles();
        string dir = null;
        try
        {
            string self = Assembly.GetExecutingAssembly().Location;
            Dictionary<string, byte[]> files = ReadBundle(self);
            Dictionary<string, string> meta = ReadMeta(files);
            if (meta.ContainsKey("name")) title = meta["name"] + " installer";
            string id = meta.ContainsKey("id") ? meta["id"] : "client";

            int extractAt = Array.IndexOf(args, "--extract");
            if (extractAt >= 0)
            {
                int toAt = Array.IndexOf(args, "--to");
                string target = toAt >= 0 && toAt + 1 < args.Length ? args[toAt + 1] : Path.Combine(Path.GetDirectoryName(self), id + "-installer");
                WriteFiles(files, target);
                if (Array.IndexOf(args, "--quiet") < 0) Process.Start("explorer.exe", Quote(target));
                return 0;
            }

            bool electron;
            string runtime = FindRuntime(meta, out electron);
            if (runtime == null)
            {
                Fail("Couldn't find the Yapin' desktop app on this computer.\n\nInstall it from https://www.yapin.gg, open it once, then run this installer again.");
                return 1;
            }

            dir = Path.Combine(Path.GetTempPath(), "yapin-client-installer", id + "-" + Guid.NewGuid().ToString("N").Substring(0, 12));
            WriteFiles(files, dir);

            StringBuilder arguments = new StringBuilder(Quote(Path.Combine(dir, "installer.mjs")));
            if (args.Length == 0) arguments.Append(" --gui");
            foreach (string arg in args) arguments.Append(' ').Append(Quote(arg));

            ProcessStartInfo start = new ProcessStartInfo(runtime, arguments.ToString());
            start.UseShellExecute = false;
            start.CreateNoWindow = true;
            start.RedirectStandardError = true;
            start.RedirectStandardOutput = true;
            start.WorkingDirectory = dir;
            if (electron) start.EnvironmentVariables["ELECTRON_RUN_AS_NODE"] = "1";
            else start.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");

            StringBuilder output = new StringBuilder();
            using (Process process = Process.Start(start))
            {
                DataReceivedEventHandler collect = delegate (object sender, DataReceivedEventArgs e)
                {
                    if (e.Data == null) return;
                    lock (output)
                    {
                        output.AppendLine(e.Data);
                        if (output.Length > 8000) output.Remove(0, output.Length - 8000);
                    }
                };
                process.OutputDataReceived += collect;
                process.ErrorDataReceived += collect;
                process.BeginOutputReadLine();
                process.BeginErrorReadLine();
                process.WaitForExit();
                if (process.ExitCode != 0)
                {
                    string text;
                    lock (output) text = output.ToString().Trim();
                    Fail("The installer stopped with an error.\n\n" + Strip(text));
                    return process.ExitCode;
                }
            }
            return 0;
        }
        catch (Exception error)
        {
            Fail(error.Message);
            return 1;
        }
        finally
        {
            if (dir != null)
            {
                try { Directory.Delete(dir, true); } catch { }
            }
        }
    }

    static void Fail(string message)
    {
        MessageBox.Show(message, title, MessageBoxButtons.OK, MessageBoxIcon.Error);
    }

    /// Removes terminal colour codes from the installer's output.
    static string Strip(string text)
    {
        StringBuilder clean = new StringBuilder();
        for (int i = 0; i < text.Length; i++)
        {
            if (text[i] == (char)27 && i + 1 < text.Length && text[i + 1] == '[')
            {
                i += 2;
                while (i < text.Length && !char.IsLetter(text[i])) i++;
                continue;
            }
            clean.Append(text[i]);
        }
        string result = clean.ToString();
        return result.Length > 1500 ? "..." + result.Substring(result.Length - 1500) : result;
    }

    /// Quotes one command-line argument the way the Windows C runtime parses it.
    static string Quote(string arg)
    {
        if (arg.Length > 0 && arg.IndexOfAny(new[] { ' ', '\t', '"' }) < 0) return arg;
        StringBuilder quoted = new StringBuilder("\"");
        int slashes = 0;
        foreach (char c in arg)
        {
            if (c == '\\') { slashes++; continue; }
            if (c == '"') quoted.Append('\\', slashes * 2 + 1);
            else quoted.Append('\\', slashes);
            slashes = 0;
            quoted.Append(c);
        }
        quoted.Append('\\', slashes * 2).Append('"');
        return quoted.ToString();
    }

    static string FindRuntime(Dictionary<string, string> meta, out bool electron)
    {
        electron = true;
        List<string> candidates = new List<string>();
        if (meta.ContainsKey("exe")) candidates.AddRange(meta["exe"].Split('|'));
        candidates.Add(@"%LOCALAPPDATA%\Programs\yapper-desktop\Yapper.exe");
        candidates.Add(@"%PROGRAMFILES%\Yapper\Yapper.exe");
        candidates.Add(@"%PROGRAMFILES%\yapper-desktop\Yapper.exe");
        foreach (string candidate in candidates)
        {
            if (candidate.Length == 0) continue;
            string path = Environment.ExpandEnvironmentVariables(candidate);
            if (File.Exists(path)) return path;
        }
        electron = false;
        string pathVar = Environment.GetEnvironmentVariable("PATH") ?? "";
        foreach (string folder in pathVar.Split(';'))
        {
            try
            {
                string node = Path.Combine(folder.Trim().Trim('"'), "node.exe");
                if (folder.Trim().Length > 0 && File.Exists(node)) return node;
            }
            catch (ArgumentException) { }
        }
        return null;
    }

    /// Finds the bundle at the end of the file (before the signature, if the .exe is signed) and unpacks it.
    static Dictionary<string, byte[]> ReadBundle(string self)
    {
        using (FileStream file = File.OpenRead(self))
        using (BinaryReader reader = new BinaryReader(file))
        {
            long end = file.Length;
            file.Position = 0x3C;
            int peOffset = reader.ReadInt32();
            file.Position = peOffset + 24;
            ushort magic = reader.ReadUInt16();
            long certEntry = peOffset + 24 + (magic == 0x20b ? 112 : 96) + 4 * 8;
            file.Position = certEntry;
            uint certOffset = reader.ReadUInt32();
            uint certSize = reader.ReadUInt32();
            if (certSize > 0 && certOffset > 0 && certOffset <= file.Length) end = certOffset;

            byte[] magicBytes = Encoding.ASCII.GetBytes(Magic);
            for (long trailer = end - TrailerSize; trailer >= Math.Max(0, end - TrailerSize - 16); trailer--)
            {
                file.Position = trailer + 8;
                byte[] found = reader.ReadBytes(16);
                bool match = true;
                for (int i = 0; i < 16; i++) if (found[i] != magicBytes[i]) { match = false; break; }
                if (!match) continue;
                file.Position = trailer;
                long length = reader.ReadInt64();
                if (length <= 0 || length > trailer) break;
                file.Position = trailer - length;
                byte[] compressed = reader.ReadBytes((int)length);
                return Unpack(compressed);
            }
        }
        throw new InvalidDataException("This installer is damaged (no bundle found). Download it again.");
    }

    static Dictionary<string, byte[]> Unpack(byte[] compressed)
    {
        Dictionary<string, byte[]> files = new Dictionary<string, byte[]>();
        using (MemoryStream input = new MemoryStream(compressed))
        using (GZipStream gzip = new GZipStream(input, CompressionMode.Decompress))
        using (MemoryStream plain = new MemoryStream())
        {
            gzip.CopyTo(plain);
            plain.Position = 0;
            using (BinaryReader reader = new BinaryReader(plain))
            {
                int count = reader.ReadInt32();
                for (int i = 0; i < count; i++)
                {
                    string name = Encoding.UTF8.GetString(reader.ReadBytes(reader.ReadInt32()));
                    byte[] data = reader.ReadBytes(reader.ReadInt32());
                    files[name] = data;
                }
            }
        }
        return files;
    }

    static Dictionary<string, string> ReadMeta(Dictionary<string, byte[]> files)
    {
        Dictionary<string, string> meta = new Dictionary<string, string>();
        byte[] raw;
        if (!files.TryGetValue("__meta.txt", out raw)) return meta;
        foreach (string line in Encoding.UTF8.GetString(raw).Split('\n'))
        {
            int eq = line.IndexOf('=');
            if (eq > 0) meta[line.Substring(0, eq).Trim()] = line.Substring(eq + 1).Trim();
        }
        return meta;
    }

    static void WriteFiles(Dictionary<string, byte[]> files, string root)
    {
        string full = Path.GetFullPath(root);
        foreach (KeyValuePair<string, byte[]> entry in files)
        {
            if (entry.Key == "__meta.txt") continue;
            string target = Path.GetFullPath(Path.Combine(full, entry.Key.Replace('/', '\\')));
            if (!target.StartsWith(full + "\\", StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Bad path in installer: " + entry.Key);
            Directory.CreateDirectory(Path.GetDirectoryName(target));
            File.WriteAllBytes(target, entry.Value);
        }
    }
}
