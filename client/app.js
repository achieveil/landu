import { checksum } from './checksum.js';

const dom = {
  currentDisplayName: document.getElementById('currentDisplayName'),
  pinButton: document.getElementById('pinButton'),
  pinValue: document.getElementById('pinValue'),
  pinDialog: document.getElementById('pinDialog'),
  pinInput: document.getElementById('pinInput'),
  peerList: document.getElementById('peerList'),
  emptyPeers: document.getElementById('emptyPeers'),
  mdnsAddress: document.getElementById('mdnsAddress'),
  ipAddress: document.getElementById('ipAddress'),
  qrToggle: document.getElementById('qrToggle'),
  addressQr: document.getElementById('addressQr'),
  qrLabel: document.getElementById('qrLabel'),
  fileInput: document.getElementById('fileInput'),
  fileList: document.getElementById('fileList'),
  clipboardText: document.getElementById('clipboardText'),
  clipboardState: document.getElementById('clipboardState'),
  readClipboardBtn: document.getElementById('readClipboardBtn'),
  copyClipboardBtn: document.getElementById('copyClipboardBtn'),
  themeToggle: document.getElementById('themeToggle'),
  themeIcon: document.getElementById('themeIcon'),
  transferModal: document.getElementById('transferModal'),
  transferTitle: document.getElementById('transferTitle'),
  transferTotalText: document.getElementById('transferTotalText'),
  transferTotalProgress: document.getElementById('transferTotalProgress'),
  transferFileName: document.getElementById('transferFileName'),
  transferFileSize: document.getElementById('transferFileSize'),
  transferFileProgress: document.getElementById('transferFileProgress'),
  toast: document.getElementById('toast'),
};

