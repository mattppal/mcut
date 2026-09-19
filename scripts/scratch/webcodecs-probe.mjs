import { app, BrowserWindow, net, protocol } from "electron";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scratchDir = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.join(scratchDir, "probe.html");

if (process.platform === "linux") {
  app.commandLine.appendSwitch("no-sandbox");
  app.commandLine.appendSwitch("disable-gpu");
}

protocol.registerSchemesAsPrivileged([
  { scheme: "probe", privileges: { standard: true, secure: true } },
]);

const rendererProbe = `(async () => {
  async function check(run) {
    try {
      const result = await run();
      return { supported: Boolean(result.supported) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }

  const video = {
    width: 1920,
    height: 1080,
    bitrate: 6_000_000,
    framerate: 30,
  };

  const audio = {
    sampleRate: 48000,
    numberOfChannels: 2,
    bitrate: 128_000,
  };

  return {
    h264Baseline: await check(() =>
      VideoEncoder.isConfigSupported({ codec: "avc1.42001E", ...video }),
    ),
    h264BaselineHw: await check(() =>
      VideoEncoder.isConfigSupported({
        codec: "avc1.42001E",
        ...video,
        hardwareAcceleration: "prefer-hardware",
      }),
    ),
    h264BaselineSw: await check(() =>
      VideoEncoder.isConfigSupported({
        codec: "avc1.42001E",
        ...video,
        hardwareAcceleration: "prefer-software",
      }),
    ),
    h264High: await check(() =>
      VideoEncoder.isConfigSupported({ codec: "avc1.640028", ...video }),
    ),
    vp9: await check(() =>
      VideoEncoder.isConfigSupported({ codec: "vp09.00.10.08", ...video }),
    ),
    hevc: await check(() =>
      VideoEncoder.isConfigSupported({ codec: "hvc1.1.6.L93.B0", ...video }),
    ),
    aac: await check(() =>
      AudioEncoder.isConfigSupported({ codec: "mp4a.40.2", ...audio }),
    ),
    opus: await check(() =>
      AudioEncoder.isConfigSupported({ codec: "opus", ...audio }),
    ),
    decodeH264: await check(() =>
      VideoDecoder.isConfigSupported({ codec: "avc1.42001E" }),
    ),
    decodeHevc: await check(() =>
      VideoDecoder.isConfigSupported({ codec: "hvc1.1.6.L93.B0" }),
    ),
    userAgent: navigator.userAgent,
    "typeof VideoEncoder": typeof VideoEncoder,
    isSecureContext: window.isSecureContext,
    href: location.href,
  };
})()`;

function loadAndWait(win, startLoad) {
  return new Promise((resolve, reject) => {
    const onLoad = () => {
      cleanup();
      resolve();
    };
    const onFail = (_event, errorCode, errorDescription) => {
      cleanup();
      reject(new Error(errorDescription || String(errorCode)));
    };
    const cleanup = () => {
      win.webContents.off("did-finish-load", onLoad);
      win.webContents.off("did-fail-load", onFail);
    };
    win.webContents.once("did-finish-load", onLoad);
    win.webContents.once("did-fail-load", onFail);
    startLoad();
  });
}

app.whenReady().then(async () => {
  console.log(`electron ${process.versions.electron}`);
  console.log(`chrome ${process.versions.chrome}`);

  protocol.handle("probe", (request) => {
    const { pathname } = new URL(request.url);
    const name = pathname === "/" ? "probe.html" : path.basename(pathname);
    return net.fetch(pathToFileURL(path.join(scratchDir, name)).href);
  });

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: false,
    },
  });

  try {
    await loadAndWait(win, () => {
      void win.loadFile(htmlPath);
    });
    let result = await win.webContents.executeJavaScript(rendererProbe);

    if (result.isSecureContext !== true) {
      await loadAndWait(win, () => {
        void win.loadURL("probe://app/probe.html");
      });
      result = await win.webContents.executeJavaScript(rendererProbe);
    }

    console.log(`PROBE ${JSON.stringify(result)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`PROBE ${JSON.stringify({ error: message })}`);
  }

  app.exit(0);
});
