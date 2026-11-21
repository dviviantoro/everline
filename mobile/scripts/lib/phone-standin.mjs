// The Android side of the app, stood in for by Node: answers the Capacitor plugins the way the phone's
// Java and Kotlin would (hotspot, geolocation, the held Cantol link over real TCP) so the real web bundle,
// the real Capacitor bridge JS and the real WASM codec can run unchanged in a browser.
//
// Shared by scripts/verify-field-web.mjs (headless Chromium, scripted) and scripts/serve-field-web.mjs
// (a web version of the app for a person to use). It does not replace a phone: nothing here is Android.
import net from 'node:net';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------------------------
// The stand-in for the Android side

/** What Capacitor's Android side injects so `registerPlugin` knows each plugin's methods. */
const promise = (...names) => names.map((name) => ({ name, rtype: 'promise' }));
const events = [{ name: 'addListener', rtype: 'none' }, { name: 'removeListener', rtype: 'none' }];
export const HEADERS = [
  { name: 'HotspotAssistant', methods: promise('isOn', 'openSettings') },
  {
    name: 'CantolLink',
    methods: [...promise('scan', 'listenBeacon', 'exchange', 'connect', 'send', 'disconnect', 'linkStatus', 'getLastKnown', 'setLastKnown', 'diagnostics'), ...events],
  },
  { name: 'GnssHelper', methods: promise('servicesEnabled', 'permissionState', 'openLocationSettings', 'openAppSettings') },
  {
    name: 'Geolocation',
    methods: [...promise('checkPermissions', 'requestPermissions', 'getCurrentPosition', 'clearWatch'), { name: 'watchPosition', rtype: 'callback' }],
  },
  { name: 'App', methods: [...promise('exitApp', 'getInfo', 'getState'), ...events] },
  { name: 'StatusBar', methods: promise('setStyle', 'setBackgroundColor', 'setOverlaysWebView', 'show', 'hide', 'getInfo') },
];

export const HEADER_LEN = 21;
export const CRC_LEN = 4;

/** One whole frame from a socket, by the length prefix (a test double of what FrameIo does in Java). */
function readFrame(socket, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    const timer = setTimeout(() => finish(new Error('Read timed out'), 'timeout'), timeoutMs);
    const finish = (error, code, frame) => {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('close', onClose);
      if (error) reject(Object.assign(error, { code }));
      else resolve(frame);
    };
    const onData = (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length >= HEADER_LEN) {
        if (buf[0] !== 0x57 || buf[1] !== 0xca) return finish(new Error('not a Cantol frame (bad magic)'), 'io');
        const total = HEADER_LEN + buf.readUInt32LE(17) + CRC_LEN;
        if (buf.length >= total) finish(null, null, buf.subarray(0, total));
      }
    };
    const onError = (error) => finish(error, 'io');
    const onClose = () => finish(new Error('the link was closed'), 'io');
    socket.on('data', onData);
    socket.once('error', onError);
    socket.once('close', onClose);
  });
}

function connectSocket(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(Object.assign(new Error('Connect timed out'), { code: 'timeout' }));
    }, timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.setNoDelay(true);
      resolve(socket);
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(Object.assign(error, { code: error.code === 'ECONNREFUSED' ? 'refused' : 'io' }));
    });
  });
}

/** Every GPS watch timer, so the process can end. */
export const watchTimers = new Set();

/**
 * @param respond  how an answer or event reaches the page
 * @param options.port       the Cantol's port (the profile's)
 * @param options.scanHosts  what a scan of the hotspot subnet finds (default: the local mock)
 * @param options.allow      (host, port) => boolean: which connections the page may ask for (default: any)
 * @param options.position   () => {latitude, longitude, accuracy}: what the GPS reads (default: a fixed point)
 * @param options.keepAlive  send the heartbeat every `intervalMs` as the Java link does (default: once, at connect;
 *                           a real Cantol closes a peer that stays silent for 30 s)
 */