const FILE_CHUNK_SIZE = 256 * 1024;
const RTC_CONNECT_TIMEOUT = 3500;
const RTC_BUFFER_LIMIT = 1024 * 1024;
const SIGNALING_URL = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`;
const CLIENT_TOKEN_PREFIX = 'landu:';
const adjectives = ['Nice', 'Cute', 'Fantastic', 'Brave', 'Gentle', 'Swift'];
const nouns = ['Avocado', 'Blueberry', 'Lemon', 'Mango', 'Coconut', 'Peach'];

const randomId = () => {
  const webCrypto = globalThis.crypto;
  if (webCrypto?.randomUUID) return webCrypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (webCrypto?.getRandomValues) {
    webCrypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
};

const randomName = () =>
  `${adjectives[Math.floor(Math.random() * adjectives.length)]} ${
    nouns[Math.floor(Math.random() * nouns.length)]
  }`;

const loadName = () => {
  try {
    const existing = localStorage.getItem('landu:displayName');
    if (existing) return existing;
    const name = randomName();
    localStorage.setItem('landu:displayName', name);
    return name;
  } catch {
    return randomName();
  }
};

const loadToken = () => {
  try {
    const existing = localStorage.getItem('landu:token');
    if (existing?.startsWith(CLIENT_TOKEN_PREFIX)) return existing;
    const token = `${CLIENT_TOKEN_PREFIX}${randomId()}`;
    localStorage.setItem('landu:token', token);
    return token;
  } catch {
    return `${CLIENT_TOKEN_PREFIX}${randomId()}`;
  }
};

const loadPin = () => {
  try {
    return localStorage.getItem('landu:pin') || '';
  } catch {
    return '';
  }
};

const loadTheme = () => {
  try {
    return localStorage.getItem('landu:theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  } catch {
    return 'light';
  }
};

const applyTheme = (theme) => {
  const nextTheme = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = nextTheme;
  dom.themeIcon.textContent = nextTheme === 'dark' ? 'light_mode' : 'dark_mode';
  dom.themeToggle.setAttribute('aria-label', nextTheme === 'dark' ? '切换浅色模式' : '切换深色模式');
  try {
    localStorage.setItem('landu:theme', nextTheme);
  } catch {
    /* ignored */
  }
};

const toBase64 = (value) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(value)))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

const clientInfo = () => ({
  alias: state.displayName,
  version: '2.1',
  deviceModel: `Landu · ${state.platform}`,
  deviceType: 'WEB',
  token: state.token,
  pin: state.pin,
});

const toPeer = (peer) => {
  if (!peer?.token?.startsWith(CLIENT_TOKEN_PREFIX)) return null;
  if (peer.token === state.token) return null;
  return {
    id: peer.id,
    name: peer.alias || 'Landu',
    platform: peer.deviceModel || peer.deviceType || 'Web',
  };
};

const platformLabel = () => {
  const ua = navigator.userAgent;
  const os = /Mac/i.test(ua) ? 'macOS' : /Windows/i.test(ua) ? 'Windows' : /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS' : 'Web';
  const browser = /Firefox/i.test(ua) ? 'Firefox' : /Edg/i.test(ua) ? 'Edge' : /Safari/i.test(ua) && !/Chrome/i.test(ua) ? 'Safari' : 'Chrome';
  return `${os} · ${browser}`;
};

const state = {
  id: '',
  displayName: loadName(),
  token: loadToken(),
  pin: loadPin(),
  platform: platformLabel(),
  peers: new Map(),
  activePeerId: '',
  ws: null,
  pingTimer: 0,
  clipboardTimer: 0,
  incomingFiles: new Map(),
  outgoingFileAcks: new Map(),
  pendingRtcChunks: new Map(),
  rtc: new Map(),
  addresses: { mdns: '', ip: '' },
  addressMode: 'mdns',
};

applyTheme(loadTheme());
dom.currentDisplayName.textContent = state.displayName;
dom.pinValue.textContent = state.pin || '未设置';

const showToast = (message) => {
  dom.toast.textContent = message;
  dom.toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    dom.toast.hidden = true;
  }, 2600);
};

const updateTransferUi = () => {};

const selectedAddress = () =>
  (state.addressMode === 'ip' && state.addresses.ip ? state.addresses.ip : state.addresses.mdns) ||
  location.origin;

const updateAddressDisplay = () => {
  const url = selectedAddress();
  const label = state.addressMode === 'ip' && state.addresses.ip ? 'IP 地址' : 'mDNS 地址';
  dom.mdnsAddress.textContent = state.addresses.mdns || location.origin;
  dom.ipAddress.textContent = state.addresses.ip || '未找到 IP 地址';
  dom.qrLabel.textContent = label;
  dom.addressQr.src = `/api/qr?text=${encodeURIComponent(url)}`;
};

const loadAddresses = async () => {
  try {
    const response = await fetch('/api/addresses');
    state.addresses = await response.json();
  } catch {
    state.addresses = { mdns: location.origin, ip: '' };
  }
  updateAddressDisplay();
};

const renderPeers = () => {
  dom.peerList.innerHTML = '';
  dom.emptyPeers.hidden = state.peers.size > 0;
  for (const peer of state.peers.values()) {
    const button = document.createElement('button');
    button.className = 'peer-card';
    button.type = 'button';
    button.dataset.state = state.activePeerId === peer.id ? 'connected' : 'idle';
    button.innerHTML = `
      <span class="peer-avatar material-symbols-outlined" aria-hidden="true">question_mark</span>
      <span>
        <strong></strong>
        <p></p>
      </span>
    `;
    button.querySelector('strong').textContent = peer.name || 'Unknown Device';
    const transport = state.rtc.get(peer.id)?.channel?.readyState === 'open' ? 'WebRTC' : '本地服务';
    button.querySelector('p').textContent = `${peer.platform || 'Web'} · ${transport}`;
    button.addEventListener('click', () => {
      state.activePeerId = peer.id;
      dom.fileInput.value = '';
      dom.fileInput.click();
    });
    dom.peerList.append(button);
  }
  updateTransferUi();
};

const signalSend = (message) => {
  if (state.ws?.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify(message));
  }
};

const sendRtcSignal = (peerId, type, payload = {}) => {
  signalSend({ type: 'RELAY', target: peerId, payload: { type, payload } });
};

const closeRtc = (peerId) => {
  const context = state.rtc.get(peerId);
  if (!context) return;
  state.rtc.delete(peerId);
  state.pendingRtcChunks.delete(peerId);
  try {
    context.channel?.close();
    context.pc.close();
  } catch {
    /* ignored */
  }
  renderPeers();
};

const waitForRtcChannel = (channel) => {
  if (channel?.readyState === 'open') return Promise.resolve(channel);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebRTC 连接超时')), RTC_CONNECT_TIMEOUT);
    const cleanup = () => {
      clearTimeout(timer);
      channel?.removeEventListener('open', handleOpen);
      channel?.removeEventListener('close', handleClose);
      channel?.removeEventListener('error', handleClose);
    };
    const handleOpen = () => {
      cleanup();
      resolve(channel);
    };
    const handleClose = () => {
      cleanup();
      reject(new Error('WebRTC 连接已关闭'));
    };
    channel?.addEventListener('open', handleOpen);
    channel?.addEventListener('close', handleClose);
    channel?.addEventListener('error', handleClose);
  });
};

const waitForRtcBuffer = (channel) => {
  if (channel.bufferedAmount <= RTC_BUFFER_LIMIT) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      channel.removeEventListener('bufferedamountlow', handleLow);
      channel.removeEventListener('close', handleClose);
      channel.removeEventListener('error', handleClose);
    };
    const handleLow = () => {
      cleanup();
      resolve();
    };
    const handleClose = () => {
      cleanup();
      reject(new Error('WebRTC 连接已关闭'));
    };
    channel.addEventListener('bufferedamountlow', handleLow);
    channel.addEventListener('close', handleClose);
    channel.addEventListener('error', handleClose);
  });
};

const sendRtcPacket = async (channel, packet) => {
  if (channel?.readyState !== 'open') throw new Error('WebRTC 通道不可用');
  channel.send(JSON.stringify(packet));
  await waitForRtcBuffer(channel);
};

const sendRtcBinary = async (channel, buffer) => {
  if (channel?.readyState !== 'open') throw new Error('WebRTC 通道不可用');
  channel.send(buffer);
  await waitForRtcBuffer(channel);
};

const attachRtcChannel = (context, channel) => {
  context.channel = channel;
  channel.binaryType = 'arraybuffer';
  channel.bufferedAmountLowThreshold = RTC_BUFFER_LIMIT / 2;
  channel.addEventListener('open', renderPeers);
  channel.addEventListener('close', renderPeers);
  channel.addEventListener('message', (event) => {
    if (typeof event.data !== 'string') {
      receiveRtcBinaryChunk(context.peerId, event.data);
      return;
    }
    try {
      handleJsonMessage(context.peerId, JSON.parse(event.data));
    } catch {
      /* ignored */
    }
  });
};

const flushRtcCandidates = async (context) => {
  while (context.candidates.length && context.pc.remoteDescription) {
    const candidate = context.candidates.shift();
    await context.pc.addIceCandidate(candidate).catch(() => {});
  }
};

const createRtcContext = (peerId) => {
  const pc = new RTCPeerConnection();
  const context = {
    peerId,
    pc,
    channel: null,
    candidates: [],
    makingOffer: false,
    ignoreOffer: false,
    offerPromise: null,
    polite: state.id > peerId,
  };

  pc.addEventListener('icecandidate', ({ candidate }) => {
    if (candidate) sendRtcSignal(peerId, 'rtc-candidate', { candidate });
  });

  pc.addEventListener('datachannel', ({ channel }) => {
    attachRtcChannel(context, channel);
  });

  pc.addEventListener('connectionstatechange', () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') closeRtc(peerId);
  });

  state.rtc.set(peerId, context);
  return context;
};

const getRtcContext = (peerId) => state.rtc.get(peerId) || createRtcContext(peerId);

const openRtcChannel = async (peerId) => {
  if (!('RTCPeerConnection' in window)) throw new Error('当前浏览器不支持 WebRTC');
  const context = getRtcContext(peerId);
  if (context.channel?.readyState === 'open') return context.channel;
  if (!context.channel || context.channel.readyState === 'closed') {
    attachRtcChannel(context, context.pc.createDataChannel('landu'));
  }
  if (!context.offerPromise && context.pc.signalingState === 'stable') {
    context.offerPromise = (async () => {
      context.makingOffer = true;
      try {
        const offer = await context.pc.createOffer();
        await context.pc.setLocalDescription(offer);
        sendRtcSignal(peerId, 'rtc-offer', { description: context.pc.localDescription });
      } finally {
        context.makingOffer = false;
        context.offerPromise = null;
      }
    })();
  }
  if (context.offerPromise) await context.offerPromise;
  return waitForRtcChannel(context.channel);
};

const acceptRtcOffer = async (peerId, description) => {
  if (!('RTCPeerConnection' in window)) return;
  const context = getRtcContext(peerId);
  const pc = context.pc;
  const offerCollision = context.makingOffer || pc.signalingState !== 'stable';
  context.ignoreOffer = !context.polite && offerCollision;
  if (context.ignoreOffer) return;
  if (offerCollision) await pc.setLocalDescription({ type: 'rollback' }).catch(() => {});
  await pc.setRemoteDescription(description);
  await flushRtcCandidates(context);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  sendRtcSignal(peerId, 'rtc-answer', { description: pc.localDescription });
};

const acceptRtcAnswer = async (peerId, description) => {
  const context = state.rtc.get(peerId);
  if (!context || context.pc.signalingState !== 'have-local-offer') return;
  await context.pc.setRemoteDescription(description);
  await flushRtcCandidates(context);
};

const acceptRtcCandidate = async (peerId, candidate) => {
  if (!('RTCPeerConnection' in window) || !candidate) return;
  const context = getRtcContext(peerId);
  if (context.ignoreOffer && !context.pc.remoteDescription) return;
  if (!context.pc.remoteDescription) {
    context.candidates.push(candidate);
    return;
  }
  await context.pc.addIceCandidate(candidate).catch(() => {});
};

const upsertPeer = (rawPeer) => {
  const peer = toPeer(rawPeer);
  if (peer && peer.id !== state.id) state.peers.set(peer.id, peer);
};

const replacePeers = (rawPeers = []) => {
  state.peers.clear();
  for (const peer of rawPeers) upsertPeer(peer);
  renderPeers();
};

const sanitizeStyle = (style = '') =>
  style
    .split(';')
    .map((rule) => rule.trim())
    .filter((rule) => /^(color|background-color|font-weight|font-style|text-decoration|font-size|font-family|text-align)\s*:/i.test(rule))
    .join('; ');

const sanitizeHtml = (html = '') => {
  const template = document.createElement('template');
  template.innerHTML = html;
  const blockedTags = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'SVG', 'MATH']);
  for (const element of template.content.querySelectorAll('*')) {
    if (blockedTags.has(element.tagName)) {
      element.remove();
      continue;
    }
    for (const attr of [...element.attributes]) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim();
      if (name.startsWith('on') || name === 'srcdoc' || name === 'id') element.removeAttribute(attr.name);
      if ((name === 'href' || name === 'src') && !/^(https?:|data:image\/|blob:|#|\/)/i.test(value)) element.removeAttribute(attr.name);
      if (name === 'style') {
        const safeStyle = /url\s*\(|expression\s*\(/i.test(value) ? '' : sanitizeStyle(value);
        if (safeStyle) element.setAttribute('style', safeStyle);
        else element.removeAttribute(attr.name);
      }
    }
  }
  return template.innerHTML;
};

const clipboardPayload = () => ({
  text: dom.clipboardText.innerText || dom.clipboardText.textContent || '',
  html: sanitizeHtml(dom.clipboardText.innerHTML).trim(),
});

const hasClipboardPayload = ({ text, html }) => Boolean(text.trim() || html.replace(/<br\s*\/?>/gi, '').trim());

const renderClipboardPayload = ({ text = '', html = '' }) => {
  if (html) dom.clipboardText.innerHTML = sanitizeHtml(html);
  else dom.clipboardText.textContent = text;
};

const shareClipboardWith = (peerId) => {
  const payload = clipboardPayload();
  return Boolean(hasClipboardPayload(payload) && sendJson('clipboard', payload, peerId, { silent: true }));
};

const shareClipboardWithAll = () => {
  let sent = false;
  for (const peerId of state.peers.keys()) sent = shareClipboardWith(peerId) || sent;
  return sent;
};

const connectDiscovery = () => {
  const url = new URL(SIGNALING_URL);
  url.searchParams.set('d', toBase64(JSON.stringify(clientInfo())));
  const ws = new WebSocket(url);
  state.ws = ws;

  ws.addEventListener('open', () => {
    clearInterval(state.pingTimer);
    state.pingTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send('');
    }, 120000);
  });

  ws.addEventListener('message', (event) => {
    if (!event.data) return;
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message.type === 'HELLO') {
      state.id = message.client?.id || '';
      replacePeers(message.peers);
      shareClipboardWithAll();
    } else if (message.type === 'JOIN') {
      upsertPeer(message.peer);
      renderPeers();
      shareClipboardWith(message.peer?.id);
    } else if (message.type === 'UPDATE') {
      upsertPeer(message.peer);
      renderPeers();
    } else if (message.type === 'LEFT') {
      state.peers.delete(message.peerId);
      if (state.activePeerId === message.peerId) state.activePeerId = '';
      closeRtc(message.peerId);
      renderPeers();
    } else if (message.type === 'RELAY') {
      upsertPeer(message.peer);
      handleJsonMessage(message.peer.id, message.payload);
    } else if (message.type === 'ERROR') {
      showToast(`信令服务错误：${message.code || 'unknown'}`);
    }
  });

  ws.addEventListener('close', () => {
    clearInterval(state.pingTimer);
    for (const peerId of [...state.rtc.keys()]) closeRtc(peerId);
    setTimeout(connectDiscovery, 1500);
  });
};

const reconnectDiscovery = () => {
  state.peers.clear();
  state.activePeerId = '';
  clearInterval(state.pingTimer);
  for (const peerId of [...state.rtc.keys()]) closeRtc(peerId);
  renderPeers();
  if (state.ws?.readyState === WebSocket.OPEN || state.ws?.readyState === WebSocket.CONNECTING) {
    state.ws.close();
  } else {
    connectDiscovery();
  }
};

const savePin = (nextPin) => {
  const next = nextPin.trim();
  if (next === state.pin) return;
  state.pin = next;
  dom.pinValue.textContent = state.pin || '未设置';
  try {
    if (state.pin) localStorage.setItem('landu:pin', state.pin);
    else localStorage.removeItem('landu:pin');
  } catch {
    /* ignored */
  }
  reconnectDiscovery();
};

const openPinDialog = () => {
  dom.pinInput.value = state.pin;
  if (typeof dom.pinDialog.showModal === 'function') dom.pinDialog.showModal();
  else dom.pinDialog.setAttribute('open', '');
  dom.pinInput.focus();
};

const sendJson = (type, payload = {}, peerId = targetPeerId(), { silent = false, relay = false } = {}) => {
  if (peerId && state.ws?.readyState === WebSocket.OPEN) {
    state.activePeerId = peerId;
    const channel = state.rtc.get(peerId)?.channel;
    if (!relay && channel?.readyState === 'open') {
      try {
        channel.send(JSON.stringify({ type, payload }));
        return true;
      } catch {
        closeRtc(peerId);
      }
    }
    signalSend({ type: 'RELAY', target: peerId, payload: { type, payload } });
    return true;
  }
  if (!silent) showToast('请先发现一台设备。');
  return false;
};

const humanFileSize = (bytes) => {
  if (!Number.isFinite(bytes)) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 || value >= 10 ? 0 : 1)} ${units[index]}`;
};

