'use strict';

/**
 * Serveur MCP volontairement strict, pour l'autotest.
 *
 * Il refuse « tools/list » tant que « initialize » n'a pas été reçu comme une
 * vraie requête (avec id) : c'est ce qu'impose le protocole, et c'est ce qui
 * casse un client qui envoie l'initialisation en notification.
 */

let tampon = '';
let initialise = false;

process.stdin.on('data', (d) => {
  tampon += d.toString();
  let i;
  while ((i = tampon.indexOf('\n')) !== -1) {
    const ligne = tampon.slice(0, i).trim();
    tampon = tampon.slice(i + 1);
    if (!ligne) continue;

    let m;
    try { m = JSON.parse(ligne); } catch { continue; }

    const rep = (r) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: r }) + '\n');
    const err = (code, message) => process.stdout.write(
      JSON.stringify({ jsonrpc: '2.0', id: m.id, error: { code, message } }) + '\n'
    );

    if (m.method === 'initialize') {
      if (m.id === undefined) continue; // une notification ne vaut pas initialisation
      initialise = true;
      rep({
        protocolVersion: '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'strict', version: '1' }
      });
    } else if (m.method === 'tools/list') {
      if (!initialise) { err(-32002, 'Server not initialized'); continue; }
      rep({ tools: [{ name: 'ping', description: 'Répond pong', inputSchema: { type: 'object', properties: {} } }] });
    } else if (m.method === 'tools/call') {
      if (!initialise) { err(-32002, 'Server not initialized'); continue; }
      rep({ content: [{ type: 'text', text: 'pong' }] });
    } else if (m.id !== undefined) {
      rep({});
    }
  }
});
