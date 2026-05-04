const { onRequest } = require("firebase-functions/v2/https");
const functions = require("firebase-functions");
const axios = require('axios');

// Default options for all proxies: 2-minute timeout and automatic CORS support
const proxyOptions = { cors: true, timeoutSeconds: 120 };

// 1. Wealthbox Proxy (With Multi-Page Support)
exports.syncWealthboxProxy = onRequest(proxyOptions, async (req, res) => {
    const apiKey = req.query.apiKey;
    if (!apiKey) return res.status(400).send('Missing API Key');
    try {
        let allTemplates = [];
        let page = 1;
        let hasMore = true;
        while (hasMore) {
            const response = await axios.get(`https://api.crmworkspace.com/v1/workflow_templates?page=${page}`, {
                headers: { 'ACCESS_TOKEN': apiKey, 'Accept': 'application/json' }
            });
            const templates = response.data.workflow_templates || [];
            allTemplates = allTemplates.concat(templates);
            if (templates.length === 25 && page < 20) page++; else hasMore = false;
        }
        res.status(200).json({ workflow_templates: allTemplates });
    } catch (error) { res.status(500).send(error.message); }
});

// 2. Jotform Proxy
exports.jotformProxy = onRequest(proxyOptions, async (req, res) => {
    const apiKey = req.query.apiKey;
    if (!apiKey) return res.status(400).send('Missing API Key');
    try {
        const response = await axios.get(`https://api.jotform.com/user/forms`, {
            params: { apiKey: apiKey },
            headers: { 'User-Agent': 'SphynxOperationsLibrary/1.0' }
        });
        // Jotform usually returns { responseCode: 200, content: [...] }
        res.status(200).json(response.data);
    } catch (error) { 
        console.error("Jotform Proxy Error:", error.response?.data || error.message);
        res.status(500).send(error.message); 
    }
});

// 3. Calendly Proxy
exports.calendlyProxy = functions.https.onRequest(async (req, res) => {
    // 🛡️ Manually handle CORS for v1 pattern
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST');

    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }

    const apiKey = req.query.apiKey;
    if (!apiKey) return res.status(400).send('Missing API Key');

    try {
        const response = await axios.get("https://api.calendly.com/event_types?user=me", {
            headers: { 
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });
        res.status(200).json(response.data);
    } catch (error) {
        console.error("Calendly API Error:", error.response?.data || error.message);
        res.status(500).send(error.message);
    }
});

// 4. ActiveCampaign Proxy
exports.acProxy = onRequest(proxyOptions, async (req, res) => {
    const { apiKey, baseUrl } = req.query;
    if (!apiKey || !baseUrl) return res.status(400).send('Missing API Key or Base URL');
    try {
        const response = await axios.get(`${baseUrl}/api/3/automations`, {
            headers: { 'Api-Token': apiKey }
        });
        res.status(200).json(response.data);
    } catch (error) { res.status(500).send(error.message); }
});

// 5. MailerLite Proxy
exports.mailerliteProxy = onRequest(proxyOptions, async (req, res) => {
    const apiKey = req.query.apiKey;
    if (!apiKey) return res.status(400).send('Missing API Key');
    try {
        const response = await axios.get("https://connect.mailerlite.com/api/automations", {
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        res.status(200).json(response.data);
    } catch (error) { res.status(500).send(error.message); }
});

// 6. YouCanBookMe Proxy
exports.ycbmProxy = onRequest(proxyOptions, async (req, res) => {
    const apiKey = req.query.apiKey; // Base64 encoded 'email:api_key'
    if (!apiKey) return res.status(400).send('Missing API Key');
    try {
        const response = await axios.get("https://api.youcanbook.me/v1/profiles", {
            headers: { 'Authorization': `Basic ${apiKey}` }
        });
        res.status(200).json(response.data);
    } catch (error) { res.status(500).send(error.message); }
});