const addListItem = (title, detail, container = dom.fileList) => {
  const item = document.createElement('div');
  item.className = 'item';
  const heading = document.createElement('strong');
  heading.textContent = title;
  const body = document.createElement('span');
  body.textContent = detail;
  item.append(heading, body);
  container.prepend(item);
  return item;
};

const updateSendProgress = (sent, total) => {
  const percent = total ? Math.min(100, Math.round((sent / total) * 100)) : 100;
  dom.transferTotalText.textContent = `${humanFileSize(sent)} / ${humanFileSize(total)}`;
  dom.transferTotalProgress.value = percent;
  dom.transferFileProgress.value = percent;
};

const showSendProgress = (file) => {
  clearTimeout(showSendProgress.timer);
  dom.transferTitle.textContent = '发送文件中...';
  dom.transferFileName.textContent = file.name;
  dom.transferFileSize.textContent = humanFileSize(file.size);
  updateSendProgress(0, file.size);
  dom.transferModal.hidden = false;
};

const finishSendProgress = (title) => {
  dom.transferTitle.textContent = title;
  showSendProgress.timer = setTimeout(() => {
    dom.transferModal.hidden = true;
  }, 700);
};

const waitForFileAck = (id) => {
  let waiter;
  const promise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('接收端校验超时')), 20000);
    waiter = { resolve, reject, timer };
  });
  state.outgoingFileAcks.set(id, waiter);
  return promise.finally(() => {
    clearTimeout(waiter.timer);
    state.outgoingFileAcks.delete(id);
  });
};

