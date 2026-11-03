
async request(method, endpoint, params = {}, signed = false) {
    const query = new URLSearchParams(params).toString();
    const body = method === 'POST' ? JSON.stringify(params) : '';

    const url = this.baseUrl + endpoint +
        (method === 'GET' && query ? `?${query}` : '');

    const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    };

    if (signed) {
        if (!this.apiKey || !this.apiSecret) {
            throw new Error('Credenciais da Bybit não configuradas.');
        }

        const timestamp = Date.now().toString();
        const payload = method === 'GET' ? query : body;

        const preSign = timestamp + this.apiKey +
            this.recvWindow + payload;

        const signature = crypto
            .createHmac('sha256', this.apiSecret)
            .update(preSign)
            .digest('hex');

        Object.assign(headers, {
            'X-BAPI-API-KEY': this.apiKey,
            'X-BAPI-SIGN': signature,
            'X-BAPI-TIMESTAMP': timestamp,
            'X-BAPI-RECV-WINDOW': this.recvWindow
        });
    }

    const response = await fetch(url, {
        method,
        headers,
        ...(method === 'POST' ? { body } : {}),
        signal: AbortSignal.timeout(12000)
    });

    const rawText = await response.text();

    let data;

    try {
        data = JSON.parse(rawText);
    } catch (error) {
        const preview = rawText.slice(0, 250).replace(/\s+/g, ' ');

        throw new Error(
            `Resposta inválida da Bybit. HTTP ${response.status}. ` +
            `Conteúdo recebido: ${preview || '(vazio)'}`
        );
    }

    if (!response.ok) {
        throw new Error(`Erro HTTP ${response.status}: ${data.retMsg || 'Falha na API'}`);
    }

    if (data.retCode !== 0) {
        throw new Error(
            `Bybit ${data.retCode}: ${data.retMsg || 'Erro desconhecido'}`
        );
    }

    return data.result;
}
