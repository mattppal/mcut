import { app, BrowserWindow } from "electron";

if (process.platform === "linux") {
  app.commandLine.appendSwitch("no-sandbox");
  app.commandLine.appendSwitch("disable-gpu");
}

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
  };
})()`;

app.whenReady().then(async () => {
  console.log(`electron ${process.versions.electron}`);
  console.log(`chrome ${process.versions.chrome}`);

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: false,
    },
  });

  try {
    await win.loadURL("about:blank");
    const result = await win.webContents.executeJavaScript(rendererProbe);
    console.log(`PROBE ${JSON.stringify(result)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`PROBE ${JSON.stringify({ error: message })}`);
  }

  app.exit(0);
});