const handleFileAck = ({ id, ok, message }) => {
  const waiter = state.outgoingFileAcks.get(id);
  if (!waiter) return;
  if (ok) waiter.resolve(message || '接收端校验通过');
  else waiter.reject(new Error(message || '接收端校验失败'));
};

const sendFileObject = async (file, peerId = targetPeerId()) => {
  if (!file) {
    showToast('请先选择文件。');
    return;
  }
  if (!peerId || state.ws?.readyState !== WebSocket.OPEN) {
    showToast('请先发现一台设备。');
    return;
  }
  const id = randomId();
  const ackPromise = waitForFileAck(id).catch((error) => error);
  showSendProgress(file);
  dom.transferTitle.textContent = '建立 WebRTC 连接...';
  const channel = await openRtcChannel(peerId).catch(() => null);
  const viaRtc = channel?.readyState === 'open';
  dom.transferTitle.textContent = '发送文件中...';
  const sendPacket = async (type, payload, binary) => {
    if (viaRtc) {
      await sendRtcPacket(channel, { type, payload });
      if (binary) await sendRtcBinary(channel, binary);
      return true;
    }
    return sendJson(type, payload, peerId, { silent: true, relay: true });
  };
  const entry = addListItem(`发送 ${file.name}`, `0% · ${humanFileSize(file.size)} · ${viaRtc ? 'WebRTC' : '本地服务'}`);
  let sent = 0;
  try {
    if (!(await sendPacket('file-meta', { id, name: file.name, size: file.size, mime: file.type || 'application/octet-stream', chunkSize: FILE_CHUNK_SIZE }))) {
      throw new Error('连接已断开');
    }
    let index = 0;
    for (let offset = 0; offset < file.size; offset += FILE_CHUNK_SIZE) {
      const chunk = await file.slice(offset, offset + FILE_CHUNK_SIZE).arrayBuffer();
      const chunkMeta = { id, index, checksum: checksum(chunk) };
      const payload = viaRtc ? chunkMeta : { ...chunkMeta, data: bufferToBase64(chunk) };
      if (!(await sendPacket(viaRtc ? 'file-chunk-meta' : 'file-chunk', payload, chunk))) throw new Error('连接已断开');
      sent += chunk.byteLength;
      index += 1;
      updateSendProgress(sent, file.size);
      entry.lastChild.textContent = `${Math.round((sent / file.size) * 100)}% · ${humanFileSize(file.size)} · ${viaRtc ? 'WebRTC' : '本地服务'}`;
    }
    updateSendProgress(file.size, file.size);
    if (!(await sendPacket('file-complete', { id, chunks: Math.ceil(file.size / FILE_CHUNK_SIZE) }))) throw new Error('连接已断开');
    dom.transferTitle.textContent = '等待接收端校验...';
    const ack = await ackPromise;
    if (ack instanceof Error) throw ack;
    entry.lastChild.textContent = `已验证 · ${humanFileSize(file.size)} · ${viaRtc ? 'WebRTC' : '本地服务'}`;
    finishSendProgress('发送完成');
  } catch (error) {
    const waiter = state.outgoingFileAcks.get(id);
    if (waiter) waiter.reject(error);
    finishSendProgress('发送失败');
    throw error;
  }
};

