(function (token, url, fallbackName, fallbackMime) {
  function receive(event) {
    if (event.data !== token || !event.ports[0]) return;
    window.removeEventListener('message', receive);
    const port = event.ports[0];
    // Capture the Blob immediately: the website revokes its URL after export.
    const source = fetch(url, { credentials: 'same-origin' }).then(response => {
      if (!response.ok) throw new Error('download failed');
      return response.blob();
    });
    let offset = 0;
    let reading = false;
    port.onmessage = async function (message) {
      if (message.data === 'cancel') { port.close(); return; }
      if (message.data !== 'next' || reading) return;
      reading = true;
      try {
        const blob = await source;
        if (offset >= blob.size) {
          port.postMessage(JSON.stringify({ type: 'done' }));
          port.close();
          return;
        }
        const bytes = new Uint8Array(await blob.slice(offset, offset + 49152).arrayBuffer());
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        offset += bytes.length;
        port.postMessage(JSON.stringify({ type: 'chunk', data: btoa(binary) }));
      } catch (error) {
        port.postMessage(JSON.stringify({ type: 'error' }));
        port.close();
      } finally { reading = false; }
    };
    source.then(blob => port.postMessage(JSON.stringify({
      type: 'ready',
      name: window.__bxshExportNames?.get(url) || fallbackName,
      mime: blob.type || fallbackMime || 'application/octet-stream',
      size: blob.size
    }))).catch(() => { port.postMessage(JSON.stringify({ type: 'error' })); port.close(); });
  }
  window.addEventListener('message', receive);
}).apply(null, __ARGS__);
