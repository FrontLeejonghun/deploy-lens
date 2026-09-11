import http from 'node:http';
import net from 'node:net';
import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';

export async function publicAddress(hostname) {
  const host = hostname.replace(/^\[|\]$/g, '');
  const addresses = net.isIP(host)
    ? [{ address: host, family: net.isIP(host) }]
    : await lookup(host, { all: true });
  if (
    !addresses.length ||
    addresses.some(({ address }) => ipaddr.process(address).range() !== 'unicast')
  )
    throw new Error('공개 인터넷 주소만 비교할 수 있습니다.');
  return addresses[0];
}

export async function createEgressProxy() {
  const sockets = new Set();
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url);
      if (url.protocol !== 'http:' || (url.port && url.port !== '80'))
        throw new Error('지원하지 않는 주소입니다.');
      const resolved = await publicAddress(url.hostname);
      const headers = { ...req.headers, host: url.host };
      delete headers['proxy-connection'];
      delete headers['proxy-authorization'];
      const outgoing = http.request(
        {
          hostname: resolved.address,
          family: resolved.family,
          port: 80,
          path: url.pathname + url.search,
          method: req.method,
          headers,
          timeout: 15000,
        },
        (upstream) => {
          res.writeHead(upstream.statusCode ?? 502, upstream.headers);
          upstream.pipe(res);
        },
      );
      outgoing.on('timeout', () => outgoing.destroy());
      outgoing.on('error', () => {
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });
      req.pipe(outgoing);
    } catch {
      res.writeHead(403);
      res.end('대상 주소에 접근할 수 없습니다.');
    }
  });
  server.on('connect', async (req, client, head) => {
    try {
      const url = new URL(`https://${req.url}`);
      if (url.port && url.port !== '443') throw new Error('포트 제한');
      const resolved = await publicAddress(url.hostname);
      const upstream = net.connect({ host: resolved.address, family: resolved.family, port: 443 });
      sockets.add(upstream);
      upstream.on('close', () => sockets.delete(upstream));
      upstream.setTimeout(20000, () => upstream.destroy());
      upstream.once('connect', () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) upstream.write(head);
        upstream.pipe(client);
        client.pipe(upstream);
      });
      upstream.on('error', () => client.destroy());
      client.on('error', () => upstream.destroy());
      client.on('close', () => upstream.destroy());
    } catch {
      client.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    }
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