const sendFile = async () => {
  try {
    await sendFileObject(dom.fileInput.files?.[0]);
  } finally {
    dom.fileInput.value = '';
  }
};

const receiveFileMeta = (peerId, { id, name, size, mime, chunkSize }) => {
  const entry = addListItem(`接收 ${name || '文件'}`, `0% · ${humanFileSize(size)}`);
  state.incomingFiles.set(id, {
    id,
    peerId,
    name: name || '接收文件',
    size,
    mime: mime || 'application/octet-stream',
    chunkSize: chunkSize || FILE_CHUNK_SIZE,
    received: 0,
    nextIndex: 0,
    chunks: [],
    entry,
  });
};

const failIncomingFile = (transfer, message) => {
  if (!transfer) return;
  transfer.entry.lastChild.textContent = message;
  state.incomingFiles.delete(transfer.id);
  sendJson('file-ack', { id: transfer.id, ok: false, message }, transfer.peerId, { silent: true });
  showToast(message);
};

const receiveFileChunk = (peerId, { id, index, data, checksum: expectedChecksum }) => {
  const transfer = state.incomingFiles.get(id);
  if (!transfer) return;
  if (index !== transfer.nextIndex) {
    failIncomingFile(transfer, '文件分片顺序错误，已取消接收。');
    return;
  }
  const chunk = data instanceof ArrayBuffer ? data : base64ToBuffer(data);
  if (expectedChecksum && checksum(chunk) !== expectedChecksum) {
    failIncomingFile(transfer, '文件分片校验失败，已取消接收。');
    return;
  }
  transfer.chunks.push(chunk);
  transfer.received += chunk.byteLength;
  transfer.nextIndex += 1;
  const percent = transfer.size ? Math.min(100, Math.round((transfer.received / transfer.size) * 100)) : 0;
  transfer.entry.lastChild.textContent = `${percent}% · ${humanFileSize(transfer.size)}`;
};

