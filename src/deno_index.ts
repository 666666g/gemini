const getContentType = (path: string): string => {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  const types: Record<string, string> = {
    'js': 'application/javascript',
    'css': 'text/css',
    'html': 'text/html',
    'json': 'application/json',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif'
  };
  return types[ext] || 'text/plain';
};

async function handleWebSocket(req: Request, defaultApiKey?: string): Promise<Response> {
  const { socket: ws, response } = Deno.upgradeWebSocket(req);
  
  const url = new URL(req.url);
  const apiKey = url.searchParams.get("key") || defaultApiKey;
  
  console.log('WebSocket connection attempt:', {
    timestamp: new Date().toISOString(),
    hasApiKey: !!apiKey,
    keySource: url.searchParams.get("key") ? 'client' : 'environment',
    keyLength: apiKey?.length,
    urlPath: url.pathname
  });

  if (!apiKey) {
    ws.close(1008, "No API key provided");
    return response;
  }

  // 构建新的 URL，确保包含 API Key
  const targetUrl = new URL(`wss://generativelanguage.googleapis.com${url.pathname}`);
  targetUrl.searchParams.set("key", apiKey);
  
  console.log('API Key status:', {
    hasClientKey: !!url.searchParams.get("key"),
    hasDefaultKey: !!defaultApiKey,
    finalKeyLength: apiKey?.length
  });

  const targetWs = new WebSocket(targetUrl.toString());
  
  const pendingMessages: string[] = [];
  targetWs.onopen = () => {
    console.log('Connected to Gemini');
    pendingMessages.forEach(msg => targetWs.send(msg));
    pendingMessages.length = 0;
  };

  ws.onmessage = (event) => {
    console.log('Client message received');
    if (targetWs.readyState === WebSocket.OPEN) {
      targetWs.send(event.data);
    } else {
      pendingMessages.push(event.data);
    }
  };

  targetWs.onmessage = (event) => {
    console.log('Gemini message received');
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(event.data);
    }
  };

  ws.onclose = (event) => {
    console.log('Client connection closed');
    if (targetWs.readyState === WebSocket.OPEN) {
      targetWs.close(1000, event.reason);
    }
  };

  targetWs.onclose = (event) => {
    console.log('Gemini connection closed');
    if (ws.readyState === WebSocket.OPEN) {
      ws.close(event.code, event.reason);
    }
  };

  targetWs.onerror = (error) => {
    console.error('Gemini WebSocket error:', error);
    if (ws.readyState === WebSocket.OPEN) {
      ws.close(1006, `Connection failed: ${error.message || 'Unknown error'}`);
    }
  };

  return response;
}

async function handleAPIRequest(req: Request): Promise<Response> {
  try {
    const worker = await import('./api_proxy/worker.mjs');
    return await worker.default.fetch(req);
  } catch (error) {
    console.error('API request error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    const errorStatus = (error as { status?: number }).status || 500;
    return new Response(errorMessage, {
      status: errorStatus,
      headers: {
        'content-type': 'text/plain;charset=UTF-8',
      }
    });
  }
}

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  console.log('Request URL:', req.url);

  // 获取环境变量中的 API Key
  const defaultApiKey = Deno.env.get("GEMINI_API_KEY");

  // WebSocket 处理
  if (req.headers.get("Upgrade")?.toLowerCase() === "websocket") {
    return handleWebSocket(req, defaultApiKey);
  }

  if (url.pathname.endsWith("/chat/completions") ||
      url.pathname.endsWith("/embeddings") ||
      url.pathname.endsWith("/models")) {
    return handleAPIRequest(req);
  }

  // 静态文件处理
  try {
    let filePath = url.pathname;
    if (filePath === '/' || filePath === '/index.html') {
      filePath = '/index.html';
    }

    const fullPath = `${Deno.cwd()}/src/static${filePath}`;

    const file = await Deno.readFile(fullPath);
    const contentType = getContentType(filePath);

    return new Response(file, {
      headers: {
        'content-type': `${contentType};charset=UTF-8`,
      },
    });
  } catch (e) {
    console.error('Error details:', e);
    return new Response('Not Found', { 
      status: 404,
      headers: {
        'content-type': 'text/plain;charset=UTF-8',
      }
    });
  }
}

Deno.serve(handleRequest); 