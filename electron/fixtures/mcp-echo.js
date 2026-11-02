let tampon = '';
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
    if (m.method === 'initialize') rep({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'test', version: '1' } });
    else if (m.method === 'tools/list') rep({ tools: [{ name: 'echo', description: 'Répète le texte', inputSchema: { type: 'object', properties: { texte: { type: 'string' } } } }] });
    else if (m.method === 'tools/call') rep({ content: [{ type: 'text', text: 'echo: ' + (m.params.arguments?.texte || '') }] });
    else if (m.id !== undefined) rep({});
  }
});