const receiveRtcBinaryChunk = async (peerId, data) => {
  const pending = state.pendingRtcChunks.get(peerId);
  if (!pending) return;
  state.pendingRtcChunks.delete(peerId);
  const buffer = data instanceof Blob ? await data.arrayBuffer() : data;
  receiveFileChunk(peerId, { ...pending, data: buffer });
};

const completeFile = (peerId, { id, chunks }) => {
  const transfer = state.incomingFiles.get(id);
  if (!transfer) return;
  if (transfer.received !== transfer.size || (Number.isFinite(chunks) && transfer.chunks.length !== chunks)) {
    failIncomingFile(transfer, '文件大小校验失败，已取消接收。');
    return;
  }
  const blob = new Blob(transfer.chunks, { type: transfer.mime });
  const url = URL.createObjectURL(blob);
  transfer.entry.lastChild.textContent = `已接收 · ${humanFileSize(transfer.size)}`;
  const link = document.createElement('a');
  link.href = url;
  link.download = transfer.name;
  link.textContent = `下载 ${transfer.name} · ${humanFileSize(transfer.size)}`;
  transfer.entry.append(link);
  link.click();
  sendJson('file-ack', { id, ok: true, message: '接收端校验通过' }, peerId, { silent: true });
  setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
  state.incomingFiles.delete(id);
};