export function createPhone(
  respond,
  {
    port = 47000,
    scanHosts = ['127.0.0.1'],
    allow = () => true,
    position = () => ({ latitude: -6.8897, longitude: 109.6753, accuracy: 6.2 }),
    keepAlive = false,
  } = {},
) {
  const phone = {
    hotspotOn: false,
    // A fresh phone: location services are off. The real geolocation plugin then REJECTS both of its
    // permission calls (OS-PLUG-GLOC-0007), which is what once left the app stuck on the welcome screen.
    locationOn: false,
    // A plugin that fails outright, to prove no failing check can trap the app on the welcome screen.
    gnssBroken: true,
    permission: 'prompt',
    permissionRequests: 0,
    blockExchange: false,
    // The Live screen: frames the app wrote on the held link (Start, Stop), how many of each kind came
    // back from the device, and two ways to make it go wrong.
    sent: [],
    pulseFrames: 0,
    statusFrames: 0,
    failSend: false,
    muteFrames: false,
    lastKnown: undefined,
    held: null,
    heldHost: null,
    lastRx: 0,
    heldRtt: NaN,
    heartbeat: null,
    heldPort: port,
    calls: [],
    exchanged: [],
    connects: [],
    scans: [],
    listeners: [],
    watchers: new Map(),
    watchOptions: [],
  };

  const emit = (pluginId, eventName, data) => {
    for (const l of phone.listeners) {
      if (l.pluginId === pluginId && l.eventName === eventName) {
        respond({ callbackId: l.callbackId, pluginId, methodName: eventName, success: true, data, save: true });
      }
    }
  };

  async function hold(host, port, heartbeat, intervalMs) {
    const socket = await connectSocket(host, port, 1500);
    const started = Date.now();
    let answered;
    let giveUp;
    const firstFrame = new Promise((resolve, reject) => {
      answered = resolve;
      giveUp = setTimeout(() => reject(Object.assign(new Error('Read timed out'), { code: 'timeout' })), 2000);
    });
    // Cut the stream into whole frames, as FrameIo does; each frame proves the link is alive and,
    // while the app listens for `frame`, is handed over as the plugin does.
    let buf = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= HEADER_LEN) {
        if (buf[0] !== 0x57 || buf[1] !== 0xca) {
          socket.destroy();
          return;
        }
        const total = HEADER_LEN + buf.readUInt32LE(17) + CRC_LEN;
        if (buf.length < total) return;
        const frame = Buffer.from(buf.subarray(0, total));
        buf = buf.subarray(total);
        phone.lastRx = Date.now();
        answered();
        if (frame[3] === 0x10) phone.pulseFrames += 1;
        if (frame[3] === 0x03) phone.statusFrames += 1;
        const listening = phone.listeners.some((l) => l.pluginId === 'CantolLink' && l.eventName === 'frame');
        if (listening && !phone.muteFrames) emit('CantolLink', 'frame', { dataB64: frame.toString('base64') });
      }
    });
    socket.on('error', () => undefined);
    socket.write(heartbeat);
    try {
      await firstFrame;
    } catch (error) {
      socket.destroy();
      throw error;
    } finally {
      clearTimeout(giveUp);
    }
    phone.heldRtt = Date.now() - started;
    phone.lastRx = Date.now();
    phone.held = socket;
    phone.heldHost = host;
    phone.heldPort = port;
    phone.heartbeat = heartbeat;
    phone.intervalMs = intervalMs;
    if (keepAlive && intervalMs > 0) {
      const timer = setInterval(() => {
        if (!socket.destroyed) socket.write(heartbeat);
      }, intervalMs);
      watchTimers.add(timer);
      socket.once('close', () => {
        clearInterval(timer);
        watchTimers.delete(timer);
      });
    }
    return phone.heldRtt;
  }

  phone.loseLink = () => {
    phone.blockExchange = true;
    phone.held?.destroy();
    phone.held = null;
    emit('CantolLink', 'linkState', { state: 'lost', detail: 'no answer within 2000 ms' });
  };
  phone.restoreLink = async () => {
    phone.blockExchange = false;
    if (phone.heldHost !== null) await hold(phone.heldHost, phone.heldPort, phone.heartbeat, phone.intervalMs);
    emit('CantolLink', 'linkState', { state: 'up', detail: 'reconnected' });
  };

  /** What the real geolocation plugin does in checkPermissions and requestPermissions (read from its source). */
  phone.requireLocationOn = () => {
    if (phone.gnssBroken) throw new Error('simulated plugin failure');
    if (!phone.locationOn) throw Object.assign(new Error('Location services are not enabled.'), { code: 'OS-PLUG-GLOC-0007' });
  };

  phone.handle = async ({ pluginId, methodName, options, callbackId }) => {
    phone.calls.push(`${pluginId}.${methodName}`);
    if (methodName === 'addListener') {
      phone.listeners.push({ pluginId, eventName: options.eventName, callbackId });
      return undefined; // kept alive; events arrive later
    }
    if (methodName === 'removeListener') {
      // Capacitor passes the original listener as this call's own callback, so a reply here would
      // fire it (a "backButton" listener would navigate back). The real Android side stays silent.
      phone.listeners = phone.listeners.filter((l) => l.callbackId !== options.callbackId);
      return undefined;
    }
    const key = `${pluginId}.${methodName}`;
    switch (key) {
      case 'HotspotAssistant.isOn':
        return phone.hotspotOn ? { on: true, iface: 'ap0', address: '127.0.0.1', prefix: 24 } : { on: false };
      case 'HotspotAssistant.openSettings':
        setTimeout(() => {
          phone.hotspotOn = true;
        }, 1500);
        return { index: 0, label: 'Tethering settings', exact: true };
      case 'CantolLink.scan':
        phone.scans.push(options);
        await sleep(300);
        return phone.hotspotOn ? { subnet: `${scanHosts[0]}/24`, scanned: 253, hosts: scanHosts } : { scanned: 0, hosts: [] };
      case 'CantolLink.listenBeacon':
        await sleep(options.timeoutMs ?? 1500);
        return { timedOut: true };
      case 'CantolLink.exchange': {
        phone.exchanged.push({ host: options.host, port: options.port, frame: Buffer.from(options.dataB64, 'base64') });
        if (!allow(options.host, options.port)) throw Object.assign(new Error('this host is not allowed'), { code: 'io' });
        if (phone.blockExchange) throw Object.assign(new Error('Read timed out'), { code: 'timeout' });
        const socket = await connectSocket(options.host, options.port, options.connectTimeoutMs ?? 800);
        try {
          const started = process.hrtime.bigint();
          socket.write(Buffer.from(options.dataB64, 'base64'));
          const frame = await readFrame(socket, options.readTimeoutMs ?? 1500);
          return { replyB64: frame.toString('base64'), rttMs: Number(process.hrtime.bigint() - started) / 1e6 };
        } finally {
          socket.destroy();
        }
      }
      case 'CantolLink.connect': {
        const heartbeat = Buffer.from(options.heartbeatB64, 'base64');
        if (!allow(options.host, options.port)) throw Object.assign(new Error('this host is not allowed'), { code: 'io' });
        phone.connects.push({ host: options.host, port: options.port, heartbeat, intervalMs: options.intervalMs });
        const rttMs = await hold(options.host, options.port, heartbeat, options.intervalMs);
        phone.lastKnown = options.host;
        return { rttMs };
      }
      case 'CantolLink.send': {
        if (phone.failSend || phone.held === null) throw Object.assign(new Error('the Cantol link is not up'), { code: 'not_connected' });
        const frame = Buffer.from(options.dataB64, 'base64');
        phone.sent.push(frame);
        phone.held.write(frame);
        return {};
      }
      case 'CantolLink.disconnect':
        phone.held?.destroy();
        phone.held = null;
        phone.heldHost = null;
        return {};
      case 'CantolLink.linkStatus':
        return phone.held === null
          ? { connected: false }
          : { connected: true, host: phone.heldHost, lastRxAgeMs: Date.now() - phone.lastRx, rttMs: phone.heldRtt };
      case 'CantolLink.getLastKnown':
        return phone.lastKnown === undefined ? {} : { address: phone.lastKnown };
      case 'CantolLink.setLastKnown':
        phone.lastKnown = options.address;
        return {};
      case 'CantolLink.diagnostics':
        return { rows: [{ label: 'Hotspot interface', value: phone.hotspotOn ? 'ap0 127.0.0.1/24' : 'none found' }] };
      case 'GnssHelper.servicesEnabled':
        if (phone.gnssBroken) throw new Error('simulated plugin failure');
        return { enabled: phone.locationOn };
      case 'GnssHelper.permissionState':
        return { fine: phone.permission === 'granted', coarse: phone.permission === 'granted' };
      case 'GnssHelper.openLocationSettings':
        setTimeout(() => {
          phone.locationOn = true;
        }, 1000);
        return {};
      case 'GnssHelper.openAppSettings':
        // The operator allows location in the app's settings and comes back.
        setTimeout(() => {
          phone.permission = 'granted';
        }, 800);
        return {};
      case 'Geolocation.checkPermissions':
        phone.requireLocationOn();
        return { location: phone.permission, coarseLocation: phone.permission };
      case 'Geolocation.requestPermissions':
        phone.requireLocationOn();
        phone.permissionRequests += 1;
        // Android: "prompt" -> refused once -> "prompt-with-rationale" -> refused again -> "denied" (blocked).
        if (phone.permission !== 'granted') phone.permission = phone.permissionRequests === 1 ? 'prompt-with-rationale' : 'denied';
        return { location: phone.permission, coarseLocation: phone.permission };
      case 'Geolocation.watchPosition': {
        phone.watchOptions.push(options);
        // How often the real plugin passes a position on (read from GeolocationPlugin.kt): it asks the system every
        // `interval`, which defaults to `timeout`, and never faster than `minimumUpdateInterval`, which defaults to 5 s.
        const period = Math.max(options.interval ?? options.timeout ?? 10000, options.minimumUpdateInterval ?? 5000);
        const timer = setInterval(() => {
          if (!phone.locationOn || phone.permission !== 'granted') return;
          respond({
            callbackId,
            pluginId,
            methodName,
            success: true,
            save: true,
            data: { timestamp: Date.now(), coords: position() },
          });
        }, period);
        phone.watchers.set(callbackId, timer);
        watchTimers.add(timer);
        return undefined;
      }
      case 'Geolocation.clearWatch':
        clearInterval(phone.watchers.get(options.id));
        phone.watchers.delete(options.id);
        return {};
      default:
        return {}; // App, StatusBar and anything else the shell calls: accepted, nothing to do
    }
  };
  return phone;
}