const targetPeerId = () =>
  (state.activePeerId && state.peers.has(state.activePeerId) ? state.activePeerId : '') ||
  state.peers.keys().next().value ||
  '';

const bufferToBase64 = (buffer) => {
  let binary = '';
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const base64ToBuffer = (base64) => {
  const binary = atob(base64 || '');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
};

const extensionForMime = (mime = '') =>
  ({
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'application/pdf': '.pdf',
  })[mime] || '';

const namedClipboardFile = (blob, index) => {
  if (!blob) return null;
  if (blob instanceof File && blob.name) return blob;
  return new File([blob], `clipboard-${Date.now()}-${index + 1}${extensionForMime(blob.type)}`, { type: blob.type || 'application/octet-stream' });
};

const escapeAttribute = (value = '') => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

const blobToDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(reader.result));
    reader.addEventListener('error', () => reject(reader.error || new Error('读取图片失败')));
    reader.readAsDataURL(blob);
  });

const imageFilesToHtml = async (files) =>
  (
    await Promise.all(
      files.map(async (file) => `<p><img src="${await blobToDataUrl(file)}" alt="${escapeAttribute(file.name || 'clipboard image')}"></p>`),
    )
  ).join('');

const sendClipboardFiles = async (files) => {
  const peerIds = [...state.peers.keys()];
  if (!files.length) return;
  if (!peerIds.length) {
    showToast('请先发现一台设备。');
    return;
  }
  for (const peerId of peerIds) {
    for (const file of files) await sendFileObject(file, peerId);
  }
  showToast(files.length === 1 ? '已发送粘贴文件。' : `已发送 ${files.length} 个粘贴文件。`);
};

const syncClipboard = ({ silent = false } = {}) => {
  const payload = clipboardPayload();
  if (!hasClipboardPayload(payload)) {
    dom.clipboardState.textContent = '自动同步';
    return;
  }
  if (shareClipboardWithAll()) {
    dom.clipboardState.textContent = '已同步';
    if (!silent) showToast('剪贴板已同步。');
  } else {
    dom.clipboardState.textContent = '等待连接';
  }
};

const scheduleClipboardSync = () => {
  clearTimeout(state.clipboardTimer);
  dom.clipboardState.textContent = state.peers.size ? '正在同步...' : '等待连接';
  state.clipboardTimer = setTimeout(() => syncClipboard({ silent: true }), 450);
};

const focusClipboardInput = () => {
  dom.clipboardText.focus();
};

const selectClipboardContent = () => {
  focusClipboardInput();
  const range = document.createRange();
  range.selectNodeContents(dom.clipboardText);
  const selection = getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
};

const insertClipboardContent = ({ text = '', html = '' }) => {
  focusClipboardInput();
  document.execCommand(html ? 'insertHTML' : 'insertText', false, html ? sanitizeHtml(html) : text);
};

const pastedFiles = (dataTransfer) =>
  Array.from(dataTransfer?.items || [])
    .filter((item) => item.kind === 'file')
    .map((item, index) => namedClipboardFile(item.getAsFile(), index))
    .filter(Boolean);

const handleClipboardPaste = async (event) => {
  const data = event.clipboardData;
  if (!data) return;
  const files = pastedFiles(data);
  const imageFiles = files.filter((file) => file.type.startsWith('image/'));
  const otherFiles = files.filter((file) => !file.type.startsWith('image/'));
  const html = data.getData('text/html');
  const text = data.getData('text/plain');
  if (!html && !files.length) return;
  event.preventDefault();
  const imageHtml = await imageFilesToHtml(imageFiles);
  if (html || text || imageHtml) {
    insertClipboardContent({ html: `${html}${imageHtml}`, text });
    scheduleClipboardSync();
  }
  if (otherFiles.length) sendClipboardFiles(otherFiles).catch((error) => showToast(`发送粘贴文件失败：${error.message}`));
};

const readRichClipboard = async () => {
  const payload = { text: '', html: '' };
  const files = [];
  for (const item of await navigator.clipboard.read()) {
    for (const type of item.types) {
      const blob = await item.getType(type);
      if (type === 'text/html' && !payload.html) payload.html = await blob.text();
      else if (type === 'text/plain' && !payload.text) payload.text = await blob.text();
      else if (type.startsWith('image/')) payload.html += await imageFilesToHtml([namedClipboardFile(blob, files.length)]);
      else if (!type.startsWith('text/')) files.push(namedClipboardFile(blob, files.length));
    }
  }
  return { payload, files };
};

const readAndPushClipboard = async () => {
  if (!navigator.clipboard?.readText && !navigator.clipboard?.read) {
    focusClipboardInput();
    showToast(window.isSecureContext ? '当前浏览器不允许网页读取剪贴板，请直接粘贴。' : '当前地址不是安全上下文，Edge 会禁止读取剪贴板，请直接粘贴。');
    return;
  }
  try {
    if (navigator.clipboard.read) {
      const { payload, files } = await readRichClipboard();
      if (hasClipboardPayload(payload)) {
        renderClipboardPayload(payload);
        syncClipboard({ silent: false });
      }
      if (files.length) await sendClipboardFiles(files);
      if (!hasClipboardPayload(payload) && !files.length) showToast('剪贴板没有可读取的内容。');
      return;
    }
    renderClipboardPayload({ text: await navigator.clipboard.readText() });
    syncClipboard({ silent: false });
  } catch (error) {
    focusClipboardInput();
    showToast(`读取剪贴板失败：${error.message || '请直接粘贴。'}`);
  }
};

const writeClipboardContent = async ({ text = '', html = '' }) => {
  const cleanHtml = sanitizeHtml(html);
  if (cleanHtml && navigator.clipboard?.write && globalThis.ClipboardItem) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([cleanHtml], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        }),
      ]);
      return;
    } catch {
      /* fall back to text or selection copy */
    }
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  selectClipboardContent();
  if (!document.execCommand('copy')) throw new Error('当前浏览器不支持复制');
};

const copyClipboard = async () => {
  const payload = clipboardPayload();
  if (!hasClipboardPayload(payload)) {
    showToast('没有可复制的内容。');
    return;
  }
  try {
    await writeClipboardContent(payload);
    showToast('已复制到本机剪贴板。');
  } catch (error) {
    showToast(`复制失败：${error.message}`);
  }
};

const handleJsonMessage = (peerId, { type, payload = {} }) => {
  switch (type) {
    case 'hello':
      state.peers.set(peerId, { ...(state.peers.get(peerId) || { id: peerId }), name: payload.name, platform: payload.platform });
      renderPeers();
      break;
    case 'text-message':
      break;
    case 'clipboard':
      renderClipboardPayload(payload);
      dom.clipboardState.textContent = '收到剪贴板';
      writeClipboardContent(payload).catch(() => {});
      showToast('收到剪贴板内容。');
      break;
    case 'rtc-offer':
      acceptRtcOffer(peerId, payload.description).catch(() => closeRtc(peerId));
      break;
    case 'rtc-answer':
      acceptRtcAnswer(peerId, payload.description).catch(() => closeRtc(peerId));
      break;
    case 'rtc-candidate':
      acceptRtcCandidate(peerId, payload.candidate).catch(() => {});
      break;
    case 'file-meta':
      receiveFileMeta(peerId, payload);
      break;
    case 'file-chunk-meta':
      state.pendingRtcChunks.set(peerId, payload);
      break;
    case 'file-chunk':
      receiveFileChunk(peerId, payload);
      break;
    case 'file-complete':
      completeFile(peerId, payload);
      break;
    case 'file-ack':
      handleFileAck(payload);
      break;
    default:
      break;
  }
};

dom.fileInput.addEventListener('change', () => {
  if (!dom.fileInput.files?.[0]) return;
  sendFile().catch((error) => showToast(`发送失败：${error.message}`));
});
dom.pinButton.addEventListener('click', openPinDialog);
dom.pinDialog.addEventListener('close', () => {
  if (dom.pinDialog.returnValue === 'save') savePin(dom.pinInput.value);
});
dom.qrToggle.addEventListener('click', () => {
  state.addressMode = state.addressMode === 'mdns' && state.addresses.ip ? 'ip' : 'mdns';
  updateAddressDisplay();
});
dom.clipboardText.addEventListener('input', scheduleClipboardSync);
dom.clipboardText.addEventListener('paste', (event) => {
  handleClipboardPaste(event).catch((error) => showToast(`粘贴失败：${error.message}`));
});
dom.readClipboardBtn.addEventListener('click', readAndPushClipboard);
dom.copyClipboardBtn.addEventListener('click', copyClipboard);
dom.themeToggle.addEventListener('click', () => {
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
});

updateTransferUi();
loadAddresses();
connectDiscovery();
